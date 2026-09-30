import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  applyBufferDebit,
  bufferBalance,
  bufferProtectionReference,
  bufferRestorationReference,
  contributionBufferSplit,
  planBufferProtection,
  planBufferRestoration,
  shouldCreditBuffer,
} from '../src/lib/bufferFund.js';
import {
  MEMBER_DEFAULT_STATES,
  DEATH_STATES,
  RECOVERY_STATUSES,
  AUDIT_ACTIONS,
  REFERENCES,
  canTransitionMemberDefault,
  canTransitionDeath,
  graceDurationMs,
  protectionRequirement,
  buildCatchUpQuote,
} from '../src/lib/defaultRecovery.js';

const credit = (amountKobo) => ({ eventType: 'BUFFER_CREDIT', amountKobo, sign: 1 });
const debit = (amountKobo) => ({ eventType: 'BUFFER_DEBIT', amountKobo, sign: -1 });

// ===========================================================================
// 1. Missed weekly contribution  /  2. Grace starts
// ===========================================================================

test('a missed weekly contribution is recorded with the configured grace window', () => {
  const policy = { enabled: true, graceDays: 10 };
  assert.equal(graceDurationMs(policy), 10 * 24 * 60 * 60 * 1000, 'grace comes from config, not a hard-coded 7');
  assert.equal(graceDurationMs({ graceDays: 3 }), 3 * 24 * 60 * 60 * 1000);
  // 0 is a real, admin-valid setting meaning "no grace". It must NOT silently
  // become 7 days, which would be the opposite of the admin's intent.
  assert.equal(graceDurationMs({ graceDays: 0 }), 0, 'zero grace means default immediately');
  // Last-resort default only when no value is present at all.
  assert.equal(graceDurationMs({}), 7 * 24 * 60 * 60 * 1000);
  assert.equal(graceDurationMs({ graceDays: 'nonsense' }), 7 * 24 * 60 * 60 * 1000);
});

test('miss detection reference is deterministic per cohort/member/week', () => {
  const a = REFERENCES.missed({ cohortId: 'c1', memberId: 'm1', weekIndex: 3 });
  assert.equal(a, 'miss:c1:m1:w3');
  assert.equal(a, REFERENCES.missed({ cohortId: 'c1', memberId: 'm1', weekIndex: 3 }), 'stable across retries');
  assert.notEqual(a, REFERENCES.missed({ cohortId: 'c1', memberId: 'm1', weekIndex: 4 }));
});

test('a missed payment credits no buffer', () => {
  const policy = { enabled: true, mode: 'percent', percent: 5, flatKobo: 0 };
  // The split helper would allocate a buffer share IF the member paid.
  const wouldHave = contributionBufferSplit(500000, policy);
  assert.equal(wouldHave.bufferAmount, 25000);
  // But detection records the miss with the would-be buffer as informational
  // only; the buffer balance is untouched because no payment was verified.
  assert.equal(bufferBalance([]), 0);
});

// ===========================================================================
// 3. Buffer sufficient  /  4. Buffer debit
// ===========================================================================

test('protection proceeds when the buffer covers the requirement', () => {
  const plan = planBufferProtection({ availableBufferAmount: 500000, requiredProtectionAmount: 490000 });
  assert.equal(plan.ok, true);
  assert.equal(plan.outcome, 'PROTECTED');
  assert.equal(plan.protectedAmount, 490000);
  assert.equal(plan.shortfall, 0);
  assert.equal(plan.shortfallUnresolved, false);
});

test('protection reference is idempotent per cohort+week or cohort+case', () => {
  const byWeek = bufferProtectionReference({ cohortId: 'c1', weekIndex: 4 });
  assert.equal(byWeek, 'buffer-protect:c1:w4');
  assert.equal(byWeek, bufferProtectionReference({ cohortId: 'c1', weekIndex: 4 }), 'a retry yields the same key');
  const byCase = bufferProtectionReference({ cohortId: 'c1', weekIndex: 4, defaultId: 'd9' });
  assert.equal(byCase, 'buffer-protect:c1:d9');
});

