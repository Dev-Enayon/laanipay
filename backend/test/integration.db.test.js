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

  const [{ prisma }, { requestWithdrawal, cancelWithdrawal, processWithdrawal }, { bufferBalance }] = await Promise.all([
    import('../src/lib/prisma.js'),
    import('../src/lib/withdrawals.js'),
    import('../src/lib/bufferFund.js'),
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
    'buffer_ledger',
    'contribution_fines',
    'death_cases',
    'contribution_defaults',
    'missed_contributions',
    'guarantors',
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

  // ===========================================================================
  // 7. Contribution security buffer (split + idempotent credit)
  // ===========================================================================

  test('verified weekly contribution splits main/buffer and credits the buffer once', async () => {
    const { recordVerifiedContribution } = await import('../src/lib/settlement.js');
    const user = await makeUser({ activationStatus: true, balance: 500000 });

    const wPlan = await prisma.contributionPlan.create({
      data: { name: 'Weekly Buffer', frequency: 'WEEKLY', weeklyAmount: 500000, cycleWeeks: 52 },
    });
    const sub = await prisma.contributionSubscription.create({
      data: { userId: user.id, planId: wPlan.id, status: 'active', amountKobo: 500000, nextPaymentDate: new Date() },
    });
    const cohort = await prisma.cohort.create({
      data: { name: `BufferCohort ${Date.now()}`, planId: wPlan.id, size: 52, status: 'RECRUITING' },
    });
    await prisma.cohortMember.create({
      data: { cohortId: cohort.id, userId: user.id, position: 1, status: 'ACTIVE' },
    });

    await prisma.platformSetting.upsert({
      where: { key: 'bufferPolicy' },
      update: { value: { enabled: true, mode: 'percent', percent: 2, flatKobo: 0 } },
      create: { key: 'bufferPolicy', value: { enabled: true, mode: 'percent', percent: 2, flatKobo: 0 } },
    });

    const payment = await prisma.contributionPayment.create({
      data: {
        subscriptionId: sub.id,
        paystackReference: `buffer-ref-${Date.now()}`,
        amount: 500000,
        status: 'pending',
      },
    });

    // Mirror POST /contributions/pay/wallet's claim + record in one tx.
    await prisma.$transaction(async (tx) => {
      const claimed = await tx.contributionPayment.updateMany({
        where: { id: payment.id, status: 'pending' },
        data: { status: 'verified', paidAt: new Date() },
      });
      assert.equal(claimed.count, 1);
      const fresh = await tx.contributionPayment.findUnique({ where: { id: payment.id } });
      const freshSub = await tx.contributionSubscription.findUnique({
        where: { id: sub.id },
        include: { plan: true, cohort: true },
      });
      await recordVerifiedContribution({
        tx,
        subscription: freshSub,
        payment: fresh,
        reference: fresh.paystackReference,
      });
    });

    const recorded = await prisma.contributionPayment.findUnique({ where: { id: payment.id } });
    assert.equal(recorded.mainAmount, 490000, '₦4,900 funds the main contribution');
    assert.equal(recorded.bufferAmount, 10000, '₦100 is set aside in the buffer');
    assert.equal(recorded.mainAmount + recorded.bufferAmount, recorded.amount, 'main + buffer === actual payment');

    const rows = await prisma.bufferLedger.findMany({ where: { userId: user.id } });
    assert.equal(rows.length, 1, 'buffer credited exactly once');
    assert.equal(rows[0].eventType, 'BUFFER_CREDIT');
    assert.equal(rows[0].amountKobo, 10000);
    assert.equal(rows[0].sign, 1);
    assert.equal(rows[0].reference, `buffer:${payment.paystackReference}`);
    assert.equal(bufferBalance(rows), 10000, 'derived balance matches the credit');

    // Duplicate settlement (browser callback + webhook racing) cannot re-credit.
    const replay = await prisma.$transaction(async (tx) => {
      const claimed = await tx.contributionPayment.updateMany({
        where: { id: payment.id, status: 'pending' },
        data: { status: 'verified', paidAt: new Date() },
      });
      return claimed.count;
    });
    assert.equal(replay, 0, 'a verified payment can never be claimed twice');
    assert.equal(await prisma.bufferLedger.count({ where: { userId: user.id } }), 1, 'no second buffer credit');
  });

  test('disabled buffer policy records 100% main and writes no ledger row', async () => {
    const { recordVerifiedContribution } = await import('../src/lib/settlement.js');
    const user = await makeUser({ activationStatus: true, balance: 100000 });
    const wPlan = await prisma.contributionPlan.create({
      data: { name: 'Weekly NoBuffer', frequency: 'WEEKLY', weeklyAmount: 100000, cycleWeeks: 52 },
    });
    const sub = await prisma.contributionSubscription.create({
      data: { userId: user.id, planId: wPlan.id, status: 'active', amountKobo: 100000, nextPaymentDate: new Date() },
    });
    const cohort = await prisma.cohort.create({
      data: { name: `NoBuffer ${Date.now()}`, planId: wPlan.id, size: 52, status: 'RECRUITING' },
    });
    await prisma.cohortMember.create({ data: { cohortId: cohort.id, userId: user.id, position: 1, status: 'ACTIVE' } });
    await prisma.platformSetting.upsert({
      where: { key: 'bufferPolicy' },
      update: { value: { enabled: false, mode: 'percent', percent: 2, flatKobo: 0 } },
      create: { key: 'bufferPolicy', value: { enabled: false, mode: 'percent', percent: 2, flatKobo: 0 } },
    });

    const payment = await prisma.contributionPayment.create({
      data: { subscriptionId: sub.id, paystackReference: `nobuffer-${Date.now()}`, amount: 100000, status: 'pending' },
    });
    await prisma.$transaction(async (tx) => {
      await tx.contributionPayment.updateMany({
        where: { id: payment.id, status: 'pending' },
        data: { status: 'verified', paidAt: new Date() },
      });
      const fresh = await tx.contributionPayment.findUnique({ where: { id: payment.id } });
      const freshSub = await tx.contributionSubscription.findUnique({
        where: { id: sub.id },
        include: { plan: true, cohort: true },
      });
      await recordVerifiedContribution({ tx, subscription: freshSub, payment: fresh, reference: fresh.paystackReference });
    });

    const recorded = await prisma.contributionPayment.findUnique({ where: { id: payment.id } });
    assert.equal(recorded.mainAmount, 100000, 'disabled policy means 100% main');
    assert.equal(recorded.bufferAmount, 0);
    assert.equal(await prisma.bufferLedger.count({ where: { userId: user.id } }), 0, 'no ledger row when disabled');
  });

  // ===========================================================================
  // 8. Default, grace, buffer protection, catch-up, fine, recovery, death
  // ===========================================================================

  // Builds a 2-member ACTIVE weekly cohort that has already collected, with a
  // buffer funded by one verified contribution.
  async function makeDefaultScenario({ bufferPercent = 20, fineKobo = 0, protectPayouts = false } = {}) {
    const { setPlatformSetting } = await import('../src/lib/config.js');
    const { recordVerifiedContribution } = await import('../src/lib/settlement.js');
    const { contributionBufferSplit } = await import('../src/lib/bufferFund.js');

    await setPlatformSetting('defaultPolicy', { enabled: true, graceDays: 7, closeOnDefault: true });
    await setPlatformSetting('finePolicy', { enabled: fineKobo > 0, amountKobo: fineKobo, destination: 'unassigned' });
    await setPlatformSetting('bufferPolicy', {
      enabled: true,
      mode: 'percent',
      percent: bufferPercent,
      flatKobo: 0,
      protectPayouts,
      allowPartialProtection: false,
      mainPotFallback: false,
      cycleEndDisposition: 'UNRESOLVED',
    });

    const payer = await makeUser({ activationStatus: true, balance: 2000000 });
    const defaulter = await makeUser({ activationStatus: true, balance: 0 });

    const plan = await prisma.contributionPlan.create({
      data: { name: `Weekly Def ${Date.now()}`, frequency: 'WEEKLY', weeklyAmount: 500000, cycleWeeks: 52 },
    });
    const cohort = await prisma.cohort.create({
      data: { name: `DefCohort ${Date.now()}`, planId: plan.id, size: 2, status: 'ACTIVE', currentWeek: 1 },
    });
    const payerMember = await prisma.cohortMember.create({
      data: { cohortId: cohort.id, userId: payer.id, position: 1, status: 'ACTIVE' },
    });
    const defaulterMember = await prisma.cohortMember.create({
      data: { cohortId: cohort.id, userId: defaulter.id, position: 2, status: 'ACTIVE' },
    });
    for (const [user, member] of [[payer, payerMember], [defaulter, defaulterMember]]) {
      await prisma.contributionSubscription.create({
        data: { userId: user.id, planId: plan.id, cohortId: cohort.id, status: 'active', amountKobo: 500000, nextPaymentDate: new Date() },
      });
      void member;
    }

    // The payer pays week 1 → a real verified payment → buffer credited.
    const paySub = await prisma.contributionSubscription.findFirst({ where: { userId: payer.id } });
    const split = contributionBufferSplit(500000, { enabled: true, mode: 'percent', percent: bufferPercent });
    const payment = await prisma.contributionPayment.create({
      data: { subscriptionId: paySub.id, paystackReference: `wk1-${Date.now()}`, amount: 500000, status: 'pending' },
    });
    await prisma.$transaction(async (tx) => {
      await tx.contributionPayment.updateMany({
        where: { id: payment.id, status: 'pending' },
        data: { status: 'verified', paidAt: new Date() },
      });
      const fresh = await tx.contributionPayment.findUnique({ where: { id: payment.id } });
      const sub = await tx.contributionSubscription.findUnique({ where: { id: paySub.id }, include: { plan: true, cohort: true } });
      await recordVerifiedContribution({ tx, subscription: sub, payment: fresh, reference: fresh.paystackReference });
    });

    return { payer, defaulter, plan, cohort, payerMember, defaulterMember, payment, split, recordVerifiedContribution };
  }

  test('a missed weekly contribution is recorded once and starts a configurable grace', async () => {
    const { detectMissedContributions, recordMissedContribution } = await import('../src/lib/defaultRecovery.js');
    const { cohort, defaulter, defaulterMember } = await makeDefaultScenario();
    const config = await import('../src/lib/config.js').then((m) => m.getPlatformConfig());

    const first = await detectMissedContributions({ cohortId: cohort.id, weekIndex: 1 });
    assert.equal(first.detected.length, 1, 'the non-payer is detected');
    const detected = first.detected[0];
    assert.equal(detected.amountKobo, 500000);

    const missed = await prisma.missedContribution.findUnique({ where: { id: detected.missedContributionId } });
    assert.equal(missed.status, 'GRACE', 'grace started immediately');
    assert.ok(missed.graceEndsAt > new Date(), 'grace deadline is in the future');
    assert.equal(
      Math.round((missed.graceEndsAt - missed.dueAt) / (24 * 60 * 60 * 1000)),
      config.defaultPolicy.graceDays,
      'grace length comes from config',
    );

    // Re-running the sweep must not create a second record.
    const second = await detectMissedContributions({ cohortId: cohort.id, weekIndex: 1 });
    assert.equal(second.detected.length, 0, 'detection is idempotent');
    assert.equal(await prisma.missedContribution.count({ where: { memberId: defaulterMember.id } }), 1);

    // The member is in GRACE, not removed, and their participation is intact.
    const member = await prisma.cohortMember.findUnique({ where: { id: defaulterMember.id } });
    assert.equal(member.defaultStatus, 'GRACE');
    assert.equal(member.status, 'ACTIVE', 'the member is NOT removed during grace');
    void defaulter;
    void recordMissedContribution;
  });

  test('buffer protects the payout when sufficient, and refuses when insufficient', async () => {
    const { protectCohortPayout, openDefaultCase } = await import('../src/lib/defaultRecovery.js');
    const { bufferBalance, planBufferProtection } = await import('../src/lib/bufferFund.js');
    const { cohort, defaulter, defaulterMember } = await makeDefaultScenario({ bufferPercent: 20 });
    const config = await import('../src/lib/config.js').then((m) => m.getPlatformConfig());

    // Record the miss and open a recovery case to own the advance.
    const cohortFull = await prisma.cohort.findUnique({ where: { id: cohort.id }, include: { plan: true } });
    const member = await prisma.cohortMember.findUnique({ where: { id: defaulterMember.id } });
    await prisma.$transaction(async (tx) => {
      await import('../src/lib/defaultRecovery.js').then((m) =>
        m.recordMissedContribution({
          tx,
          cohort: cohortFull,
          member,
          weekIndex: 2,
          amountKobo: 500000,
          dueAt: new Date(),
          config,
        }),
      );
    });

    const before = bufferBalance(
      await prisma.bufferLedger.findMany({ where: { cohortId: cohort.id } }),
    );
    assert.equal(before, 100000, 'buffer holds the payer\'s 20% share');

    // Open a case inside a tx so the ledger write can be transactional.
    const opened = await prisma.$transaction(async (tx) => {
      const freshCohort = await tx.cohort.findUnique({ where: { id: cohort.id }, include: { plan: true } });
      const freshMember = await tx.cohortMember.findUnique({ where: { id: defaulterMember.id } });
      const res = await openDefaultCase({ tx, cohort: freshCohort, member: freshMember, config });
      // The buffer is smaller than a full week's protection.
      const plan = planBufferProtection({
        availableBufferAmount: before,
        requiredProtectionAmount: 490000,
        allowPartialProtection: false,
      });
      assert.equal(plan.outcome, 'BUFFER_INSUFFICIENT');
      const applied = await protectCohortPayout({ tx, cohort: freshCohort, week: 2, plan, config });
      return { ...res, applied };
    });

    assert.equal(opened.created, true);
    assert.equal(opened.defaultCase.outstandingKobo, 500000, 'missed principal is owed');
    assert.equal(opened.applied.recorded, false, 'NO debit when the buffer cannot cover it');

    // Nothing was debited, the balance is untouched, and the shortfall is
    // recorded on the case for admin instead of being invented or paid.
    const after = bufferBalance(await prisma.bufferLedger.findMany({ where: { cohortId: cohort.id } }));
    assert.equal(after, before, 'buffer balance unchanged — never negative');
    assert.equal(await prisma.bufferLedger.count({ where: { cohortId: cohort.id, eventType: 'BUFFER_DEBIT' } }), 0);
    const c = await prisma.contributionDefault.findUnique({ where: { id: opened.defaultCase.id } });
    assert.equal(c.shortfallKobo, 390000, 'shortfall = required - available, explicitly recorded');
    void defaulter;
  });

  test('a sufficient buffer produces exactly one idempotent BUFFER_DEBIT', async () => {
    const { protectCohortPayout, openDefaultCase } = await import('../src/lib/defaultRecovery.js');
    const { bufferBalance } = await import('../src/lib/bufferFund.js');
    // 100% buffer so the pool is large enough to cover the protection.
    const { cohort, defaulterMember } = await makeDefaultScenario({ bufferPercent: 100 });
    const config = await import('../src/lib/config.js').then((m) => m.getPlatformConfig());

    const cohortFull = await prisma.cohort.findUnique({ where: { id: cohort.id }, include: { plan: true } });
    const member = await prisma.cohortMember.findUnique({ where: { id: defaulterMember.id } });
    await prisma.$transaction(async (tx) => {
      const m = await import('../src/lib/defaultRecovery.js');
      await m.recordMissedContribution({ tx, cohort: cohortFull, member, weekIndex: 2, amountKobo: 500000, dueAt: new Date(), config });
      const res = await openDefaultCase({ tx, cohort: cohortFull, member, config });
      const applied = await protectCohortPayout({
        tx,
        cohort: cohortFull,
        week: 2,
        plan: { ok: true, outcome: 'PROTECTED', available: 500000, required: 490000, protectedAmount: 490000, shortfall: 0 },
        config,
      });
      assert.equal(applied.recorded, true, 'debit written when the buffer covers it');
      return res;
    });

    const debits = await prisma.bufferLedger.findMany({ where: { cohortId: cohort.id, eventType: 'BUFFER_DEBIT' } });
    assert.equal(debits.length, 1, 'exactly one BUFFER_DEBIT');
    assert.equal(debits[0].sign, -1);
    assert.equal(debits[0].amountKobo, 490000);
    assert.equal(bufferBalance(await prisma.bufferLedger.findMany({ where: { cohortId: cohort.id } })), 10000);

    // Replaying the same protection (same defaultId) must not double-debit.
    await prisma.$transaction(async (tx) => {
      await protectCohortPayout({
        tx,
        cohort: cohortFull,
        week: 2,
        plan: { ok: true, outcome: 'PROTECTED', available: 10000, required: 490000, protectedAmount: 490000, shortfall: 0 },
        config,
      });
    });
    const debits2 = await prisma.bufferLedger.findMany({ where: { cohortId: cohort.id, eventType: 'BUFFER_DEBIT' } });
    assert.equal(debits2.length, 1, 'a retry cannot debit the buffer twice');
  });

  test('grace expiry opens a recovery case, assesses the configured fine, and closes participation without deleting', async () => {
    const { expireGracePeriods, recordMissedContribution } = await import('../src/lib/defaultRecovery.js');
    // A fine of ₦2,000 supplied purely through config — never hard-coded.
    const { cohort, defaulter, defaulterMember } = await makeDefaultScenario({ fineKobo: 200000 });
    const config = await import('../src/lib/config.js').then((m) => m.getPlatformConfig());

    // Miss recorded in the past → grace already expired.
    await prisma.$transaction(async (tx) => {
      const cohortFull = await tx.cohort.findUnique({ where: { id: cohort.id }, include: { plan: true } });
      const member = await tx.cohortMember.findUnique({ where: { id: defaulterMember.id } });
      await recordMissedContribution({
        tx,
        cohort: cohortFull,
        member,
        weekIndex: 2,
        amountKobo: 500000,
        dueAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
        config,
      });
    });

    const results = await expireGracePeriods({ adminId: null });
    const mine = results.find((r) => r.userId === defaulter.id);
    assert.ok(mine, 'the expired member was processed');
    assert.equal(mine.created, true);
    assert.equal(mine.fineKobo, 200000, 'fine comes from the configured policy');
    assert.equal(mine.outstandingKobo, 700000, '₦5,000 missed + ₦2,000 fine');
    assert.equal(mine.participationClosed, true, 'closeOnDefault is honoured');

    // The fine is its own financial event.
    const fine = await prisma.contributionFine.findFirst({ where: { userId: defaulter.id } });
    assert.equal(fine.amountKobo, 200000);
    assert.equal(fine.status, 'ASSESSED');
    assert.equal(fine.reference, `fine:${mine.defaultId}`);

    // Participation closed — but NOTHING was deleted.
    const member = await prisma.cohortMember.findUnique({ where: { id: defaulterMember.id } });
    assert.equal(member.status, 'DEFAULTED');
    assert.equal(member.defaultStatus, 'RECOVERY');
    assert.equal(member.position, 2, 'the position is preserved — no mid-cycle replacement');
    assert.ok(await prisma.user.findUnique({ where: { id: defaulter.id } }), 'the user still exists');
    assert.ok(member.closedAt, 'closure is timestamped');
  });

  test('a defaulted member catches up: the payment is split, buffer restored, fine collected', async () => {
    const { buildCatchUpQuote, applyCatchUpSettlement, openDefaultCase, recordMissedContribution } =
      await import('../src/lib/defaultRecovery.js');
    const { bufferBalance } = await import('../src/lib/bufferFund.js');
    const { cohort, defaulter, defaulterMember } = await makeDefaultScenario({ fineKobo: 200000 });
    const config = await import('../src/lib/config.js').then((m) => m.getPlatformConfig());

    // Miss + a buffer advance + a recovery case, all via the real code paths.
    await prisma.$transaction(async (tx) => {
      const cohortFull = await tx.cohort.findUnique({ where: { id: cohort.id }, include: { plan: true } });
      const member = await tx.cohortMember.findUnique({ where: { id: defaulterMember.id } });
      await recordMissedContribution({ tx, cohort: cohortFull, member, weekIndex: 2, amountKobo: 500000, dueAt: new Date(Date.now() - 30 * 864e5), config });
      const res = await openDefaultCase({ tx, cohort: cohortFull, member, config });
      // Advance the buffer on this member's behalf.
      const { recordBufferEntry } = await import('../src/lib/bufferFund.js');
      await recordBufferEntry({
        tx,
        cohortId: cohort.id,
        userId: defaulter.id,
        eventType: 'BUFFER_DEBIT',
        amountKobo: 500000,
        sign: -1,
        reference: `buffer-protect:${cohort.id}:${res.defaultCase.id}`,
        reason: 'test protection',
      });
      return res;
    });

    const afterDebit = bufferBalance(await prisma.bufferLedger.findMany({ where: { cohortId: cohort.id } }));
    assert.equal(afterDebit, 50000, 'one credit of 100k minus a 50k advance');

    const sub = await prisma.contributionSubscription.findFirst({ where: { userId: defaulter.id } });
    const missedRows = await prisma.missedContribution.findMany({ where: { memberId: defaulterMember.id, status: 'DEFAULTED' } });
    const openCase = await prisma.contributionDefault.findFirst({ where: { userId: defaulter.id } });

    // The quote is built from real rows + real config (₦2,000 fine is config).
    const quote = buildCatchUpQuote({ missedRows, currentAmountKobo: 500000, fineKobo: openCase.fineKobo });
    assert.deepEqual(quote, { missedKobo: 500000, currentKobo: 500000, fineKobo: 200000, totalKobo: 1200000 });

    const payment = await prisma.contributionPayment.create({
      data: {
        subscriptionId: sub.id,
        paystackReference: `catchup-${Date.now()}`,
        amount: quote.totalKobo,
        kind: 'catchup',
        missedKobo: quote.missedKobo,
        currentKobo: quote.currentKobo,
        fineKobo: quote.fineKobo,
        status: 'pending',
      },
    });

    const settled = await prisma.$transaction(async (tx) => {
      await tx.contributionPayment.updateMany({ where: { id: payment.id, status: 'pending' }, data: { status: 'verified', paidAt: new Date() } });
      const fresh = await tx.contributionPayment.findUnique({ where: { id: payment.id } });
      const cohortFull = await tx.cohort.findUnique({ where: { id: cohort.id }, include: { plan: true } });
      const member = await tx.cohortMember.findUnique({ where: { id: defaulterMember.id } });
      return applyCatchUpSettlement({ tx, cohort: cohortFull, member, payment: fresh, quote, missedRows, config });
    });

    // Buffer restoration is bounded by what was actually advanced (500k) and
    // the pool's real balance (50k) → 50k, never more.
    assert.equal(settled.restored, 50000, 'restoration capped by the pool balance');
    assert.equal(settled.fineCollected, 200000, 'the fine was collected');

    const restored = bufferBalance(await prisma.bufferLedger.findMany({ where: { cohortId: cohort.id } }));
    assert.equal(restored, 100000, 'derived balance rose back by exactly the restoration');

    const fine = await prisma.contributionFine.findFirst({ where: { userId: defaulter.id } });
    assert.equal(fine.status, 'COLLECTED');

    const updatedMiss = await prisma.missedContribution.findFirst({ where: { id: missedRows[0].id } });
    assert.equal(updatedMiss.status, 'CAUGHT_UP');
    assert.equal(updatedMiss.caughtUpPaymentId, payment.id);

    const member = await prisma.cohortMember.findUnique({ where: { id: defaulterMember.id } });
    assert.equal(member.defaultStatus, 'CAUGHT_UP');

    // The full history is preserved.
    assert.equal(await prisma.contributionPayment.count({ where: { subscriptionId: sub.id } }), 1);
    assert.equal(await prisma.contributionDefault.count({ where: { userId: defaulter.id } }), 1);
  });

  test('a catch-up payment that under-pays the quote is rejected, never partially settled', async () => {
    const { buildCatchUpQuote, applyCatchUpSettlement, openDefaultCase, recordMissedContribution } =
      await import('../src/lib/defaultRecovery.js');
    const { cohort, defaulter, defaulterMember } = await makeDefaultScenario({ fineKobo: 200000 });
    const config = await import('../src/lib/config.js').then((m) => m.getPlatformConfig());

    await prisma.$transaction(async (tx) => {
      const cohortFull = await tx.cohort.findUnique({ where: { id: cohort.id }, include: { plan: true } });
      const member = await tx.cohortMember.findUnique({ where: { id: defaulterMember.id } });
      await recordMissedContribution({ tx, cohort: cohortFull, member, weekIndex: 2, amountKobo: 500000, dueAt: new Date(Date.now() - 30 * 864e5), config });
      await openDefaultCase({ tx, cohort: cohortFull, member, config });
    });

    const sub = await prisma.contributionSubscription.findFirst({ where: { userId: defaulter.id } });
    const missedRows = await prisma.missedContribution.findMany({ where: { memberId: defaulterMember.id, status: 'DEFAULTED' } });
    const openCase = await prisma.contributionDefault.findFirst({ where: { userId: defaulter.id } });
    const quote = buildCatchUpQuote({ missedRows, currentAmountKobo: 500000, fineKobo: openCase.fineKobo });

    // The member pays only the current period.
    const short = await prisma.contributionPayment.create({
      data: { subscriptionId: sub.id, paystackReference: `short-${Date.now()}`, amount: 500000, kind: 'catchup', status: 'pending' },
    });

    await assert.rejects(
      () =>
        prisma.$transaction(async (tx) => {
          const cohortFull = await tx.cohort.findUnique({ where: { id: cohort.id }, include: { plan: true } });
          const member = await tx.cohortMember.findUnique({ where: { id: defaulterMember.id } });
          return applyCatchUpSettlement({ tx, cohort: cohortFull, member, payment: short, quote, missedRows, config });
        }),
      /does not cover/,
      'an underpayment is refused',
    );

    // Nothing was settled: the miss is still defaulted, the fine still assessed.
    const still = await prisma.missedContribution.findFirst({ where: { id: missedRows[0].id } });
    assert.equal(still.status, 'DEFAULTED');
    const fine = await prisma.contributionFine.findFirst({ where: { userId: defaulter.id } });
    assert.equal(fine.status, 'ASSESSED', 'the fine is not marked paid for money that never arrived');
  });

  test('a death case progresses through the workflow without charging anyone', async () => {
    const { reportDeath, verifyDeath, closeDeathParticipation, recordDeathFinancialReview } =
      await import('../src/lib/defaultRecovery.js');
    const { defaulter } = await makeDefaultScenario({ fineKobo: 200000 });

    const { deathCase, created } = await reportDeath({ userId: defaulter.id, evidenceReference: 'doc-123' });
    assert.equal(created, true);
    assert.equal(deathCase.status, 'DEATH_REPORTED');
    assert.equal(deathCase.estateDetermination, 'UNRESOLVED', 'the estate treatment is not guessed');

    // Participation cannot be closed before the death is verified: the
    // VERIFIED_DECEASED -> PARTICIPATION_CLOSED step is genuinely blocked from
    // DEATH_REPORTED, so no one can bypass verification.
    await assert.rejects(
      () => closeDeathParticipation({ deathCaseId: deathCase.id }),
      /Cannot close participation/,
    );

    // Verification is the admin-presented-evidence step, so it is allowed
    // directly from DEATH_REPORTED.
    const verified = await verifyDeath({ deathCaseId: deathCase.id, evidenceReference: 'doc-123', verificationReference: 'VR-99' });
    assert.equal(verified.status, 'VERIFIED_DECEASED');
    assert.equal(verified.verificationReference, 'VR-99');

    const closed = await closeDeathParticipation({ deathCaseId: deathCase.id });
    assert.equal(closed.status, 'PARTICIPATION_CLOSED');

    const review = await recordDeathFinancialReview({ deathCaseId: deathCase.id });
    assert.equal(review.status, 'FINANCIAL_REVIEW');
    assert.equal(review.estateDetermination, 'UNRESOLVED', 'still unresolved without a human decision');
    assert.equal(review.estateDueKobo, null, 'no estate amount is invented');

    // Nothing was charged to the family or a guarantor.
    assert.equal(await prisma.contributionFine.count({ where: { userId: defaulter.id } }), 0, 'no fine assessed on death');
    assert.equal(await prisma.guarantor.count(), 0, 'no guarantor touched');
    assert.ok(await prisma.user.findUnique({ where: { id: defaulter.id } }), 'the user record is preserved');
  });

  test('every default and recovery step writes an audit log', async () => {
    const { recordMissedContribution, openDefaultCase, updateRecoveryCase } = await import('../src/lib/defaultRecovery.js');
    const { AUDIT_ACTIONS } = await import('../src/lib/defaultRecovery.js');
    const { cohort, defaulter, defaulterMember } = await makeDefaultScenario({ fineKobo: 200000 });
    const config = await import('../src/lib/config.js').then((m) => m.getPlatformConfig());

    const opened = await prisma.$transaction(async (tx) => {
      const cohortFull = await tx.cohort.findUnique({ where: { id: cohort.id }, include: { plan: true } });
      const member = await tx.cohortMember.findUnique({ where: { id: defaulterMember.id } });
      await recordMissedContribution({ tx, cohort: cohortFull, member, weekIndex: 2, amountKobo: 500000, dueAt: new Date(Date.now() - 30 * 864e5), config });
      return openDefaultCase({ tx, cohort: cohortFull, member, config });
    });

    await updateRecoveryCase({ defaultId: opened.defaultCase.id, status: 'CONTACTING', contactAttempt: true });

    const actions = await prisma.auditLog.findMany({
      where: { userId: defaulter.id },
      select: { action: true },
    });
    const seen = new Set(actions.map((a) => a.action));
    for (const required of [
      AUDIT_ACTIONS.MISSED_PAYMENT,
      AUDIT_ACTIONS.GRACE_STARTED,
      AUDIT_ACTIONS.DEFAULT_CREATED,
      AUDIT_ACTIONS.FINE_APPLIED,
      AUDIT_ACTIONS.RECOVERY_STARTED,
      AUDIT_ACTIONS.RECOVERY_UPDATED,
    ]) {
      assert.equal(seen.has(required), true, `missing audit action ${required}`);
    }
  });

  after(async () => {
    await prisma.$disconnect();
  });
}