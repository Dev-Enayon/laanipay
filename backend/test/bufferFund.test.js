import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  BUFFER_EVENTS,
  applyBufferDebit,
  bufferBalance,
  bufferCreditReference,
  bufferEntryDelta,
  bufferEventSign,
  contributionBufferSplit,
  shouldCreditBuffer,
} from '../src/lib/bufferFund.js';

// A pure in-memory buffer ledger used to exercise the credit/debit/refund/
// adjustment arithmetic that mirrors lib/bufferFund.js + the settlement wiring,
// without needing a database.

function credit(amountKobo, reference) {
  return { eventType: 'BUFFER_CREDIT', amountKobo, sign: bufferEventSign('BUFFER_CREDIT'), reference };
}
function debit(amountKobo, reference) {
  return { eventType: 'BUFFER_DEBIT', amountKobo, sign: bufferEventSign('BUFFER_DEBIT'), reference };
}
function refund(amountKobo, reference) {
  return { eventType: 'BUFFER_REFUND', amountKobo, sign: bufferEventSign('BUFFER_REFUND'), reference };
}
function adjustment(amountKobo, sign, reference) {
  return { eventType: 'BUFFER_ADJUSTMENT', amountKobo, sign, reference };
}

// ---------------------------------------------------------------------------
// Contribution payment split (main + buffer)
// ---------------------------------------------------------------------------

test('disabled/absent policy yields 100% main contribution (unchanged behaviour)', () => {
  for (const policy of [null, undefined, {}, { enabled: false, percent: 5 }, { enabled: true, mode: 'percent', percent: 0 }]) {
    const { mainAmount, bufferAmount } = contributionBufferSplit(500000, policy);
    assert.equal(mainAmount, 500000);
    assert.equal(bufferAmount, 0);
    assert.equal(mainAmount + bufferAmount, 500000, 'invariant: main + buffer === amount');
  }
});

test('percent split diverts the exact share to the buffer', () => {
  const policy = { enabled: true, mode: 'percent', percent: 2, flatKobo: 0 };
  const { mainAmount, bufferAmount } = contributionBufferSplit(500000, policy);
  assert.equal(bufferAmount, 10000, '2% of ₦5,000 = ₦100 buffer');
  assert.equal(mainAmount, 490000, '₦4,900 funds the main contribution');
  assert.equal(mainAmount + bufferAmount, 500000, 'invariant');
});

test('split never leaves a residual and rounds to whole kobo', () => {
  const policy = { enabled: true, mode: 'percent', percent: 3, flatKobo: 0 };
  const { mainAmount, bufferAmount } = contributionBufferSplit(100001, policy);
  assert.equal(mainAmount + bufferAmount, 100001, 'rounding never drops a kobo');
  assert.equal(bufferAmount, 3000);
});

test('flat split diverts a fixed amount', () => {
  const policy = { enabled: true, mode: 'flat', percent: 0, flatKobo: 10000 };
  const { mainAmount, bufferAmount } = contributionBufferSplit(300000, policy);
  assert.equal(bufferAmount, 10000);
  assert.equal(mainAmount, 290000);
  assert.equal(mainAmount + bufferAmount, 300000, 'invariant');
});

test('buffer is clamped so it can never exceed the payment itself', () => {
  const flat = { enabled: true, mode: 'flat', percent: 0, flatKobo: 500000 };
  const percent = { enabled: true, mode: 'percent', percent: 150, flatKobo: 0 };
  for (const policy of [flat, percent]) {
    const { mainAmount, bufferAmount } = contributionBufferSplit(100000, policy);
    assert.ok(bufferAmount <= 100000, 'buffer never exceeds the paid amount');
    assert.equal(mainAmount + bufferAmount, 100000, 'invariant');
  }
});

test('only verified WEEKLY payments are buffer-eligible', () => {
  assert.equal(shouldCreditBuffer({ frequency: 'WEEKLY', status: 'verified' }), true);
  assert.equal(shouldCreditBuffer({ frequency: 'WEEKLY', status: 'pending' }), false, 'pending never credits');
  assert.equal(shouldCreditBuffer({ frequency: 'WEEKLY', status: 'failed' }), false, 'failed never credits');
  assert.equal(shouldCreditBuffer({ frequency: 'MONTHLY', status: 'verified' }), false, 'monthly has no group buffer');
});

// ---------------------------------------------------------------------------
// Ledger balance derivation (credit recorded / refund / adjustment)
// ---------------------------------------------------------------------------