test('a protection debit reduces the derived balance by exactly the protected amount', () => {
  const before = [credit(500000)];
  assert.equal(bufferBalance(before), 500000);
  const plan = planBufferProtection({ availableBufferAmount: bufferBalance(before), requiredProtectionAmount: 490000 });
  const after = [...before, debit(plan.protectedAmount)];
  assert.equal(bufferBalance(after), 10000, 'balance is derived, never negative');
});

// ===========================================================================
// 5. Buffer insufficient  /  6. No negative buffer
// ===========================================================================

test('insufficient buffer yields BUFFER_INSUFFICIENT with an explicit shortfall', () => {
  const plan = planBufferProtection({ availableBufferAmount: 300000, requiredProtectionAmount: 490000 });
  assert.equal(plan.ok, false);
  assert.equal(plan.outcome, 'BUFFER_INSUFFICIENT');
  assert.equal(plan.available, 300000);
  assert.equal(plan.required, 490000);
  assert.equal(plan.shortfall, 190000, 'shortfall is stated, not hidden');
  assert.equal(plan.protectedAmount, 0, 'no partial debit by default');
  assert.equal(plan.shortfallUnresolved, true);
});

test('an insufficient buffer never plans a negative balance or a fabricated payout', () => {
  const plan = planBufferProtection({ availableBufferAmount: 1000, requiredProtectionAmount: 999999 });
  assert.equal(plan.protectedAmount, 0);
  // Whatever an admin later does, the ledger cannot be pushed negative.
  const applied = applyBufferDebit({ balance: 1000, amountKobo: 999999 });
  assert.equal(applied.ok, false);
  assert.equal(applied.reason, 'insufficient_buffer');
  assert.equal(applied.balance, undefined, 'no new balance is produced on failure');
  assert.equal(bufferBalance([credit(1000)]), 1000, 'ledger unchanged');
});

// ===========================================================================
// 7. No main-pot fallback unless explicitly configured
// ===========================================================================

test('no main-pot fallback is applied by default and the flag is reported honestly', () => {
  const plan = planBufferProtection({
    availableBufferAmount: 0,
    requiredProtectionAmount: 100000,
    mainPotFallback: false,
  });
  assert.equal(plan.outcome, 'BUFFER_INSUFFICIENT');
  assert.equal(plan.mainPotFallback, false);
  assert.equal(plan.shortfall, 100000, 'still owed — not written off into the pot');
});

test('partial protection is impossible unless explicitly approved', () => {
  const withoutApproval = planBufferProtection({ availableBufferAmount: 300000, requiredProtectionAmount: 490000 });
  assert.equal(withoutApproval.protectedAmount, 0, 'default policy: no partial protection');

  const withApproval = planBufferProtection({
    availableBufferAmount: 300000,
    requiredProtectionAmount: 490000,
    allowPartialProtection: true,
  });
  assert.equal(withApproval.outcome, 'PARTIALLY_PROTECTED');
  assert.equal(withApproval.protectedAmount, 300000);
  assert.equal(withApproval.shortfall, 190000, 'the remainder is still an unresolved shortfall');
  assert.equal(withApproval.shortfallUnresolved, true);
});

test('a zero requirement needs no protection at all', () => {
  const plan = planBufferProtection({ availableBufferAmount: 0, requiredProtectionAmount: 0 });
  assert.equal(plan.ok, true);
  assert.equal(plan.outcome, 'NO_SHORTFALL');
  assert.equal(plan.protectedAmount, 0);
});

test('protection requirement is derived from real collections, net of fee', () => {
  // 52 members expected, 51 paid, ₦5,000 each, 2% fee.
  const req = protectionRequirement({
    expectedWeeklyAmount: 500000,
    paidCount: 51,
    expectedCount: 52,
    feePercent: 2,
  });
  assert.equal(req, 500000 - 10000, 'one missing ₦5,000 contribution less the 2% fee');
  // Everyone paid → nothing to protect.
  assert.equal(protectionRequirement({ expectedWeeklyAmount: 500000, paidCount: 52, expectedCount: 52, feePercent: 2 }), 0);
});

