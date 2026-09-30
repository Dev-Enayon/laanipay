// Contribution security-buffer fund — PURE split/math helpers with no I/O plus
// the single idempotent ledger writer. This is the BUFFER FUND FOUNDATION ONLY.
//
// Money-flow rules enforced here:
//   - A verified weekly contribution is split into main + buffer such that
//     `mainAmount + bufferAmount === amount` ALWAYS (never money from nothing).
//   - bufferAmount is always >= 0 and never exceeds the payment itself.
//   - The buffer pool is per (cohort, user). A balance is DERIVED as the signed
//     sum of ledger entries — there is no stored balance book to drift.
//   - Credit is idempotent: the unique `reference` (buffer:{paystackReference})
//     plus a defensive claim-check means a replay can never credit twice.
//   - Debit/refund planners return an explicit `insufficient_buffer` state
//     instead of ever driving the derived balance negative. The conditional
//     (default/death/fine/recovery) flows that would actually apply a debit
//     are deliberately NOT implemented here.
//
// All monetary values are integer kobo.

export const BUFFER_EVENTS = ['BUFFER_CREDIT', 'BUFFER_DEBIT', 'BUFFER_REFUND', 'BUFFER_ADJUSTMENT'];

// Canonical sign for a ledger event type (+1 credits the pool, -1 debits it).
// BUFFER_ADJUSTMENT is ambivalent — use the entry's `sign` column.
export function bufferEventSign(eventType) {
  switch (eventType) {
    case 'BUFFER_CREDIT':
      return 1;
    case 'BUFFER_DEBIT':
    case 'BUFFER_REFUND':
      return -1;
    default:
      return 1;
  }
}

// Effective delta multiplier for a single ledger row: the stored `sign` (which
// defaults to +1) wins, falling back to the event type's canonical sign.
export function bufferEntryDelta(entry) {
  const s = Number(entry?.sign);
  return Number.isInteger(s) && s !== 0 ? s : bufferEventSign(entry?.eventType);
}

// Derived balance from ledger rows. `rows` may be pre-filtered to a cohort,
// a cohort+user, or left whole; the caller scopes. Never negative by
// construction for credit-only histories; debits must be planned via
// applyBufferDebit so they can never push it negative.
export function bufferBalance(rows) {
  return (rows ?? []).reduce(
    (sum, r) => sum + Math.max(0, Math.round(Number(r.amountKobo) || 0)) * bufferEntryDelta(r),
    0,
  );
}

// Splits an ACTUAL paid contribution amount into main + security buffer.
// `policy` is the effective bufferPolicy config ({ enabled, mode, percent,
// flatKobo }) — empty or disabled yields { amount, 0 } (existing behavior).
// Invariants (tested): mainAmount + bufferAmount === amount; 0 <= bufferAmount
// <= amount.
export function contributionBufferSplit(amountKobo, policy = null) {
  const amount = Math.max(0, Math.round(Number(amountKobo) || 0));
  if (!policy || policy.enabled !== true) {
    return { mainAmount: amount, bufferAmount: 0 };
  }

  let buffer = 0;
  if (policy.mode === 'flat') {
    buffer = Math.max(0, Math.round(Number(policy.flatKobo) || 0));
  } else {
    const pct = Math.min(100, Math.max(0, Number(policy.percent) || 0));
    buffer = Math.round((amount * pct) / 100);
  }

  if (buffer > amount) buffer = amount; // never divert more than was paid
  return { mainAmount: amount - buffer, bufferAmount: buffer };
}

// Whether a contribution payment is eligible to feed the buffer: WEEKLY
// contributions only (monthly plans have no cohort/group), and only once the
// payment is verified (a pending/failed payment never credits the buffer).
export function shouldCreditBuffer({ frequency, status }) {
  return frequency === 'WEEKLY' && status === 'verified';
}

// Stable idempotency key for the buffer credit of a contribution payment.
export function bufferCreditReference(paystackReference) {
  return `buffer:${paystackReference}`;
}

// Planner for withdrawing from a buffer balance. Returns the outcome with an
// explicit `insufficient_buffer` state when the balance would go negative —
// the caller must handle that state (it is not implemented in this foundation
// task), never fabricate funds, and never debit beyond what exists.
export function applyBufferDebit({ balance, amountKobo }) {
  const available = Math.max(0, Math.round(Number(balance) || 0));
  const required = Math.max(0, Math.round(Number(amountKobo) || 0));
  if (required > available) {
    return { ok: false, reason: 'insufficient_buffer', available, required };
  }
  return { ok: true, balance: available - required, available, required, amountKobo: required };
}

