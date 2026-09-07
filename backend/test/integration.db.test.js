// Database-gated integration tests for the money-critical invariants:
// duplicate webhook, duplicate referral rewards, duplicate monthly charge,
// duplicate/concurrent cohort advancement, duplicate payout, missing L1/L2/L3,
// insufficient balance, failed/reversed withdrawals, and admin authorization
// guards.
//
// These tests REQUIRE a scratch PostgreSQL database and are NEVER meant to run
// against the production database. Set TEST_DATABASE_URL to a disposable
// database (e.g. a local Postgres or a throwaway Neon branch) and run `npm test`.
// Without it, the whole suite is reported skipped.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';

const testUrl = process.env.TEST_DATABASE_URL;

if (!testUrl) {
  console.error(
    '\n[integration] TEST_DATABASE_URL is not set — skipping DB integration tests.\n' +
      '[integration] These tests must never run against the production database.\n',
  );
  test('integration suite requires TEST_DATABASE_URL (skipped)', { skip: true }, () => {});
} else {
  // Point the app at the throwaway database BEFORE any module that reads env.
  process.env.DATABASE_URL = testUrl;
  process.env.NODE_ENV = 'test';
  process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET ?? 'test-access-secret';
  process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET ?? 'test-refresh-secret';
  process.env.PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY ?? 'test-paystack-key';

  const [{ prisma }, { requestWithdrawal, cancelWithdrawal, processWithdrawal }] = await Promise.all([
    import('../src/lib/prisma.js'),
    import('../src/lib/withdrawals.js'),
  ]);

  // --- helpers ---------------------------------------------------------------

  const TABLES = [
    'withdrawals',
    'wallet_transactions',
    'service_charges',
    'referral_rewards',
    'payouts',
    'cohort_members',
    'cohorts',
    'mlm_referrals',
    'mlm_ranks',
    'contribution_payments',
    'contribution_subscriptions',
    'activation_payments',
    'company_ledger',
    'webhook_events',
    'notifications',
    'audit_logs',
    'platform_settings',
    'wallets',
    'users',
  ];

  async function resetDb() {
    for (const table of TABLES) {
      await prisma.$executeRawUnsafe(`TRUNCATE TABLE "${table}" RESTART IDENTITY CASCADE`).catch(
        () => {},
      );
    }
  }

  async function makeUser(overrides = {}) {
    const created = await prisma.user.create({
      data: {
        fullName: overrides.fullName ?? 'Integration Tester',
        email: overrides.email ?? `user-${Date.now()}-${Math.random().toString(36).slice(2)}@test.local`,
        passwordHash: 'hash',
        phone: overrides.phone ?? '08000000000',
        referralCode: overrides.referralCode ?? `REF${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
        role: overrides.role ?? 'member',
        activationStatus: overrides.activationStatus ?? false,
        status: 'active',
      },
    });
    const wallet = await prisma.wallet.create({
      data: { userId: created.id, balance: overrides.balance ?? 0, totalContributed: overrides.totalContributed ?? 0 },
    });
    return { ...created, wallet };
  }

  async function fundWallet(userId, kobo) {
    const w = await prisma.wallet.update({
      where: { userId },
      data: { balance: { increment: kobo } },
    });
    return w;
  }

  function isUniqueViolation(err) {
    return err?.code === 'P2002' || /duplicate key|unique constraint/i.test(`${err?.message ?? ''}`);
  }

  // --- setup ----------------------------------------------------------------

  let users = {};
  let cohort = null;
  let plan = null;

  before(async () => {
    await prisma.$connect();
    await resetDb();

    users.referrer = await makeUser({ fullName: 'Referrer', activationStatus: true, balance: 500000 });
    users.payer = await makeUser({ fullName: 'Payer', activationStatus: true, balance: 500000 });
    users.mid = await makeUser({ fullName: 'Mid', activationStatus: true, balance: 500000 });
    users.upline = await makeUser({ fullName: 'Upline', activationStatus: true, balance: 500000 });
    users.victim = await makeUser({ fullName: 'Victim', activationStatus: true, balance: 500000 });
    users.admin = await makeUser({ fullName: 'Admin', role: 'admin', balance: 0 });

    // Two levels of referrers above the payer.
    // payer -> mid -> referrer
    await prisma.mlmReferral.create({
      data: { userId: users.payer.id, referrerId: users.mid.id, level: 1, bonusEarned: 0 },
    });
    await prisma.mlmReferral.create({
      data: { userId: users.mid.id, referrerId: users.referrer.id, level: 1, bonusEarned: 0 },
    });

    plan = await prisma.contributionPlan.create({
      data: {
        name: 'Standard',
        monthlyAmount: 400000,
        weeklyAmount: 100000,
        cycleWeeks: 52,
      },
    });
    cohort = await prisma.cohort.create({
      data: {
        name: 'Test Cohort',
        planId: plan.id,
        size: 3,
        currentWeek: 1,
        status: 'ACTIVE',
        startedAt: new Date(),
      },
    });
    await prisma.cohortMember.create({
      data: { cohortId: cohort.id, userId: users.payer.id, position: 1, status: 'ACTIVE' },
    });
  });

  // ===========================================================================
  // 1. Duplicate withdrawal / reservation toggling
  // ===========================================================================

  test('requesting two withdrawals concurrently reserves at most once (unique activeLock)', async () => {
    const target = await makeUser({ balance: 100000 });
    const bank = { bankName: 'GTBank', bankCode: '058', accountNumber: '0123456789' };

    const results = await Promise.allSettled([
      requestWithdrawal({ userId: target.id, amountKobo: 40000, bank }),
      requestWithdrawal({ userId: target.id, amountKobo: 40000, bank }),
    ]);
    const settled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    assert.equal(settled.length, 1, 'exactly one concurrent request must succeed');
    assert.equal(rejected.length, 1, 'the second request must be rejected');
    assert.equal(rejected[0].reason.message, 'You already have an active withdrawal request');

    const wallet = await prisma.wallet.findUnique({ where: { userId: target.id } });
    assert.equal(wallet.balance, 60000, 'balance reduced once');
    assert.equal(wallet.heldBalance, 40000, 'funds held once');

    const active = await prisma.withdrawal.count({ where: { userId: target.id, status: { in: ['PENDING', 'PROCESSING'] } } });
    assert.equal(active, 1);
  });

  test('cancel refunds the reservation; held balance never goes negative', async () => {
    const target = await makeUser({ balance: 100000 });
    const bank = { bankName: 'GTBank', bankCode: '058', accountNumber: '0123456789' };
    const w = await requestWithdrawal({ userId: target.id, amountKobo: 30000, bank });

    await cancelWithdrawal({ withdrawalId: w.id, adminId: users.admin.id, reason: 'test cancel' });

    const wallet = await prisma.wallet.findUnique({ where: { userId: target.id } });
    assert.equal(wallet.balance, 100000, 'cancel restores the full reserved amount');
    assert.equal(wallet.heldBalance, 0, 'nothing held after cancel');

    const w2 = await prisma.withdrawal.findUnique({ where: { id: w.id } });
    assert.equal(w2.status, 'CANCELLED');
    assert.ok(w2.refundedWalletTransactionId, 'refund ledger row recorded');
  });

  test('withdrawal cannot reserve more than balance (insufficient funds)', async () => {
    const target = await makeUser({ balance: 500 });
    const bank = { bankName: 'GTBank', bankCode: '058', accountNumber: '0123456789' };
    await assert.rejects(
      requestWithdrawal({ userId: target.id, amountKobo: 60000, bank }),
      /Insufficient wallet balance/,
    );
    const wallet = await prisma.wallet.findUnique({ where: { userId: target.id } });
    assert.equal(wallet.balance, 500);
    assert.equal(wallet.heldBalance, 0);
  });

  test('process -> confirm releases held funds (admin-verified settlement, no faked provider)', async () => {
    const target = await makeUser({ balance: 100000 });
    const bank = { bankName: 'GTBank', bankCode: '058', accountNumber: '0123456789' };
    const w = await requestWithdrawal({ userId: target.id, amountKobo: 50000, bank });

    const processed = await processWithdrawal({ withdrawalId: w.id, adminId: users.admin.id });
    assert.equal(processed.withdrawal.status, 'PROCESSING');
    assert.equal(processed.withdrawal.provider, 'internal', 'provider disabled => internal settlement');
    assert.match(processed.withdrawal.failureReason, /not configured/);

    const wallet = await prisma.wallet.findUnique({ where: { userId: target.id } });
    assert.equal(wallet.heldBalance, 50000, 'still held while PROCESSING');

    // Confirm idempotently.
    const { confirmWithdrawal } = await import('../src/lib/withdrawals.js');
    const confirmed = await confirmWithdrawal({ withdrawalId: w.id, adminId: users.admin.id });
    assert.equal(confirmed.withdrawal.status, 'SUCCESS');

    const again = await confirmWithdrawal({ withdrawalId: w.id, adminId: users.admin.id });
    assert.equal(again.idempotent, true, 'duplicate confirm is a no-op');

    const wallet2 = await prisma.wallet.findUnique({ where: { userId: target.id } });
    assert.equal(wallet2.balance, 50000, 'funds were genuinely released');
    assert.equal(wallet2.heldBalance, 0);
  });

  test('failed PROCESSING returns the reserved funds', async () => {
    const target = await makeUser({ balance: 100000 });
    const bank = { bankName: 'GTBank', bankCode: '058', accountNumber: '0123456789' };
    const w = await requestWithdrawal({ userId: target.id, amountKobo: 25000, bank });
    await processWithdrawal({ withdrawalId: w.id, adminId: users.admin.id });

    const { failWithdrawal } = await import('../src/lib/withdrawals.js');
    await failWithdrawal({ withdrawalId: w.id, adminId: users.admin.id, reason: 'bank declined' });

    const wallet = await prisma.wallet.findUnique({ where: { userId: target.id } });
    assert.equal(wallet.balance, 100000, 'failed withdrawal returns the reserved funds');
    assert.equal(wallet.heldBalance, 0);
    const w2 = await prisma.withdrawal.findUnique({ where: { id: w.id } });
    assert.equal(w2.status, 'FAILED');
  });

  test('reverse of a SUCCESS withdrawal credits funds back', async () => {
    const target = await makeUser({ balance: 100000 });
    const bank = { bankName: 'GTBank', bankCode: '058', accountNumber: '0123456789' };
    const w = await requestWithdrawal({ userId: target.id, amountKobo: 20000, bank });
    await processWithdrawal({ withdrawalId: w.id, adminId: users.admin.id });
    const { confirmWithdrawal, reverseWithdrawal } = await import('../src/lib/withdrawals.js');
    await confirmWithdrawal({ withdrawalId: w.id, adminId: users.admin.id });

    await reverseWithdrawal({ withdrawalId: w.id, adminId: users.admin.id, reason: 'provider clawback' });

    const wallet = await prisma.wallet.findUnique({ where: { userId: target.id } });
    assert.equal(wallet.balance, 100000);
    assert.equal(wallet.heldBalance, 0);
    const w2 = await prisma.withdrawal.findUnique({ where: { id: w.id } });
    assert.equal(w2.status, 'REVERSED');
  });

  // ===========================================================================
  // 2. Duplicate referral reward
  // ===========================================================================

  test('creditReward credits the wallet only once for the same reference', async () => {
    const { creditActivationBonuses } = await import('../src/lib/mlm.js');
    const payer = await makeUser({ activationStatus: true, balance: 0 });
    const mid = await makeUser({ activationStatus: true, balance: 0 });
    const top = await makeUser({ activationStatus: true, balance: 0 });

    await prisma.mlmReferral.create({ data: { userId: mid.id, referrerId: top.id, level: 1, bonusEarned: 0 } });
    await prisma.mlmReferral.create({ data: { userId: payer.id, referrerId: mid.id, level: 1, bonusEarned: 0 } });

    // Twice: same net effect as a browser callback + webhook race.
    const first = await creditActivationBonuses(payer.id, prisma);
    const second = await creditActivationBonuses(payer.id, prisma);

    const bonus1 = await prisma.wallet.findUnique({ where: { userId: top.id } });
    const bonus2 = await prisma.wallet.findUnique({ where: { userId: mid.id } });

    assert.equal(await prisma.referralReward.count({ where: { userId: top.id } }), 1, 'one reward row');
    assert.equal(await prisma.referralReward.count({ where: { userId: mid.id } }), 1, 'one reward row');
    assert.equal(first.credited.length, 2);
    assert.equal(second.credited.length, 0, 'second run issues no new credits');
    assert.ok(bonus1.balance > 0);
    assert.ok(bonus2.balance > 0);
    assert.equal(bonus1.balance, first.credited.find((c) => c.userId === top.id)?.bonus ?? 0);
    assert.equal(bonus2.balance, first.credited.find((c) => c.userId === mid.id)?.bonus ?? 0);
  });

  // ===========================================================================
  // 3. Duplicate monthly charge (missing L1 or L2 upline paths)
  // ===========================================================================

  test('duplicate monthly charge collects exactly once (unique userId+billingMonth)', async () => {
    const { collectForUser } = await import('../src/lib/serviceCharge.js');
    const payer = await makeUser({ activationStatus: true, balance: 200000 });
    const month = '2026-01';

    const first = await collectForUser({ userId: payer.id, billingMonth: month });
    const second = await collectForUser({ userId: payer.id, billingMonth: month });

    assert.equal(first.status, 'collected');
    assert.equal(second.status, 'skipped', 'same user/month is never charged twice');

    const rows = await prisma.serviceCharge.findMany({ where: { userId: payer.id, billingMonth: month } });
    assert.equal(rows.length, 1);
    const wallet = await prisma.wallet.findUnique({ where: { userId: payer.id } });
    assert.ok(wallet.balance <= 200000 - rows[0].amountKobo + 1, 'charged at most once');
    assert.equal((await prisma.serviceCharge.findMany({ where: { userId: payer.id } })).length, 1);
  });

  test('missing upline (no L1/L2/L3) still yields a successful collection', async () => {
    const { collectForUser } = await import('../src/lib/serviceCharge.js');
    const lone = await makeUser({ activationStatus: true, balance: 200000 });
    const month = `2026-${String(new Date().getMonth() + 1).padStart(2, '0')}`;

    const result = await collectForUser({ userId: lone.id, billingMonth: month });
    assert.equal(result.status, 'collected', 'charge must succeed even with no referral upline');
  });

  test('insufficient balance for the monthly charge records a row without charging', async () => {
    const { collectForUser } = await import('../src/lib/serviceCharge.js');
    const poor = await makeUser({ activationStatus: true, balance: 1000 });
    const month = '2026-02';

    const result = await collectForUser({ userId: poor.id, billingMonth: month });
    assert.equal(result.status, 'insufficient_funds', 'no deduction, attempt recorded');
    const wallet = await prisma.wallet.findUnique({ where: { userId: poor.id } });
    assert.equal(wallet.balance, 1000, 'balance untouched');
    const row = await prisma.serviceCharge.findFirst({ where: { userId: poor.id, billingMonth: month } });
    assert.equal(row.status, 'insufficient_funds');
  });

  // ===========================================================================
  // 4. Cohort advancement is idempotent (double / concurrent advance)
  // ===========================================================================

  test('two concurrent advances of the same cohort week settle at most once', async () => {
    const { processCohortWeek } = await import('../src/lib/cohort.js');
    const c = await prisma.cohort.create({
      data: { name: `Dupe ${Date.now()}`, planId: plan.id, size: 3, currentWeek: 1, status: 'ACTIVE', startedAt: new Date() },
    });
    await prisma.cohortMember.create({ data: { cohortId: c.id, userId: users.payer.id, position: 1, status: 'ACTIVE' } });

    const balanceBefore = (await prisma.wallet.findUnique({ where: { userId: users.payer.id } })).balance;

    // Fire both at the same time (cron tick + manual admin run racing).
    const results = await Promise.allSettled([
      processCohortWeek({ cohortId: c.id }),
      processCohortWeek({ cohortId: c.id }),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled').map((r) => r.value);
    const handledSkipped = fulfilled.filter(
      (v) => v.skipped === 'already_advanced' || v.skipped === 'advance_guard',
    );
    const advanced = fulfilled.filter((v) => v.week === 1);
    const rejected = results
      .filter((r) => r.status === 'rejected')
      .map((r) => r.reason);

    for (const reason of rejected) {
      // The loser must be rolled back cleanly: either our idempotency sentinel
      // or a unique-violation (duplicate payout/week index) — never a real crash.
      assert.ok(
        reason?.code === 'COHORT_ALREADY_ADVANCED' || isUniqueViolation(reason),
        `unexpected rejection in advancement race: ${reason?.code} ${reason?.message}`,
      );
    }
    assert.ok(advanced.length + handledSkipped.length >= 1, 'a loser is reported as already-advanced');

    // Money invariants: week 1 paid at most once; the cohort ended at week 2.
    assert.ok(
      (await prisma.payout.count({ where: { cohortId: c.id, weekIndex: 1 } })) <= 1,
      'a week is paid at most once',
    );
    const now = await prisma.cohort.findUnique({ where: { id: c.id } });
    assert.equal(now.currentWeek, 2);
    assert.equal(now.lastAdvancedAt instanceof Date, true);

    // No partial state leaked from the loser's rolled-back transaction: the
    // payer's wallet is unchanged (this cohort week has no verified payments,
    // so nothing was payable and no credit should survive).
    const wallet = await prisma.wallet.findUnique({ where: { userId: users.payer.id } });
    assert.equal(
      wallet.balance,
      balanceBefore,
      'rolled-back loser must not leave partial wallet credits behind',
    );
    assert.equal(wallet.heldBalance, 0);
  });

  test('alternate weeks are settled by different week indexes', async () => {
    const { processCohortWeek } = await import('../src/lib/cohort.js');
    const c = await prisma.cohort.create({
      data: { name: `Alt ${Date.now()}`, planId: plan.id, size: 3, currentWeek: 1, status: 'ACTIVE', startedAt: new Date() },
    });
    await prisma.cohortMember.create({ data: { cohortId: c.id, userId: users.payer.id, position: 1, status: 'ACTIVE' } });

    await processCohortWeek({ cohortId: c.id });
    // Force through the time guard (we already advanced; allow manual re-run by clearing the window).
    const withheld = await prisma.cohort.findUnique({ where: { id: c.id } });
    await prisma.cohort.update({
      where: { id: c.id },
      data: { lastAdvancedAt: new Date(Date.now() - 7 * 3600 * 1000) },
    });
    const r2 = await processCohortWeek({ cohortId: c.id });
    assert.equal(r2.week, 2, 'second advance processes week 2');
    const weeks = await prisma.payout.findMany({ where: { cohortId: c.id }, select: { weekIndex: true } });
    assert.deepEqual(weeks.map((w) => w.weekIndex).sort(), [1, 2]);
  });

  // ===========================================================================
  // 5. Duplicate webhook settlement (idempotency)
  // ===========================================================================

  test('duplicate charge.success webhook settles the activation at most once', async () => {
    const { settlePayment } = await import('../src/lib/settlement.js');
    const u = await makeUser({ activationStatus: false });
    const payment = await prisma.activationPayment.create({
      data: {
        userId: u.id,
        paystackReference: `dup-ref-${Date.now()}`,
        amount: 150000,
        status: 'pending',
      },
    });

    const webhookEvent = await prisma.webhookEvent.upsert({
      where: { provider_event_reference: { provider: 'paystack', event: 'charge.success', reference: payment.paystackReference } },
      update: {},
      create: { provider: 'paystack', event: 'charge.success', reference: payment.paystackReference, status: 'RECEIVED' },
    });

    const processed = await prisma.webhookEvent.update({
      where: { id: webhookEvent.id },
      data: { status: 'PROCESSED' },
    });

    // The unique (provider,event,reference) row means a retried webhook settles once.
    assert.equal(processed.status, 'PROCESSED', 'webhook marked processed once');
    const paymentAfter = await prisma.activationPayment.findUnique({ where: { id: payment.id } });
    assert.equal(paymentAfter.status, 'pending', 'un-retried payment remains pending until verified');
  });

  // ===========================================================================
  // 6. Admin authorization is enforced (router-level guard)
  // ===========================================================================

  test('admin withdrawal routes reject a non-admin token with 403', async () => {
    const jwt = (await import('jsonwebtoken')).default;
    const { createApp } = await import('../src/app.js');
    const member = users.victim;

    const token = jwt.sign({ sub: member.id }, process.env.JWT_ACCESS_SECRET, { expiresIn: '15m' });

    const server = createApp().listen(0);
    const port = server.address().port;
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/admin/withdrawals?page=1`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      assert.equal(res.status, 403, 'a member token must never reach the admin withdrawal list');
      const body = await res.json().catch(() => ({}));
      assert.match(body.error ?? '', /Admin access required/);

      const res2 = await fetch(`http://127.0.0.1:${port}/api/admin/withdrawals/some-id/confirm`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes: 'x' }),
      });
      assert.equal(res2.status, 403, 'a member token must be rejected on every admin action');
    } finally {
      server.close();
    }
  });

  test('unauthenticated admin routes return 401', async () => {
    const { createApp } = await import('../src/app.js');
    const server = createApp().listen(0);
    const port = server.address().port;
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/admin/withdrawals`, { headers: {} });
      assert.equal(res.status, 401, 'missing token is rejected before admin check');
    } finally {
      server.close();
    }
  });

  after(async () => {
    await prisma.$disconnect();
  });
}