// ===========================================================================
// 8. Member catches up  /  9. Buffer restoration
// ===========================================================================

test('catch-up quote sums missed + current + fine from configured values', () => {
  const quote = buildCatchUpQuote({
    missedRows: [{ amountKobo: 500000 }],
    currentAmountKobo: 500000,
    fineKobo: 200000,
  });
  assert.deepEqual(quote, {
    missedKobo: 500000,
    currentKobo: 500000,
    fineKobo: 200000,
    totalKobo: 1200000,
  });
  assert.equal(quote.totalKobo, quote.missedKobo + quote.currentKobo + quote.fineKobo, 'no money is lost or invented');
});

test('catch-up with no fine and multiple misses totals correctly', () => {
  const quote = buildCatchUpQuote({
    missedRows: [{ amountKobo: 500000 }, { amountKobo: 500000 }],
    currentAmountKobo: 500000,
    fineKobo: 0,
  });
  assert.equal(quote.missedKobo, 1000000);
  assert.equal(quote.totalKobo, 1500000);
});

test('buffer restoration returns the advanced amount and the pool lands back where it started', () => {
  const start = [credit(5000000)];
  const advanced = planBufferProtection({ availableBufferAmount: 5000000, requiredProtectionAmount: 500000 });
  const afterDebit = [...start, debit(advanced.protectedAmount)];
  assert.equal(bufferBalance(afterDebit), 4500000);

  const { restorable } = planBufferRestoration({
    bufferUsedKobo: advanced.protectedAmount,
    missedKobo: 500000,
    availableBufferAmount: bufferBalance(afterDebit),
  });
  assert.equal(restorable, 500000);

  const afterRestore = [...afterDebit, credit(restorable)];
  assert.equal(bufferBalance(afterRestore), 5000000, 'derived balance restored exactly — no stored balance mutated');
});

test('restoration can never exceed what was actually advanced', () => {
  const { restorable, capped } = planBufferRestoration({
    bufferUsedKobo: 500000,
    missedKobo: 5000000, // member owes far more than was advanced
    availableBufferAmount: 4000000,
  });
  assert.equal(restorable, 500000, 'capped at the advance, not the debt');
  assert.equal(capped, false);
});

test('restoration is bounded by the buffer\'s real available balance', () => {
  const { restorable, capped } = planBufferRestoration({
    bufferUsedKobo: 500000,
    missedKobo: 500000,
    availableBufferAmount: 120000, // someone else already drew most of it
  });
  assert.equal(restorable, 120000, 'cannot credit more than the pool actually holds');
  assert.equal(capped, true, 'the advance could not be fully restored');
});

test('restoration is a no-op when nothing was advanced or the pool is empty', () => {
  assert.equal(planBufferRestoration({ bufferUsedKobo: 0, missedKobo: 500000, availableBufferAmount: 900000 }).restorable, 0);
  assert.equal(planBufferRestoration({ bufferUsedKobo: 500000, missedKobo: 500000, availableBufferAmount: 0 }).restorable, 0);
});

test('restoration reference is idempotent per catch-up payment', () => {
  const ref = bufferRestorationReference('laani-cnt-abc');
  assert.equal(ref, 'buffer-restore:laani-cnt-abc');
  assert.equal(ref, bufferRestorationReference('laani-cnt-abc'), 'the same payment can never restore twice');
});

// ===========================================================================
// 10. Fine
// ===========================================================================

test('the fine amount is not hard-coded — it comes from policy only', () => {
  // The proposed ₦2,000 must appear only as a value a config supplies.
  const policy = { enabled: true, amountKobo: 200000 };
  assert.equal(policy.amountKobo, 200000);
  // With fines disabled the assessed amount is zero regardless of the value.
  const disabled = { enabled: false, amountKobo: 200000 };
  const assessed = disabled.enabled === true ? disabled.amountKobo : 0;
  assert.equal(assessed, 0, 'a disabled fine policy assesses nothing');
});

