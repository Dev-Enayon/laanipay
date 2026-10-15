// Regression tests for the payment failure transition.
//
// A failed verification result must never overwrite a terminal payment state.
// `failPaymentIfPending` is the single guarded transition used by
// settlePayment for both activation and contribution payments; these tests
// pin its behaviour without needing a database or the Paystack API.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { failPaymentIfPending, resolveClaimOutcome } from '../src/lib/settlement.js';

// Minimal in-memory stand-in for a Prisma model delegate. `updateMany` honours
// the `where` clause exactly like the real conditional UPDATE, and records the
// clause it was called with so tests can assert the guard is present.
function fakeDelegate(row) {
  return {
    calls: [],
    async updateMany({ where, data }) {
      this.calls.push({ where, data });
      if (row.id === where.id && row.status === where.status) {
        row.status = data.status;
        return { count: 1 };
      }
      return { count: 0 };
    },
    async findUnique({ where }) {
      return row.id === where.id ? { ...row } : null;
    },
  };
}

test('a pending payment transitions to failed', async () => {
  const row = { id: 'p1', status: 'pending' };
  const delegate = fakeDelegate(row);

  const status = await failPaymentIfPending(delegate, 'p1');

  assert.equal(status, 'failed');
  assert.equal(row.status, 'failed', 'the pending row is now failed');
});

test('the failure update is restricted to pending rows', async () => {
  const row = { id: 'p1', status: 'pending' };
  const delegate = fakeDelegate(row);

  await failPaymentIfPending(delegate, 'p1');

  assert.deepEqual(
    delegate.calls[0].where,
    { id: 'p1', status: 'pending' },
    'updateMany must be conditional on status=pending',
  );
  assert.deepEqual(delegate.calls[0].data, { status: 'failed' });
  assert.equal(delegate.calls.length, 1, 'only the conditional update is attempted');
});

test('a cancelled payment remains cancelled', async () => {
  const row = { id: 'p2', status: 'cancelled' };
  const delegate = fakeDelegate(row);

  const status = await failPaymentIfPending(delegate, 'p2');

  assert.equal(status, 'cancelled');
  assert.equal(row.status, 'cancelled', 'a cancelled payment is never overwritten');
});

test('a verified payment remains verified', async () => {
  const row = { id: 'p3', status: 'verified' };
  const delegate = fakeDelegate(row);

  const status = await failPaymentIfPending(delegate, 'p3');

  assert.equal(status, 'verified');
  assert.equal(row.status, 'verified', 'a verified payment is never overwritten');
});

test('an already failed payment stays failed', async () => {
  const row = { id: 'p4', status: 'failed' };
  const delegate = fakeDelegate(row);

  const status = await failPaymentIfPending(delegate, 'p4');

  assert.equal(status, 'failed');
  assert.equal(row.status, 'failed');
});

test('a concurrent settlement to verified wins over a stale failure (zero-row race)', async () => {
  // The conditional update matches nothing because another writer already
  // moved the row to verified; we must re-read and NOT downgrade it.
  const row = { id: 'p5', status: 'verified' };
  const delegate = fakeDelegate(row);

  const status = await failPaymentIfPending(delegate, 'p5');

  assert.equal(delegate.calls[0].where.status, 'pending', 'the write only ever targets pending');
  assert.equal(status, 'verified');
  assert.equal(row.status, 'verified');
});

test('a missing row reports null and is not created', async () => {
  const delegate = fakeDelegate({ id: 'other', status: 'pending' });

  const status = await failPaymentIfPending(delegate, 'does-not-exist');

  assert.equal(status, null);
});

// --- resolveClaimOutcome ----------------------------------------------------
// On the success path settlePayment tries to claim (flip pending -> verified)
// the row. When the claim affects zero rows the payment must NOT be reported as
// verified unless a concurrent settlement actually verified it.

test('a claimed row is settled', () => {
  assert.equal(resolveClaimOutcome(true, 'verified'), 'settled');
});

test('a zero-row claim on a concurrently verified row is reported as already', () => {
  assert.equal(resolveClaimOutcome(false, 'verified'), 'already');
});

test('a zero-row claim on a cancelled row is never verified', () => {
  assert.equal(resolveClaimOutcome(false, 'cancelled'), 'not_pending');
});

test('a zero-row claim on a failed row is never verified', () => {
  assert.equal(resolveClaimOutcome(false, 'failed'), 'not_pending');
});

test('a zero-row claim on a deleted (absent) row is never verified', () => {
  assert.equal(resolveClaimOutcome(false, null), 'not_pending');
});

// End-to-end shape of the guard: simulate settlePayment's claim attempt against
// a cancelled row (conditional UPDATE affects zero rows), re-read the status,
// and confirm the outcome is not a success.
test('a successful Paystack verify on a cancelled row does not yield success', async () => {
  const row = { id: 'c1', status: 'cancelled' };
  const delegate = {
    async updateMany({ where, data }) {
      if (row.id === where.id && row.status === where.status) {
        row.status = data.status;
        return { count: 1 };
      }
      return { count: 0 };
    },
    async findUnique({ where }) {
      return row.id === where.id ? { ...row } : null;
    },
  };

  const claimed = await delegate.updateMany({
    where: { id: 'c1', status: 'pending' },
    data: { status: 'verified' },
  });
  const current = await delegate.findUnique({ where: { id: 'c1' }, select: { status: true } });
  const outcome = resolveClaimOutcome(claimed.count === 1, current?.status ?? null);

  assert.equal(outcome, 'not_pending');
  assert.equal(row.status, 'cancelled', 'the cancelled row is never overwritten to verified');
});