// Writes one buffer ledger movement and reports whether it actually created a
// new row. Idempotent via the unique `reference` on BufferLedger.
//
// IMPORTANT: this uses `createMany({ skipDuplicates: true })` rather than
// `create()` wrapped in a P2002 catch. In PostgreSQL a failed statement poisons
// the surrounding transaction, so a follow-up read on the same `tx` would fail
// with "current transaction is aborted" — meaning the naive catch-then-read
// pattern silently breaks the retry it is meant to support. `skipDuplicates`
// turns a duplicate into a no-op row count of 0, leaves the transaction
// usable, and is atomic against concurrent writers. Must be called inside the
// caller's Prisma transaction.
//
// Returns { row, created }. `created === false` means the reference already
// existed, i.e. this is a replay — callers must NOT re-apply side effects.
export async function writeBufferEntry({
  tx,
  cohortId,
  userId,
  eventType,
  amountKobo,
  sign = bufferEventSign(eventType),
  reference,
  reason = null,
  actor = 'system',
  paymentId = null,
  metadata = null,
}) {
  const amount = Math.max(0, Math.round(Number(amountKobo) || 0));
  if (amount <= 0) return { row: null, created: false };

  const dir = Number.isInteger(Number(sign)) && Number(sign) !== 0 ? Number(sign) : 1;

  const { count } = await tx.bufferLedger.createMany({
    data: {
      cohortId,
      userId,
      eventType,
      amountKobo: amount,
      sign: dir,
      reference,
      reason,
      actor,
      paymentId,
      metadata,
    },
    skipDuplicates: true,
  });

  if (count === 0) {
    // Replay: the row was already there, so return it untouched.
    const existing = await tx.bufferLedger.findUnique({ where: { reference } });
    return { row: existing ?? null, created: false };
  }
  const row = await tx.bufferLedger.findUnique({ where: { reference } });
  return { row: row ?? null, created: true };
}

// Back-compat wrapper: returns just the ledger row (or null) for callers that
// only need to know the entry exists. New code should prefer
// `writeBufferEntry`, which distinguishes a fresh write from a replay.
export async function recordBufferEntry(args) {
  const { row } = await writeBufferEntry(args);
  return row;
}

// Records the BUFFER_CREDIT for a verified weekly contribution payment.
// amountKobo must be the payment's bufferAmount (from contributionBufferSplit);
// reference is the paystack/generated transaction reference used for the
// payment — the idempotency key is derived from it. Must be called inside the
// caller's Prisma transaction.
export async function recordBufferCredit({ tx, cohortId, userId, paymentId, amountKobo, reference, metadata = null }) {
  return recordBufferEntry({
    tx,
    cohortId,
    userId,
    eventType: 'BUFFER_CREDIT',
    amountKobo,
    sign: 1,
    reference: bufferCreditReference(reference),
    reason: 'Weekly contribution security buffer (auto-allocated on verified payment)',
    actor: 'system',
    paymentId,
    metadata,
  });
}

// Stable idempotency key for advancing the buffer to protect a payout. One
// debit per (cohort, week, default case) — a retry of the same week or the
// same case can never draw the buffer twice.
export function bufferProtectionReference({ cohortId, weekIndex, defaultId }) {
  return defaultId
    ? `buffer-protect:${cohortId}:${defaultId}`
    : `buffer-protect:${cohortId}:w${weekIndex}`;
}

// Stable idempotency key for restoring buffer that was previously advanced.
// Keyed on the catch-up payment so the same payment restores exactly once.
export function bufferRestorationReference(paymentReference) {
  return `buffer-restore:${paymentReference}`;
}

// The protection decision for a payout obligation that a member's miss has
// reduced. This is the ONLY place the "can the buffer cover it?" business
// question is answered, and it deliberately answers it in a way that cannot
// fabricate money.
//
// Contract:
//   - availableBufferAmount < requiredProtectionAmount  → BUFFER_INSUFFICIENT
//     with `available`, `required` and `shortfall`. NO partial debit is
//     planned unless `allowPartialProtection` was explicitly approved.
//   - The shortfall is NEVER taken from the main pot, from other members, or
//     invented. `mainPotFallback` is reported as a flag so the caller can
//     surface the unresolved obligation to admin.
export function planBufferProtection({
  availableBufferAmount,
  requiredProtectionAmount,
  allowPartialProtection = false,
  mainPotFallback = false,
}) {
  const available = Math.max(0, Math.round(Number(availableBufferAmount) || 0));
  const required = Math.max(0, Math.round(Number(requiredProtectionAmount) || 0));

  if (required === 0) {
    return { ok: true, outcome: 'NO_SHORTFALL', available, required, protectedAmount: 0, shortfall: 0, shortfallUnresolved: false };
  }

  if (available >= required) {
    return {
      ok: true,
      outcome: 'PROTECTED',
      available,
      required,
      protectedAmount: required,
      shortfall: 0,
      shortfallUnresolved: false,
    };
  }

  const shortfall = required - available;

  // Partial protection is OFF unless a human approved it. Even then it is a
  // separate, explicitly-flagged branch so it can never be reached by default.
  if (allowPartialProtection && available > 0) {
    return {
      ok: true,
      outcome: 'PARTIALLY_PROTECTED',
      available,
      required,
      protectedAmount: available,
      shortfall,
      shortfallUnresolved: true,
      partialApproved: true,
    };
  }

  return {
    ok: false,
    outcome: 'BUFFER_INSUFFICIENT',
    available,
    required,
    protectedAmount: 0,
    shortfall,
    shortfallUnresolved: true,
    // Explicitly surfaced: the shortfall is NOT written off and NOT taken from
    // the main pot. The caller must record it and escalate to admin.
    mainPotFallback: mainPotFallback === true,
  };
}