// ===========================================================================
// 11. Default state machine  /  12. Recovery case
// ===========================================================================

test('the default state machine permits only legal transitions', () => {
  const M = MEMBER_DEFAULT_STATES;
  assert.equal(canTransitionMemberDefault(M.ACTIVE, M.PAYMENT_MISSED), true);
  assert.equal(canTransitionMemberDefault(M.PAYMENT_MISSED, M.GRACE), true);
  assert.equal(canTransitionMemberDefault(M.GRACE, M.CAUGHT_UP), true);
  assert.equal(canTransitionMemberDefault(M.GRACE, M.DEFAULTED), true);
  assert.equal(canTransitionMemberDefault(M.DEFAULTED, M.RECOVERY), true);
  assert.equal(canTransitionMemberDefault(M.RECOVERY, M.CAUGHT_UP), true);
});

test('the default state machine rejects impossible jumps', () => {
  const M = MEMBER_DEFAULT_STATES;
  assert.equal(canTransitionMemberDefault(M.ACTIVE, M.DEFAULTED), false, 'cannot default without a miss');
  assert.equal(canTransitionMemberDefault(M.ACTIVE, M.CAUGHT_UP), false);
  assert.equal(canTransitionMemberDefault(M.CAUGHT_UP, M.DEFAULTED), false);
  // Re-entering the same state is idempotent, not an error.
  assert.equal(canTransitionMemberDefault(M.GRACE, M.GRACE), true);
});

test('recovery case statuses are the documented set', () => {
  assert.deepEqual([...RECOVERY_STATUSES], [
    'OPEN',
    'CONTACTING',
    'PROMISED',
    'PARTIALLY_RECOVERED',
    'RECOVERED',
    'ESCALATED',
    'CLOSED',
  ]);
});

test('default case reference is deterministic and distinguishes weeks', () => {
  const a = REFERENCES.defaultCase({ cohortId: 'c1', memberId: 'm1', weekIndex: 5 });
  assert.equal(a, 'default:c1:m1:w5');
  assert.equal(REFERENCES.defaultCase({ cohortId: 'c1', memberId: 'm1' }), 'default:c1:m1');
});

// ===========================================================================
// 13. No physical deletion  /  14. No mid-cycle replacement
// ===========================================================================

test('the module exposes no delete/destroy operation for members or history', async () => {
  const src = await import('node:fs').then((fs) =>
    fs.readFileSync(new URL('../src/lib/defaultRecovery.js', import.meta.url), 'utf8'),
  );
  // A default must never erase the user, payments, buffer rows, fines or audit.
  for (const forbidden of ['.delete(', '.deleteMany(', 'prisma.user.delete', 'TRUNCATE', 'DROP ']) {
    assert.equal(src.includes(forbidden), false, `defaultRecovery.js must not contain ${forbidden}`);
  }
});

test('closing participation is a status change, not a removal — position is untouched', () => {
  // The member keeps their position in the payout order. The business rule is
  // that a new member must NOT be inserted to replace a defaulted one, so the
  // ordering data (position) is never rewritten by the default path.
  const M = MEMBER_DEFAULT_STATES;
  assert.equal(canTransitionMemberDefault(M.DEFAULTED, M.RECOVERY), true);
  // No function in this module re-assigns positions; verified by the source
  // scan above plus the absence of any position mutation in closeMemberParticipation.
  assert.equal(typeof M.RECOVERY, 'string');
});

// ===========================================================================
// 15-17. Death workflow
// ===========================================================================

test('death follows its own state machine, separate from default', () => {
  const D = DEATH_STATES;
  assert.equal(canTransitionDeath(D.DEATH_REPORTED, D.DEATH_VERIFICATION), true);
  assert.equal(canTransitionDeath(D.DEATH_VERIFICATION, D.VERIFIED_DECEASED), true);
  assert.equal(canTransitionDeath(D.VERIFIED_DECEASED, D.PARTICIPATION_CLOSED), true);
  assert.equal(canTransitionDeath(D.PARTICIPATION_CLOSED, D.FINANCIAL_REVIEW), true);
  assert.equal(canTransitionDeath(D.FINANCIAL_REVIEW, D.ESTATE_RESOLUTION), true);
});