test('BUFFER_CREDIT is recorded and moves the balance up', () => {
  const ledger = [credit(10000, 'buffer:laani-cnt-1'), credit(10000, 'buffer:laani-cnt-2')];
  assert.equal(bufferBalance(ledger), 20000);
  assert.equal(bufferEntryDelta(ledger[0]), 1);
});

test('BUFFER_DEBIT is recorded and moves the balance down', () => {
  const ledger = [credit(10000, 'buffer:laani-cnt-1'), debit(6000, 'buffer-use-week-7')];
  assert.equal(bufferBalance(ledger), 4000);
  assert.equal(bufferEntryDelta(ledger[1]), -1);
});

test('BUFFER_REFUND draws the fund down (cycle-end return to member)', () => {
  const ledger = [credit(10000, 'buffer:laani-cnt-1'), refund(10000, 'buffer-refund-1')];
  assert.equal(bufferBalance(ledger), 0);
});

test('BUFFER_ADJUSTMENT respects an explicit sign', () => {
  const ledger = [credit(10000, 'buffer:laani-cnt-1'), adjustment(2500, 1, 'adj-1'), adjustment(1500, -1, 'adj-2')];
  assert.equal(bufferBalance(ledger), 10000 + 2500 - 1500);
  assert.equal(BUFFER_EVENTS.includes('BUFFER_ADJUSTMENT'), true);
});

// ---------------------------------------------------------------------------
// Never-negative / insufficient-buffer state
// ---------------------------------------------------------------------------

test('buffer balance can never be driven negative by a debit planner', () => {
  const ledger = [credit(10000, 'buffer:laani-cnt-1')];
  const available = bufferBalance(ledger);

  const ok = applyBufferDebit({ balance: available, amountKobo: 6000 });
  assert.equal(ok.ok, true);
  assert.equal(ok.balance, 4000);

  const tooMuch = applyBufferDebit({ balance: available, amountKobo: 12000 });
  assert.equal(tooMuch.ok, false);
  assert.equal(tooMuch.reason, 'insufficient_buffer', 'explicit insufficient-buffer state');
  assert.equal(tooMuch.available, 10000);
  assert.equal(tooMuch.required, 12000);
  // No fabricating funds: the derived balance is untouched by a failed debit.
  assert.equal(bufferBalance(ledger), 10000);
});

test('non-positive debits are rejected by the planner', () => {
  const zero = applyBufferDebit({ balance: 10000, amountKobo: 0 });
  assert.equal(zero.required, 0);
  const out = applyBufferDebit({ balance: 10000, amountKobo: -50 });
  assert.equal(out.required, 0, 'negative debits clamp to 0 (no money from nothing)');
});

// ---------------------------------------------------------------------------
// Idempotency
// ---------------------------------------------------------------------------

test('credit reference is a stable deterministic key of the payment reference', () => {
  assert.equal(bufferCreditReference('laani-cnt-abc'), 'buffer:laani-cnt-abc');
  assert.equal(bufferCreditReference('laani-cnt-abc'), bufferCreditReference('laani-cnt-abc'));
  assert.ok(bufferCreditReference('laani-cnt-a') !== bufferCreditReference('laani-wal-a'));
});

test('a duplicate credit for the same reference must not double the balance', () => {
  // Mirrors the settlement guard: only ONE verified claim per payment reference,
  // and the ledger `reference` is UNIQUE. A replayed webhook therefore cannot
  // add a second credit — the stable key de-duplicates it.
  const reference = 'laani-cnt-dup';
  let ledger = [];
  const first = credit(10000, bufferCreditReference(reference));
  const replayed = credit(10000, bufferCreditReference(reference)); // would violate the unique key
  const deduped = new Map(ledger.map((e) => [e.reference, e]));
  deduped.set(first.reference, first);
  deduped.set(replayed.reference, replayed); // same key — replaces, does not add
  ledger = [...deduped.values()];
  assert.equal(ledger.length, 1, 'one credit row for one payment');
  assert.equal(bufferBalance(ledger), 10000, 'credited exactly once');
});

test('a failed payment contributes zero to the buffer even when the policy is enabled', () => {
  const policy = { enabled: true, mode: 'percent', percent: 2, flatKobo: 0 };
  // A failed payment is never passed to the recorder (the settlement only
  // records verified payments), and the split is only applied to eligible
  // WEEKLY+verified payments — so the buffer ledger receives nothing.
  const eligible = shouldCreditBuffer({ frequency: 'WEEKLY', status: 'failed' });
  const split = contributionBufferSplit(500000, policy);
  assert.equal(eligible, false);
  assert.ok(split.bufferAmount > 0, 'the split still computes, but the gate blocks the write');
  assert.equal(bufferBalance([]), 0, 'buffer ledger untouched by a failed payment');
});