// Applies the plan: writes the BUFFER_DEBIT only when the plan says the buffer
// can cover the obligation, and never writes a partial debit by default.
// Idempotent via the derived reference. Returns the ledger row plus the plan so
// the caller can persist `shortfall` on the recovery case. MUST be called
// inside the caller's Prisma transaction.
//
// `created` is the replay guard: on a duplicate reference the ledger is NOT
// touched and `created` is false, so the caller must not increment the
// recovery case's `bufferUsedKobo` again.
export async function applyBufferProtection({ tx, plan, cohortId, userId, defaultId, weekIndex, paymentId = null, actor = 'system', metadata = null }) {
  if (!plan || plan.ok !== true || plan.protectedAmount <= 0) {
    // Nothing to draw. BUFFER_INSUFFICIENT / NO_SHORTFALL write no ledger row.
    return { recorded: false, created: false, plan, ledger: null };
  }

  const { row, created } = await writeBufferEntry({
    tx,
    cohortId,
    userId,
    eventType: 'BUFFER_DEBIT',
    amountKobo: plan.protectedAmount,
    sign: -1,
    reference: bufferProtectionReference({ cohortId, weekIndex, defaultId }),
    reason:
      plan.outcome === 'PARTIALLY_PROTECTED'
        ? 'Buffer advanced to partially protect the group payout (explicitly approved partial policy)'
        : 'Buffer advanced to protect the group payout from a defaulted member',
    actor,
    paymentId,
    metadata: { ...(metadata ?? {}), required: plan.required, shortfall: plan.shortfall },
  });

  return { recorded: created, created, replay: !created, plan, ledger: row };
}

// Restores buffer previously advanced for a member who has now caught up.
// This is a BUFFER_CREDIT in the ledger — the derived balance rises back; no
// stored balance column is ever mutated. `amountKobo` is bounded by the caller
// to the amount actually advanced (bufferUsedKobo) so a member can never
// restore more than was drawn. Idempotent on the payment reference. MUST be
// called inside the caller's Prisma transaction.
//
// `restored` is 0 on a replay so the caller cannot double-decrement the
// recovery case's outstanding/buffer-used balances.
export async function restoreBufferFromCatchUp({ tx, cohortId, userId, paymentId, amountKobo, paymentReference, metadata = null }) {
  const amount = Math.max(0, Math.round(Number(amountKobo) || 0));
  if (amount <= 0) return { recorded: false, created: false, replay: false, restored: 0, ledger: null };

  const { row, created } = await writeBufferEntry({
    tx,
    cohortId,
    userId,
    eventType: 'BUFFER_CREDIT',
    amountKobo: amount,
    sign: 1,
    reference: bufferRestorationReference(paymentReference),
    reason: 'Buffer restored — defaulted member caught up on the missed contribution',
    actor: 'system',
    paymentId,
    metadata,
  });

  return {
    recorded: created,
    created,
    replay: !created,
    restored: created ? amount : 0,
    ledger: row,
  };
}

// How much of a catch-up payment should be treated as restoring previously
// advanced buffer. Bounded by BOTH the outstanding advance and the buffer
// actually available in the ledger, so restoration can never credit the pool
// more than was debited from it. Restoration is capped at the amount the
// member's default case actually advanced — never the full missed amount.
export function planBufferRestoration({ bufferUsedKobo, missedKobo, availableBufferAmount }) {
  const advanced = Math.max(0, Math.round(Number(bufferUsedKobo) || 0));
  const missed = Math.max(0, Math.round(Number(missedKobo) || 0));
  const available = Math.max(0, Math.round(Number(availableBufferAmount) || 0));
  if (advanced === 0 || available === 0) return { restorable: 0, capped: false };
  const restorable = Math.min(advanced, available);
  return { restorable, capped: restorable < advanced, missed };
}