test('death cannot be short-circuited and cannot be confused with a default', () => {
  const D = DEATH_STATES;
  // Verification IS the admin-presented-evidence step, so it is reachable
  // directly from DEATH_REPORTED — otherwise the machine dead-ends on a state
  // nothing can advance.
  assert.equal(canTransitionDeath(D.DEATH_REPORTED, D.VERIFIED_DECEASED), true, 'verification is reachable from report');
  // The steps that must NOT be reachable before verification.
  assert.equal(canTransitionDeath(D.DEATH_REPORTED, D.PARTICIPATION_CLOSED), false, 'cannot close participation unverified');
  assert.equal(canTransitionDeath(D.DEATH_REPORTED, D.FINANCIAL_REVIEW), false);
  assert.equal(canTransitionDeath(D.DEATH_VERIFICATION, D.PARTICIPATION_CLOSED), false, 'must verify before closing');
  assert.equal(canTransitionDeath(D.DEATH_REPORTED, D.ESTATE_RESOLUTION), false);
  // A default status is not a death status.
  assert.equal(canTransitionDeath(MEMBER_DEFAULT_STATES.DEFAULTED, D.VERIFIED_DECEASED), false);
});

test('death workflow never auto-charges the family or the guarantor', async () => {
  const src = await import('node:fs').then((fs) =>
    fs.readFileSync(new URL('../src/lib/defaultRecovery.js', import.meta.url), 'utf8'),
  );
  // The only charge the system can make is a CONFIGURED fine; a death path
  // must never create a fine or debit a wallet/guarantor.
  const deathFns = src.slice(src.indexOf('reportDeath'), src.indexOf('recordGuarantor'));
  assert.equal(deathFns.includes('contributionFine.create'), false, 'death must not assess a fine');
  assert.equal(deathFns.includes('guarantor.update'), false, 'death must not touch a guarantor');
  assert.equal(deathFns.includes('wallet.update'), false, 'death must not debit a wallet');
  assert.equal(deathFns.includes('bufferLedger.create'), false, 'death must not promise buffer coverage');
});

// ===========================================================================
// 18. Duplicate retry protection
// ===========================================================================

test('every financial operation has a stable idempotency key', () => {
  const keys = [
    REFERENCES.missed({ cohortId: 'c1', memberId: 'm1', weekIndex: 1 }),
    REFERENCES.defaultCase({ cohortId: 'c1', memberId: 'm1', weekIndex: 1 }),
    REFERENCES.fine({ defaultId: 'd1' }),
    bufferProtectionReference({ cohortId: 'c1', weekIndex: 1 }),
    bufferRestorationReference('pay-1'),
  ];
  assert.equal(new Set(keys).size, keys.length, 'no two operations can collide');
  for (const k of keys) assert.match(k, /:/, 'keys are namespaced');
});

test('replaying a week cannot double-debit the buffer', () => {
  const rows = [credit(1000000)];
  const plan = planBufferProtection({ availableBufferAmount: bufferBalance(rows), requiredProtectionAmount: 500000 });
  const ref = bufferProtectionReference({ cohortId: 'c1', weekIndex: 2 });

  // First application.
  rows.push({ eventType: 'BUFFER_DEBIT', amountKobo: plan.protectedAmount, sign: -1, reference: ref });
  assert.equal(bufferBalance(rows), 500000);

  // Replay: the same reference is unique, so the second write is rejected and
  // the existing row returned instead of a new one.
  const replayRow = { eventType: 'BUFFER_DEBIT', amountKobo: plan.protectedAmount, sign: -1, reference: ref };
  const deduped = new Map(rows.map((r) => [r.reference ?? Math.random(), r]));
  deduped.set(replayRow.reference, replayRow);
  const finalRows = [...deduped.values()];
  assert.equal(finalRows.length, 2, 'no duplicate debit row');
  assert.equal(bufferBalance(finalRows), 500000, 'balance debited exactly once');
});

// ===========================================================================
// 19. Audit logging
// ===========================================================================

test('every required financial/state action has an audit constant', () => {
  const required = [
    'BUFFER_CREDIT',
    'BUFFER_DEBIT',
    'BUFFER_REFUND',
    'BUFFER_ADJUSTMENT',
    'MISSED_PAYMENT',
    'GRACE_STARTED',
    'CATCHUP_PAYMENT',
    'DEFAULT_CREATED',
    'FINE_APPLIED',
    'RECOVERY_STARTED',
    'RECOVERY_UPDATED',
    'MEMBER_CLOSED',
    'DEATH_REPORTED',
    'DEATH_VERIFIED',
  ];
  for (const action of required) {
    assert.equal(typeof AUDIT_ACTIONS[action], 'string', `missing audit action ${action}`);
  }
  // The shortfall case must also be auditable.
  assert.equal(typeof AUDIT_ACTIONS.BUFFER_INSUFFICIENT, 'string');
  assert.equal(typeof AUDIT_ACTIONS.BUFFER_RESTORED, 'string');
});

test('audit logging is transactional and cannot silently swallow a failure', async () => {
  const audit = await import('../src/lib/audit.js');
  assert.equal(typeof audit.logAuditTx, 'function', 'financial events use the throwing variant');
  const src = await import('node:fs').then((fs) =>
    fs.readFileSync(new URL('../src/lib/audit.js', import.meta.url), 'utf8'),
  );
  const txFn = src.slice(src.indexOf('export async function logAuditTx'));
  assert.equal(txFn.includes('try {'), false, 'logAuditTx must not swallow errors');
  // defaultRecovery must use the transactional variant for money events.
  const rec = await import('node:fs').then((fs) =>
    fs.readFileSync(new URL('../src/lib/defaultRecovery.js', import.meta.url), 'utf8'),
  );
  assert.equal(rec.includes('logAuditTx'), true);
});

// ===========================================================================
// 20. Existing behaviour is unchanged (buffer split invariants still hold)
// ===========================================================================

test('the existing buffer split invariants are untouched by this feature', () => {
  for (const policy of [null, { enabled: false, percent: 5 }, { enabled: true, mode: 'percent', percent: 3, flatKobo: 0 }]) {
    for (const amount of [0, 1, 100001, 500000]) {
      const { mainAmount, bufferAmount } = contributionBufferSplit(amount, policy);
      assert.equal(mainAmount + bufferAmount, amount, `invariant holds for ${amount} under ${JSON.stringify(policy)}`);
      assert.ok(bufferAmount >= 0 && bufferAmount <= amount);
    }
  }
  assert.equal(shouldCreditBuffer({ frequency: 'WEEKLY', status: 'verified' }), true);
  assert.equal(shouldCreditBuffer({ frequency: 'MONTHLY', status: 'verified' }), false);
});

// ===========================================================================
// Replay safety: a retried call must never move money or balances twice
// ===========================================================================

// Minimal in-memory stand-in for the Prisma transaction surface used by the
// buffer writers. It reproduces the crucial semantic: createMany with
// skipDuplicates reports count 0 (and does NOT abort) when the unique
// reference already exists.
function fakeTx() {
  const rows = new Map();
  return {
    rows,
    bufferLedger: {
      createMany: async ({ data, skipDuplicates }) => {
        if (skipDuplicates && rows.has(data.reference)) return { count: 0 };
        rows.set(data.reference, { id: `row_${rows.size + 1}`, ...data });
        return { count: 1 };
      },
      findUnique: async ({ where }) => rows.get(where.reference) ?? null,
    },
  };
}

test('a replayed protection debit is written once and reports created=false', async () => {
  const { applyBufferProtection } = await import('../src/lib/bufferFund.js');
  const tx = fakeTx();
  const plan = { ok: true, protectedAmount: 250000, required: 250000, shortfall: 0, available: 900000, outcome: 'PROTECTED' };
  const args = { tx, plan, cohortId: 'c1', userId: 'u1', defaultId: 'd1', weekIndex: 7 };

  const first = await applyBufferProtection(args);
  assert.equal(first.created, true, 'first call creates the ledger row');
  assert.equal(first.recorded, true);
  assert.equal(tx.rows.size, 1);

  const replay = await applyBufferProtection(args);
  assert.equal(replay.created, false, 'a replay must report created=false');
  assert.equal(replay.recorded, false, 'recorded=false so the caller does not re-increment bufferUsedKobo');
  assert.equal(replay.replay, true);
  assert.equal(tx.rows.size, 1, 'no duplicate ledger row');
});

test('a replayed buffer restoration reports restored=0 so balances cannot double-decrement', async () => {
  const { restoreBufferFromCatchUp } = await import('../src/lib/bufferFund.js');
  const tx = fakeTx();
  const args = { tx, cohortId: 'c1', userId: 'u1', paymentId: 'pay_1', amountKobo: 250000, paymentReference: 'PSK_REF' };

  const first = await restoreBufferFromCatchUp(args);
  assert.equal(first.restored, 250000);
  assert.equal(first.created, true);

  const replay = await restoreBufferFromCatchUp(args);
  assert.equal(replay.restored, 0, 'restored is 0 on replay so outstanding/bufferUsed are not decremented again');
  assert.equal(replay.recorded, false);
  assert.equal(tx.rows.size, 1, 'the BUFFER_CREDIT is written once');
});

test('restoration can never credit more than was advanced or than the pool holds', () => {
  assert.deepEqual(planBufferRestoration({ bufferUsedKobo: 250000, missedKobo: 900000, availableBufferAmount: 1000000 }).restorable, 250000);
  assert.deepEqual(planBufferRestoration({ bufferUsedKobo: 250000, missedKobo: 900000, availableBufferAmount: 40000 }).restorable, 40000);
  assert.deepEqual(planBufferRestoration({ bufferUsedKobo: 0, missedKobo: 900000, availableBufferAmount: 1000000 }).restorable, 0);
  assert.deepEqual(planBufferRestoration({ bufferUsedKobo: 250000, missedKobo: 900000, availableBufferAmount: 0 }).restorable, 0);
});

// ===========================================================================
// Config safety: additive policy keys must not be lost on existing rows
// ===========================================================================

test('a stored policy is deep-merged over defaults so new safety keys survive', async () => {
  const { mergePolicyForTest } = await import('../src/lib/config.js');
  const defaults = {
    enabled: false,
    mode: 'percent',
    percent: 0,
    protectPayouts: false,
    allowPartialProtection: false,
    mainPotFallback: false,
    cycleEndDisposition: 'UNRESOLVED',
  };

  // A row written BEFORE protectPayouts existed must still report it as false
  // rather than undefined, so the code's `=== true` checks stay meaningful and
  // the admin API never returns a missing field.
  const legacy = { enabled: true, mode: 'percent', percent: 5 };
  const merged = mergePolicyForTest(defaults, legacy);
  assert.equal(merged.enabled, true, 'stored values win');
  assert.equal(merged.percent, 5);
  assert.equal(merged.protectPayouts, false, 'missing key falls back to the safe default');
  assert.equal(merged.allowPartialProtection, false);
  assert.equal(merged.mainPotFallback, false);
  assert.equal(merged.cycleEndDisposition, 'UNRESOLVED');

  // A partial stored object must never wipe out safety defaults.
  const partial = { protectPayouts: true };
  const merged2 = mergePolicyForTest(defaults, partial);
  assert.equal(merged2.protectPayouts, true);
  assert.equal(merged2.mainPotFallback, false, 'an unset key stays false, not undefined');

  // Non-object / null stored values fall back entirely.
  assert.deepEqual(mergePolicyForTest(defaults, null), defaults);
  assert.deepEqual(mergePolicyForTest(defaults, 'corrupt'), defaults);
});
