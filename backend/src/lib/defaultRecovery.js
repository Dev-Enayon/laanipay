// Default, grace, buffer drawdown, catch-up, fine, recovery and death workflow.
//
// SCOPE AND INTENT
// This module is the state/audit layer for what happens when a weekly AJO
// member misses a contribution. It is deliberately conservative: it records
// what happened, moves money ONLY under an explicitly configured and approved
// policy, and surfaces anything it cannot resolve to a human instead of
// inventing an accounting rule.
//
// The state machine is carried on the EXISTING CohortMember row
// (`defaultStatus`) plus the existing `status` participation lifecycle — no
// parallel status system was created.
//
// Hard money rules enforced here:
//   - A missed contribution is RECORDED, never silently absorbed.
//   - Grace is configurable (`defaultPolicy.graceDays`), never a hard-coded 7.
//   - Buffer protection is all-or-nothing by default. When the buffer cannot
//     cover the required protection the result is BUFFER_INSUFFICIENT with an
//     explicit shortfall that is persisted on the recovery case and surfaced to
//     admin. The shortfall is NEVER taken from the main pot, from other
//     members' buffers, or invented, and no payout is marked paid for it.
//   - A catch-up payment is SPLIT (missed + current + fine) and each part is
//     accounted for separately; buffer restoration is bounded by what was
//     actually advanced.
//   - A defaulted member is CLOSED, never deleted. No user, payment, buffer,
//     fine, debt or audit row is ever erased.
//   - Death is a SEPARATE workflow. Nothing here charges the family or the
//     guarantor, and `estate_determination` stays 'UNRESOLVED' until a human
//     decides the accounting treatment.
//   - Guarantors are a RECORDED REFERENCE. Nothing debits or charges them.
//
// All monetary values are integer kobo.

import { prisma } from './prisma.js';
import { getPlatformConfig } from './config.js';
import { logAuditTx } from './audit.js';
import {
  applyBufferProtection,
  bufferBalance,
  contributionBufferSplit,
  planBufferProtection,
  planBufferRestoration,
  restoreBufferFromCatchUp,
} from './bufferFund.js';
import { AppError } from '../middleware/error.js';

// ---------------------------------------------------------------------------
// State machine definitions
// ---------------------------------------------------------------------------

// The missed-contribution state machine, carried on CohortMember.defaultStatus.
//   ACTIVE → PAYMENT_MISSED → GRACE → CAUGHT_UP
//                                 └────→ DEFAULTED → RECOVERY
export const MEMBER_DEFAULT_STATES = Object.freeze({
  ACTIVE: 'ACTIVE',
  PAYMENT_MISSED: 'PAYMENT_MISSED',
  GRACE: 'GRACE',
  CAUGHT_UP: 'CAUGHT_UP',
  DEFAULTED: 'DEFAULTED',
  RECOVERY: 'RECOVERY',
});

// MissedContribution.status uses the same vocabulary minus the recovery stage.
export const MISSED_STATES = Object.freeze({
  MISSED: 'MISSED',
  GRACE: 'GRACE',
  CAUGHT_UP: 'CAUGHT_UP',
  DEFAULTED: 'DEFAULTED',
});

// Legal transitions. Anything not listed is rejected so a bug (or a bad admin
// call) can never drive a member into an impossible state.
const ALLOWED_TRANSITIONS = Object.freeze({
  ACTIVE: ['PAYMENT_MISSED'],
  PAYMENT_MISSED: ['GRACE', 'CAUGHT_UP', 'DEFAULTED'],
  GRACE: ['CAUGHT_UP', 'DEFAULTED'],
  DEFAULTED: ['RECOVERY', 'CAUGHT_UP'],
  RECOVERY: ['CAUGHT_UP'],
  CAUGHT_UP: ['PAYMENT_MISSED', 'ACTIVE'],
});

export function canTransitionMemberDefault(from, to) {
  if (from === to) return true; // idempotent re-entry
  return (ALLOWED_TRANSITIONS[from] ?? []).includes(to);
}

// Death is a separate workflow with its own machine. It is NOT reachable from
// the ordinary default states — a death is reported, not defaulted into.
export const DEATH_STATES = Object.freeze({
  DEATH_REPORTED: 'DEATH_REPORTED',
  DEATH_VERIFICATION: 'DEATH_VERIFICATION',
  VERIFIED_DECEASED: 'VERIFIED_DECEASED',
  PARTICIPATION_CLOSED: 'PARTICIPATION_CLOSED',
  FINANCIAL_REVIEW: 'FINANCIAL_REVIEW',
  ESTATE_RESOLUTION: 'ESTATE_RESOLUTION',
});

// The verification step is performed by an admin presenting evidence, so
// DEATH_REPORTED may go straight to VERIFIED_DECEASED. DEATH_VERIFICATION is
// retained as the explicit "verification in progress" marker and is equally
// valid as an entry point. Both are allowed so the machine can never dead-end
// on a state nothing is able to advance.
const ALLOWED_DEATH_TRANSITIONS = Object.freeze({
  DEATH_REPORTED: ['DEATH_VERIFICATION', 'VERIFIED_DECEASED'],
  DEATH_VERIFICATION: ['VERIFIED_DECEASED'],
  VERIFIED_DECEASED: ['PARTICIPATION_CLOSED'],
  PARTICIPATION_CLOSED: ['FINANCIAL_REVIEW'],
  FINANCIAL_REVIEW: ['ESTATE_RESOLUTION'],
  ESTATE_RESOLUTION: [],
});

export function canTransitionDeath(from, to) {
  if (from === to) return true;
  return (ALLOWED_DEATH_TRANSITIONS[from] ?? []).includes(to);
}

export const RECOVERY_STATUSES = Object.freeze([
  'OPEN',
  'CONTACTING',
  'PROMISED',
  'PARTIALLY_RECOVERED',
  'RECOVERED',
  'ESCALATED',
  'CLOSED',
]);

// Audit actions. Reuses the existing audit_logs table.
export const AUDIT_ACTIONS = Object.freeze({
  MISSED_PAYMENT: 'MISSED_PAYMENT',
  GRACE_STARTED: 'GRACE_STARTED',
  CATCHUP_PAYMENT: 'CATCHUP_PAYMENT',
  DEFAULT_CREATED: 'DEFAULT_CREATED',
  FINE_APPLIED: 'FINE_APPLIED',
  RECOVERY_STARTED: 'RECOVERY_STARTED',
  RECOVERY_UPDATED: 'RECOVERY_UPDATED',
  MEMBER_CLOSED: 'MEMBER_CLOSED',
  DEATH_REPORTED: 'DEATH_REPORTED',
  DEATH_VERIFIED: 'DEATH_VERIFIED',
  BUFFER_CREDIT: 'BUFFER_CREDIT',
  BUFFER_DEBIT: 'BUFFER_DEBIT',
  BUFFER_REFUND: 'BUFFER_REFUND',
  BUFFER_ADJUSTMENT: 'BUFFER_ADJUSTMENT',
  BUFFER_INSUFFICIENT: 'BUFFER_INSUFFICIENT',
  BUFFER_RESTORED: 'BUFFER_RESTORED',
});

// Idempotency reference builders. Each financial/state operation has a stable
// key so a retry can never double-apply it.
export const REFERENCES = Object.freeze({
  missed: ({ cohortId, memberId, weekIndex }) => `miss:${cohortId}:${memberId}:w${weekIndex}`,
  defaultCase: ({ cohortId, memberId, weekIndex }) =>
    weekIndex != null ? `default:${cohortId}:${memberId}:w${weekIndex}` : `default:${cohortId}:${memberId}`,
  fine: ({ defaultId }) => `fine:${defaultId}`,
  death: ({ userId, reference }) => `death:${userId}:${reference ?? 'reported'}`,
});

const DAY_MS = 24 * 60 * 60 * 1000;

// Grace length in ms from the configurable policy. Falls back to 7 days ONLY
// as a last-resort default when no policy is stored; the value is still a
// config value, never a constant in the business logic.
// Grace window in ms. `graceDays` is a real, validated config value (0-90), so
// 0 is meaningful: it means "no grace — default immediately". Only a missing or
// non-numeric value falls back, and the fallback is itself a config default
// rather than a business constant.
export function graceDurationMs(policy) {
  const days = Number(policy?.graceDays);
  if (Number.isFinite(days) && days >= 0) return Math.round(days * DAY_MS);
  return 7 * DAY_MS;
}

// A week's protection requirement: the difference between what the group
// expected to collect and what it actually collected, net of the platform fee.
// Derived from real verified payments — never an assumed number.
export function protectionRequirement({ expectedWeeklyAmount, paidCount, expectedCount, feePercent }) {
  const amount = Math.max(0, Math.round(Number(expectedWeeklyAmount) || 0));
  const paid = Math.max(0, Math.round(Number(paidCount) || 0));
  const expected = Math.max(0, Math.round(Number(expectedCount) || 0));
  if (expected <= paid || amount <= 0) return 0;
  const missing = expected - paid;
  const grossShortfall = amount * missing;
  const pct = Math.min(100, Math.max(0, Number(feePercent) || 0));
  return grossShortfall - Math.round((grossShortfall * pct) / 100);
}

// ---------------------------------------------------------------------------
// Missed contribution detection (idempotent)
// ---------------------------------------------------------------------------

// Records a missed weekly contribution for a member. Idempotent on
// (cohort, member, week): a repeated sweep updates nothing and returns the
// existing row. When `withGrace` is set (the default), the member moves
// PAYMENT_MISSED → GRACE and a grace deadline is stamped. The member is NOT
// removed — grace exists precisely so they can catch up.
export async function recordMissedContribution({
  tx,
  cohort,
  member,
  weekIndex,
  amountKobo,
  bufferAmountKobo = 0,
  dueAt,
  config,
  withGrace = true,
  notify = false,
  adminId = null,
}) {
  const amount = Math.max(0, Math.round(Number(amountKobo) || 0));
  if (amount <= 0) return { created: false, reason: 'zero_amount' };

  const reference = REFERENCES.missed({ cohortId: cohort.id, memberId: member.id, weekIndex });
  const existing = await tx.missedContribution.findUnique({ where: { reference } });
  if (existing) return { created: false, reason: 'already_recorded', missed: existing };

  const policy = config?.defaultPolicy ?? {};
  const graceEndsAt = withGrace ? new Date(new Date(dueAt).getTime() + graceDurationMs(policy)) : null;
  const initialStatus = withGrace ? MISSED_STATES.GRACE : MISSED_STATES.MISSED;

  const missed = await tx.missedContribution.create({
    data: {
      cohortId: cohort.id,
      memberId: member.id,
      userId: member.userId,
      weekIndex,
      amountKobo: amount,
      bufferAmountKobo: Math.max(0, Math.round(Number(bufferAmountKobo) || 0)),
      dueAt: new Date(dueAt),
      status: initialStatus,
      graceEndsAt,
      reference,
      metadata: { planId: cohort.planId, expectedAmountKobo: amount },
    },
  });

  // Move the member into the state machine. ACTIVE → PAYMENT_MISSED → GRACE.
  let memberState = member.defaultStatus ?? MEMBER_DEFAULT_STATES.ACTIVE;
  if (memberState === MEMBER_DEFAULT_STATES.ACTIVE) {
    memberState = MEMBER_DEFAULT_STATES.PAYMENT_MISSED;
  }
  if (withGrace && canTransitionMemberDefault(memberState, MEMBER_DEFAULT_STATES.GRACE)) {
    memberState = MEMBER_DEFAULT_STATES.GRACE;
  }
  await tx.cohortMember.update({ where: { id: member.id }, data: { defaultStatus: memberState } });

  await logAuditTx({
    tx,
    userId: member.userId,
    adminId,
    targetUserId: member.userId,
    action: AUDIT_ACTIONS.MISSED_PAYMENT,
    reason: `Week ${weekIndex} contribution of ₦${(amount / 100).toLocaleString('en-NG')} was not received`,
    metadata: {
      cohortId: cohort.id,
      memberId: member.id,
      weekIndex,
      amountKobo: amount,
      dueAt: new Date(dueAt).toISOString(),
      graceEndsAt: graceEndsAt ? graceEndsAt.toISOString() : null,
      missedContributionId: missed.id,
    },
  });

  if (withGrace) {
    await logAuditTx({
      tx,
      userId: member.userId,
      adminId,
      targetUserId: member.userId,
      action: AUDIT_ACTIONS.GRACE_STARTED,
      reason: `Grace period started until ${graceEndsAt.toISOString()}`,
      metadata: {
        cohortId: cohort.id,
        memberId: member.id,
        weekIndex,
        graceDays: Number.isFinite(Number(policy.graceDays)) ? Number(policy.graceDays) : 7,
        graceEndsAt: graceEndsAt.toISOString(),
        missedContributionId: missed.id,
      },
    });
  }

  const result = { created: true, missed, graceEndsAt, memberState, notify };

  // Notifications are deliberately OUTSIDE the transaction: the notification
  // subsystem uses its own Prisma client and must not be part of the money tx.
  return result;
}

// Sweeps one cohort for unpaid weeks. For each ACTIVE member with no verified
// payment for the current week, records a miss (+ grace). Returns a summary.
// Idempotent: safe to run repeatedly.
export async function detectMissedContributions({ cohortId, weekIndex = null, tx: externalTx, notify = true, adminId = null }) {
  const run = async (tx) => {
    const cohort = await tx.cohort.findUnique({
      where: { id: cohortId },
      include: { plan: true, members: true },
    });
    if (!cohort) throw new AppError('Cohort not found', 404);
    if (cohort.status !== 'ACTIVE') return { cohortId, skipped: 'cohort_not_active', detected: [] };

    const config = await getPlatformConfig();
    if (config.defaultPolicy?.enabled !== true) {
      return { cohortId, skipped: 'default_policy_disabled', detected: [] };
    }

    const week = weekIndex ?? cohort.currentWeek;
    const members = cohort.members.filter((m) => m.status === 'ACTIVE');
    if (members.length === 0) return { cohortId, week, detected: [] };

    const paidRows = await tx.contributionPayment.findMany({
      where: { cohortId: cohort.id, weekIndex: week, status: 'verified' },
      select: { subscription: { select: { userId: true } } },
    });
    const paidUserIds = new Set(paidRows.map((r) => r.subscription.userId));

    // A member is charged their subscription's frozen `amountKobo` snapshot
    // (which can legitimately differ from the plan's live weeklyAmount after a
    // price change), so the miss MUST be recorded at the amount they were
    // actually billed. Using the plan amount here would demand the wrong
    // amount at catch-up and mis-size the buffer. The plan amount is only a
    // fallback for rows with no snapshot.
    const subscriptionRows = await tx.contributionSubscription.findMany({
      where: { cohortId: cohort.id, userId: { in: members.map((m) => m.userId) }, status: { not: 'CANCELLED' } },
      select: { userId: true, amountKobo: true, plan: { select: { weeklyAmount: true } } },
    });
    const amountByUser = new Map();
    for (const s of subscriptionRows) {
      const amount = s.amountKobo ?? s.plan?.weeklyAmount ?? cohort.plan?.weeklyAmount ?? 0;
      if (amount > 0) amountByUser.set(s.userId, amount);
    }

    const planWeeklyAmount = cohort.plan?.weeklyAmount ?? 0;
    const dueAt = new Date();
    const detected = [];

    for (const member of members) {
      if (paidUserIds.has(member.userId)) continue;
      if (member.defaultStatus === MEMBER_DEFAULT_STATES.DEFAULTED) continue; // already handled

      const weeklyAmount = amountByUser.get(member.userId) ?? planWeeklyAmount;
      if (weeklyAmount <= 0) continue; // no billable amount recorded — do not invent a miss

      // What this member's miss would have contributed to the buffer, had they
      // paid. Informational only — a missed payment credits no buffer.
      const wouldBeBuffer = contributionBufferSplit(weeklyAmount, config.bufferPolicy).bufferAmount;

      const res = await recordMissedContribution({
        tx,
        cohort,
        member,
        weekIndex: week,
        amountKobo: weeklyAmount,
        bufferAmountKobo: wouldBeBuffer,
        dueAt,
        config,
        withGrace: true,
        notify,
        adminId,
      });
      if (res.created) {
        detected.push({
          memberId: member.id,
          userId: member.userId,
          weekIndex: week,
          amountKobo: weeklyAmount,
          missedContributionId: res.missed.id,
          graceEndsAt: res.graceEndsAt,
        });
      }
    }

    return { cohortId, week, detected };
  };

  if (externalTx) return run(externalTx);
  return prisma.$transaction(run);
}

// ---------------------------------------------------------------------------
// Buffer protection (the payout-side drawdown)
// ---------------------------------------------------------------------------

// Decides whether the cohort's buffer can protect this week's payout from the
// members who did not pay, and applies the debit when it can.
//
// Returns the plan verbatim so the caller can persist `shortfall`. When the
// plan is BUFFER_INSUFFICIENT NOTHING is debited, the shortfall is recorded on
// the recovery case, and it is surfaced to admin. The main pot is never used
// as a fallback unless `mainPotFallback` was explicitly approved in config.
export async function protectCohortPayout({ tx, cohort, week, plan: externalPlan = null, config, adminId = null }) {
  const cfg = config ?? (await getPlatformConfig());
  const bufferRows = await tx.bufferLedger.findMany({
    where: { cohortId: cohort.id },
    select: { amountKobo: true, sign: true, eventType: true },
  });
  const available = bufferBalance(bufferRows);

  const plan =
    externalPlan ??
    planBufferProtection({
      availableBufferAmount: available,
      requiredProtectionAmount: 0,
      allowPartialProtection: cfg.bufferPolicy?.allowPartialProtection === true,
      mainPotFallback: cfg.bufferPolicy?.mainPotFallback === true,
    });

  if (!plan.ok || plan.protectedAmount <= 0) {
    // BUFFER_INSUFFICIENT (or nothing to do). No debit is written. If there is
    // a real shortfall it is persisted on the open recovery cases and logged.
    if (plan.outcome === 'BUFFER_INSUFFICIENT' && plan.shortfall > 0) {
      const cases = await tx.contributionDefault.findMany({
        where: { cohortId: cohort.id, status: { in: ['OPEN', 'CONTACTING', 'PROMISED', 'ESCALATED'] } },
        select: { id: true, userId: true },
      });
      for (const c of cases) {
        await tx.contributionDefault.updateMany({
          where: { id: c.id },
          data: { shortfallKobo: plan.shortfall },
        });
        await logAuditTx({
          tx,
          userId: c.userId,
          adminId,
          targetUserId: c.userId,
          action: AUDIT_ACTIONS.BUFFER_INSUFFICIENT,
          reason: `Buffer cannot cover the protection requirement — shortfall ₦${(plan.shortfall / 100).toLocaleString('en-NG')}`,
          metadata: {
            cohortId: cohort.id,
            week,
            available: plan.available,
            required: plan.required,
            shortfall: plan.shortfall,
            defaultId: c.id,
            mainPotFallbackApplied: false,
          },
        });
      }
    }
    return { recorded: false, plan, ledger: null };
  }

  // The debit is attributed to the cohort's protection obligation. A
  // cohort-level protection has no single defaulting member, so it is booked
  // against the cohort's first still-open case when one exists purely for
  // traceability; the ledger's userId is that member (the ledger is
  // per-(cohort,user)). When no case exists the caller should supply a
  // userId; without one we cannot write a valid per-user ledger row, so we
  // return the plan WITHOUT debiting rather than invent an owner.
  const ownerCase = await tx.contributionDefault.findFirst({
    where: { cohortId: cohort.id, status: { in: ['OPEN', 'CONTACTING', 'PROMISED', 'ESCALATED'] } },
    orderBy: { createdAt: 'asc' },
    select: { id: true, userId: true },
  });

  if (!ownerCase) {
    // No recovery case to attach the advance to. Do NOT create money or guess
    // an owner — report the plan so the caller can decide.
    return { recorded: false, plan, ledger: null, reason: 'no_open_case_to_attach' };
  }

  const applied = await applyBufferProtection({
    tx,
    plan,
    cohortId: cohort.id,
    userId: ownerCase.userId,
    defaultId: ownerCase.id,
    weekIndex: week,
    actor: 'system',
    metadata: { cohortId: cohort.id, week, defaultId: ownerCase.id },
  });

  if (applied.recorded) {
    // Record the advance on the case and log the debit.
    await tx.contributionDefault.update({
      where: { id: ownerCase.id },
      data: { bufferUsedKobo: { increment: plan.protectedAmount } },
    });
    await logAuditTx({
      tx,
      userId: ownerCase.userId,
      adminId,
      targetUserId: ownerCase.userId,
      action: AUDIT_ACTIONS.BUFFER_DEBIT,
      reason: `Buffer advanced ₦${(plan.protectedAmount / 100).toLocaleString('en-NG')} to protect the week ${week} group payout`,
      metadata: {
        cohortId: cohort.id,
        week,
        defaultId: ownerCase.id,
        protectedAmount: plan.protectedAmount,
        availableBefore: plan.available,
        required: plan.required,
        shortfall: plan.shortfall,
      },
    });
  }

  return applied;
}

// ---------------------------------------------------------------------------
// Default case + fine (grace expiry)
// ---------------------------------------------------------------------------

// Opens (or reuses) the recovery case for a defaulted member. Idempotent on
// (cohort, member) — a member has at most one open case. Assesses the fine
// only when the fine policy is enabled, and the fine is its own financial
// event with a unique reference so it can never be charged twice.
export async function openDefaultCase({ tx, cohort, member, weekIndex = null, config, adminId = null, actor = 'system' }) {
  const cfg = config ?? (await getPlatformConfig());
  const reference = weekIndex != null
    ? REFERENCES.defaultCase({ cohortId: cohort.id, memberId: member.id, weekIndex })
    : REFERENCES.defaultCase({ cohortId: cohort.id, memberId: member.id });

  const existing = await tx.contributionDefault.findUnique({ where: { reference } });
  if (existing) return { created: false, defaultCase: existing };

  // Sum every unresolved miss for this member (grace-expired or still open) to
  // get the outstanding missed principal. Never estimate.
  const misses = await tx.missedContribution.findMany({
    where: { memberId: member.id, status: { in: [MISSED_STATES.MISSED, MISSED_STATES.GRACE] } },
    select: { id: true, amountKobo: true, weekIndex: true },
  });
  const missedTotal = misses.reduce((sum, m) => sum + m.amountKobo, 0);
  const firstWeek = weekIndex ?? misses[0]?.weekIndex ?? null;
  const firstMiss = misses[0] ?? null;

  // Fine: configured, never hard-coded; zero while disabled.
  const finePolicy = cfg.finePolicy ?? {};
  const fineAmount = finePolicy.enabled === true ? Math.max(0, Math.round(Number(finePolicy.amountKobo) || 0)) : 0;
  const outstanding = missedTotal + fineAmount;

  const defaultCase = await tx.contributionDefault.create({
    data: {
      cohortId: cohort.id,
      memberId: member.id,
      userId: member.userId,
      weekIndex: firstWeek,
      reference,
      status: 'OPEN',
      missedKobo: missedTotal,
      fineKobo: fineAmount,
      bufferUsedKobo: 0,
      shortfallKobo: 0,
      recoveredKobo: 0,
      outstandingKobo: outstanding,
      missedContributionId: firstMiss?.id ?? null,
      metadata: { openedBy: actor },
    },
  });

  // Mark the contributing misses as defaulted.
  for (const m of misses) {
    await tx.missedContribution.updateMany({
      where: { id: m.id, status: { in: [MISSED_STATES.MISSED, MISSED_STATES.GRACE] } },
      data: { status: MISSED_STATES.DEFAULTED },
    });
  }

  await logAuditTx({
    tx,
    userId: member.userId,
    adminId,
    targetUserId: member.userId,
    action: AUDIT_ACTIONS.DEFAULT_CREATED,
    reason: `Default case opened — ₦${(outstanding / 100).toLocaleString('en-NG')} outstanding`,
    metadata: {
      cohortId: cohort.id,
      memberId: member.id,
      defaultId: defaultCase.id,
      missedKobo: missedTotal,
      fineKobo: fineAmount,
      outstandingKobo: outstanding,
    },
  });

  await logAuditTx({
    tx,
    userId: member.userId,
    adminId,
    targetUserId: member.userId,
    action: AUDIT_ACTIONS.RECOVERY_STARTED,
    reason: 'Recovery case opened',
    metadata: { defaultId: defaultCase.id, cohortId: cohort.id },
  });

  // Fine is its own financial event (idempotent on the case).
  let fine = null;
  if (fineAmount > 0) {
    fine = await assessFine({ tx, defaultCase, config: cfg, adminId });
  }

  // Move the member into DEFAULTED (participation is closed separately and
  // only when the policy allows).
  const from = member.defaultStatus ?? MEMBER_DEFAULT_STATES.ACTIVE;
  if (canTransitionMemberDefault(from, MEMBER_DEFAULT_STATES.DEFAULTED)) {
    await tx.cohortMember.update({
      where: { id: member.id },
      data: { defaultStatus: MEMBER_DEFAULT_STATES.DEFAULTED },
    });
  }

  return { created: true, defaultCase, fine, missedTotal, fineAmount };
}

// Records the assessed fine as its own financial event. Idempotent on
// `fine:{defaultId}` — a retry returns the existing fine.
export async function assessFine({ tx, defaultCase, reason = 'Missed contribution default', config, adminId = null }) {
  const cfg = config ?? (await getPlatformConfig());
  const finePolicy = cfg.finePolicy ?? {};
  const amount = finePolicy.enabled === true ? Math.max(0, Math.round(Number(finePolicy.amountKobo) || 0)) : 0;
  if (amount <= 0) return null;

  const reference = REFERENCES.fine({ defaultId: defaultCase.id });
  const existing = await tx.contributionFine.findUnique({ where: { reference } });
  if (existing) return existing;

  const fine = await tx.contributionFine.create({
    data: {
      defaultId: defaultCase.id,
      cohortId: defaultCase.cohortId,
      userId: defaultCase.userId,
      amountKobo: amount,
      reason,
      reference,
      destination: finePolicy.destination ?? 'unassigned',
      status: 'ASSESSED',
    },
  });

  await logAuditTx({
    tx,
    userId: defaultCase.userId,
    adminId,
    targetUserId: defaultCase.userId,
    action: AUDIT_ACTIONS.FINE_APPLIED,
    reason: `Default fine of ₦${(amount / 100).toLocaleString('en-NG')} assessed`,
    metadata: { defaultId: defaultCase.id, fineId: fine.id, amountKobo: amount, cohortId: defaultCase.cohortId },
  });

  return fine;
}

// Expires grace for members whose grace deadline has passed: moves them
// DEFAULTED, opens the recovery case and (if configured) closes participation.
// Never deletes anything. Returns a per-member summary. Idempotent.
export async function expireGracePeriods({ tx: externalTx, cohortId = null, now = new Date(), config, adminId = null }) {
  const run = async (tx) => {
    const cfg = config ?? (await getPlatformConfig());

    const members = await tx.cohortMember.findMany({
      where: {
        defaultStatus: { in: [MEMBER_DEFAULT_STATES.GRACE, MEMBER_DEFAULT_STATES.PAYMENT_MISSED] },
        ...(cohortId ? { cohortId } : {}),
        cohort: { status: 'ACTIVE' },
      },
      include: { cohort: { include: { plan: true } } },
    });

    const results = [];
    for (const member of members) {
      // Has every miss for this member passed its grace deadline?
      const openMisses = await tx.missedContribution.findMany({
        where: { memberId: member.id, status: { in: [MISSED_STATES.MISSED, MISSED_STATES.GRACE] } },
        select: { graceEndsAt: true, dueAt: true },
      });
      const allExpired =
        openMisses.length > 0 &&
        openMisses.every((m) => new Date(m.graceEndsAt ?? m.dueAt).getTime() <= now.getTime());
      if (!allExpired) continue;

      const opened = await openDefaultCase({
        tx,
        cohort: member.cohort,
        member,
        config: cfg,
        adminId,
      });

      let closed = null;
      if (cfg.defaultPolicy?.closeOnDefault === true) {
        closed = await closeMemberParticipation({
          tx,
          member,
          cohort: member.cohort,
          reason: 'Grace period expired without catch-up',
          adminId,
        });
      }

      results.push({
        memberId: member.id,
        userId: member.userId,
        cohortId: member.cohortId,
        defaultId: opened.defaultCase?.id ?? null,
        created: opened.created,
        fineKobo: opened.fineAmount ?? 0,
        outstandingKobo: opened.defaultCase?.outstandingKobo ?? 0,
        participationClosed: !!closed,
      });
    }
    return results;
  };

  if (externalTx) return run(externalTx);
  return prisma.$transaction(run);
}

// Closes a member's participation WITHOUT deleting anything: the member row,
// their payments, buffer records, fines, debts, recovery case and audit logs
// are all preserved. Only the participation lifecycle is ended. Membership
// status becomes 'DEFAULTED' (an addition to the existing status vocabulary,
// alongside ACTIVE/COLLECTED/WAIVED/LEFT) and the delinquency track is set to
// RECOVERY so admin tooling picks it up.
export async function closeMemberParticipation({ tx, member, cohort, reason = 'Defaulted', adminId = null, actor = 'system' }) {
  const current = await tx.cohortMember.findUnique({ where: { id: member.id } });
  if (!current) throw new AppError('Cohort member not found', 404);
  if (current.status !== 'ACTIVE' && current.status !== 'COLLECTED') {
    return { closed: false, reason: `already_${current.status}` };
  }

  const updated = await tx.cohortMember.update({
    where: { id: member.id },
    data: {
      status: 'DEFAULTED',
      defaultStatus: MEMBER_DEFAULT_STATES.RECOVERY,
      closedAt: new Date(),
      closedReason: reason,
    },
  });

  await logAuditTx({
    tx,
    userId: member.userId,
    adminId,
    targetUserId: member.userId,
    action: AUDIT_ACTIONS.MEMBER_CLOSED,
    reason,
    metadata: { cohortId: member.cohortId, memberId: member.id, closedBy: actor, previousStatus: current.status },
  });

  return { closed: true, member: updated };
}

// ---------------------------------------------------------------------------
// Catch-up payment (PART 4)
// ---------------------------------------------------------------------------

// Quotes what a returning member owes and how it will be split. Pure and
// config-driven — the ₦5,000/₦2,000 in the business example are never
// hard-coded; they come from the subscription amount and the fine policy.
//
//   missedKobo  — every unresolved missed contribution (principal)
//   currentKobo — the normal contribution for the current period
//   fineKobo    — the assessed fine (0 unless a fine exists and is enabled)
//   totalKobo   — the sum; must equal the real payment amount
export function buildCatchUpQuote({ missedRows = [], currentAmountKobo, fineKobo = 0 }) {
  const missed = missedRows.reduce((sum, m) => sum + Math.max(0, Math.round(Number(m.amountKobo) || 0)), 0);
  const current = Math.max(0, Math.round(Number(currentAmountKobo) || 0));
  const fine = Math.max(0, Math.round(Number(fineKobo) || 0));
  return { missedKobo: missed, currentKobo: current, fineKobo: fine, totalKobo: missed + current + fine };
}

// Applies a verified catch-up payment: verifies the paid amount matches the
// quote, restores whatever buffer was previously advanced for this member
// (bounded by the advance and by the buffer's actual balance), marks the
// misses CAUGHT_UP, collects the fine, and moves the member to CAUGHT_UP. Every
// step is idempotent. Must be called inside the payment's transaction.
export async function applyCatchUpSettlement({ tx, cohort, member, payment, quote, missedRows = [], config, adminId = null }) {
  const cfg = config ?? (await getPlatformConfig());
  const paid = payment.amount;

  // The real payment governs. If it does not cover the quote we refuse to
  // pretend it did — no silent partial settlement of the debt.
  if (paid < quote.totalKobo) {
    throw new AppError(
      `Catch-up payment of ₦${(paid / 100).toLocaleString('en-NG')} does not cover the ₦${(quote.totalKobo / 100).toLocaleString('en-NG')} owed`,
      400,
    );
  }

  // Payment-level replay guard. A MissedContribution row is only ever linked to
  // the payment that settled it, so finding one already pointing at THIS
  // payment proves the whole settlement ran before. Returning here is what
  // keeps the recovery case balances (recovered/outstanding/bufferUsed) and
  // the buffer ledger from being decremented twice by a retried webhook.
  const alreadySettled = await tx.missedContribution.findFirst({
    where: { caughtUpPaymentId: payment.id },
    select: { id: true },
  });
  if (alreadySettled) {
    return { replay: true, restored: 0, fineCollected: 0, quote };
  }

  // Buffer restoration: bounded by what was advanced AND the buffer's real
  // balance, so the pool can never be credited more than was debited.
  const openCase = await tx.contributionDefault.findFirst({
    where: { cohortId: cohort.id, memberId: member.id, status: { in: ['OPEN', 'CONTACTING', 'PROMISED', 'PARTIALLY_RECOVERED', 'ESCALATED'] } },
    orderBy: { createdAt: 'asc' },
  });

  let restored = 0;
  if (openCase && openCase.bufferUsedKobo > 0) {
    const bufferRows = await tx.bufferLedger.findMany({
      where: { cohortId: cohort.id },
      select: { amountKobo: true, sign: true, eventType: true },
    });
    const available = bufferBalance(bufferRows);
    const { restorable } = planBufferRestoration({
      bufferUsedKobo: openCase.bufferUsedKobo,
      missedKobo: quote.missedKobo,
      availableBufferAmount: available,
    });

    // Restoration is funded from the catch-up's MISSED portion, capped so it
    // can never exceed what was advanced.
    const restoreTarget = Math.min(restorable, quote.missedKobo);
    if (restoreTarget > 0) {
      const res = await restoreBufferFromCatchUp({
        tx,
        cohortId: cohort.id,
        userId: member.userId,
        paymentId: payment.id,
        amountKobo: restoreTarget,
        paymentReference: payment.paystackReference,
        metadata: { defaultId: openCase.id, missedKobo: quote.missedKobo },
      });
      if (res.recorded) {
        restored = restoreTarget;
        await logAuditTx({
          tx,
          userId: member.userId,
          adminId,
          targetUserId: member.userId,
          action: AUDIT_ACTIONS.BUFFER_RESTORED,
          reason: `Buffer restored ₦${(restoreTarget / 100).toLocaleString('en-NG')} from catch-up payment`,
          metadata: { defaultId: openCase.id, restored: restoreTarget, paymentId: payment.id },
        });
      }
    }
  }

  // Mark the caught-up misses resolved and link the payment.
  for (const m of missedRows) {
    await tx.missedContribution.updateMany({
      where: { id: m.id, status: { in: [MISSED_STATES.MISSED, MISSED_STATES.GRACE, MISSED_STATES.DEFAULTED] } },
      data: { status: MISSED_STATES.CAUGHT_UP, resolvedAt: new Date(), caughtUpPaymentId: payment.id },
    });
  }

  // Collect the fine (idempotent: a fine already COLLECTED is left alone).
  let fineCollected = 0;
  if (openCase && openCase.fineKobo > 0) {
    const fine = await tx.contributionFine.findUnique({ where: { reference: REFERENCES.fine({ defaultId: openCase.id }) } });
    if (fine && fine.status === 'ASSESSED') {
      await tx.contributionFine.update({
        where: { id: fine.id },
        data: { status: 'COLLECTED', collectedPaymentId: payment.id, collectedAt: new Date() },
      });
      fineCollected = fine.amountKobo;
    }
  }

  // Update the recovery case: recovered + restored + fine collected reduce the
  // outstanding balance; fully recovered closes the case.
  if (openCase) {
    const recovered = quote.missedKobo + fineCollected;
    const newOutstanding = Math.max(0, openCase.outstandingKobo - recovered);
    const newRecovered = openCase.recoveredKobo + recovered;
    const fullyRecovered = newOutstanding === 0;
    await tx.contributionDefault.update({
      where: { id: openCase.id },
      data: {
        recoveredKobo: newRecovered,
        outstandingKobo: newOutstanding,
        // Restoration returns buffer to the pool; the debt portion decreases.
        bufferUsedKobo: Math.max(0, openCase.bufferUsedKobo - restored),
        status: fullyRecovered ? 'RECOVERED' : 'PARTIALLY_RECOVERED',
        closedAt: fullyRecovered ? new Date() : null,
      },
    });

    if (fullyRecovered) {
      await logAuditTx({
        tx,
        userId: member.userId,
        adminId,
        targetUserId: member.userId,
        action: AUDIT_ACTIONS.RECOVERY_UPDATED,
        reason: 'Recovery case fully recovered and closed',
        metadata: { defaultId: openCase.id, recovered: newRecovered },
      });
    }
  }

  // Member delinquency state → CAUGHT_UP.
  const from = member.defaultStatus ?? MEMBER_DEFAULT_STATES.ACTIVE;
  if (canTransitionMemberDefault(from, MEMBER_DEFAULT_STATES.CAUGHT_UP)) {
    await tx.cohortMember.update({
      where: { id: member.id },
      data: { defaultStatus: MEMBER_DEFAULT_STATES.CAUGHT_UP },
    });
  }

  await logAuditTx({
    tx,
    userId: member.userId,
    adminId,
    targetUserId: member.userId,
    action: AUDIT_ACTIONS.CATCHUP_PAYMENT,
    reason: `Catch-up payment ₦${(paid / 100).toLocaleString('en-NG')} received (missed ₦${(quote.missedKobo / 100).toLocaleString('en-NG')}, current ₦${(quote.currentKobo / 100).toLocaleString('en-NG')}, fine ₦${(quote.fineKobo / 100).toLocaleString('en-NG')})`,
    metadata: {
      cohortId: cohort.id,
      memberId: member.id,
      paymentId: payment.id,
      missedKobo: quote.missedKobo,
      currentKobo: quote.currentKobo,
      fineKobo: quote.fineKobo,
      bufferRestored: restored,
      fineCollected,
    },
  });

  return { restored, fineCollected, quote };
}

// ---------------------------------------------------------------------------
// Recovery case management (PART 9)
// ---------------------------------------------------------------------------

// Updates the recovery case status/notes. Idempotent no-op when the status is
// unchanged. Validates the status against the known set.
export async function updateRecoveryCase({ tx: externalTx, defaultId, status, adminNotes, contactAttempt = false, promisedKobo = null, adminId = null }) {
  const run = async (tx) => {
    const c = await tx.contributionDefault.findUnique({ where: { id: defaultId } });
    if (!c) throw new AppError('Recovery case not found', 404);

    const data = {};
    if (status !== undefined && status !== null) {
      if (!RECOVERY_STATUSES.includes(status)) {
        throw new AppError(`Invalid recovery status "${status}"`, 400);
      }
      data.status = status;
      if (status === 'CLOSED' || status === 'RECOVERED') data.closedAt = new Date();
    }
    if (adminNotes !== undefined) data.adminNotes = adminNotes;
    if (contactAttempt) {
      data.contactAttempts = { increment: 1 };
      data.lastContactAt = new Date();
    }
    if (promisedKobo !== undefined && promisedKobo !== null) {
      data.promisedKobo = Math.max(0, Math.round(Number(promisedKobo) || 0));
      data.promisedAt = new Date();
      if (status === undefined) data.status = 'PROMISED';
    }

    const updated = await tx.contributionDefault.update({ where: { id: defaultId }, data });
    await logAuditTx({
      tx,
      userId: c.userId,
      adminId,
      targetUserId: c.userId,
      action: AUDIT_ACTIONS.RECOVERY_UPDATED,
      reason: `Recovery case ${updated.id} updated`,
      metadata: { defaultId, status: updated.status, contactAttempt, promisedKobo: updated.promisedKobo },
    });
    return updated;
  };

  if (externalTx) return run(externalTx);
  return prisma.$transaction(run);
}

// ---------------------------------------------------------------------------
// Death workflow (PART 11)
// ---------------------------------------------------------------------------

// Opens a death case. This NEVER charges anyone and NEVER debits a guarantor.
// It records the report and moves the case into verification. Idempotent on
// `death:{userId}:{reference}`.
export async function reportDeath({ tx: externalTx, userId, cohortId = null, reportedBy = null, evidenceReference = null, adminId = null }) {
  const run = async (tx) => {
    const reference = REFERENCES.death({ userId, reference: evidenceReference });
    const existing = await tx.deathCase.findUnique({ where: { reference } });
    if (existing) return { created: false, deathCase: existing };

    const member = await tx.cohortMember.findFirst({
      where: { userId, ...(cohortId ? { cohortId } : {}) },
      orderBy: { joinedAt: 'asc' },
    });

    const deathCase = await tx.deathCase.create({
      data: {
        userId,
        cohortId: cohortId ?? member?.cohortId ?? null,
        defaultId: member
          ? (await tx.contributionDefault.findFirst({ where: { memberId: member.id, status: { in: ['OPEN', 'CONTACTING', 'PROMISED', 'ESCALATED'] } } }))?.id ?? null
          : null,
        reference,
        status: DEATH_STATES.DEATH_REPORTED,
        reportedBy,
        verificationEvidence: evidenceReference,
        estateDetermination: 'UNRESOLVED',
      },
    });

    await logAuditTx({
      tx,
      userId,
      adminId,
      targetUserId: userId,
      action: AUDIT_ACTIONS.DEATH_REPORTED,
      reason: 'Death reported — death workflow opened (no charges applied)',
      metadata: { deathCaseId: deathCase.id, cohortId: deathCase.cohortId, reportedBy },
    });

    return { created: true, deathCase };
  };

  if (externalTx) return run(externalTx);
  return prisma.$transaction(run);
}

// Advances a death case through verification. `evidenceReference` is a
// DOCUMENT POINTER only — no identity documents are stored. Does not touch any
// money: no family charge, no guarantor debit, no buffer promise.
export async function verifyDeath({ tx: externalTx, deathCaseId, evidenceReference, verificationReference, adminId = null }) {
  const run = async (tx) => {
    const c = await tx.deathCase.findUnique({ where: { id: deathCaseId } });
    if (!c) throw new AppError('Death case not found', 404);
    if (c.status === DEATH_STATES.VERIFIED_DECEASED || c.status === DEATH_STATES.PARTICIPATION_CLOSED) {
      return c; // already verified — idempotent
    }
    if (!canTransitionDeath(c.status, DEATH_STATES.VERIFIED_DECEASED)) {
      throw new AppError(`Cannot verify death from status ${c.status}`, 400);
    }

    const updated = await tx.deathCase.update({
      where: { id: deathCaseId },
      data: {
        status: DEATH_STATES.VERIFIED_DECEASED,
        verifiedAt: new Date(),
        verificationReference: verificationReference ?? evidenceReference ?? null,
        verificationEvidence: evidenceReference ?? c.verificationEvidence,
      },
    });

    await logAuditTx({
      tx,
      userId: c.userId,
      adminId,
      targetUserId: c.userId,
      action: AUDIT_ACTIONS.DEATH_VERIFIED,
      reason: 'Death verified (evidence reference recorded; no financial charge applied)',
      metadata: { deathCaseId, verificationReference, evidenceReference },
    });

    return updated;
  };

  if (externalTx) return run(externalTx);
  return prisma.$transaction(run);
}

// Moves a verified death case to PARTICIPATION_CLOSED and closes the member's
// participation (never deleting the user or their history).
export async function closeDeathParticipation({ tx: externalTx, deathCaseId, reason = 'Death — participation closed', adminId = null }) {
  const run = async (tx) => {
    const c = await tx.deathCase.findUnique({ where: { id: deathCaseId } });
    if (!c) throw new AppError('Death case not found', 404);
    if (c.status === DEATH_STATES.PARTICIPATION_CLOSED || c.status === DEATH_STATES.FINANCIAL_REVIEW) {
      return c; // idempotent
    }
    if (!canTransitionDeath(c.status, DEATH_STATES.PARTICIPATION_CLOSED)) {
      throw new AppError(`Cannot close participation from status ${c.status}`, 400);
    }

    let closedMember = null;
    const member = await tx.cohortMember.findFirst({ where: { userId: c.userId, ...(c.cohortId ? { cohortId: c.cohortId } : {}) } });
    if (member) {
      const res = await closeMemberParticipation({ tx, member, cohort: { id: member.cohortId }, reason, adminId });
      closedMember = res.closed ? res.member : null;
    }

    const updated = await tx.deathCase.update({
      where: { id: deathCaseId },
      data: { status: DEATH_STATES.PARTICIPATION_CLOSED, participationClosedAt: new Date() },
    });

    await logAuditTx({
      tx,
      userId: c.userId,
      adminId,
      targetUserId: c.userId,
      action: AUDIT_ACTIONS.RECOVERY_UPDATED,
      reason: 'Death case — participation closed (history preserved)',
      metadata: { deathCaseId, memberId: member?.id ?? null },
    });

    return updated;
  };

  if (externalTx) return run(externalTx);
  return prisma.$transaction(run);
}

// Records the financial review snapshot of a death case. This reads REAL
// figures from the ledger; it does not charge anyone. `estateDueKobo` and
// `estateDetermination` remain UNRESOLVED/null unless an admin explicitly sets
// them — the system never guesses the estate's liability.
export async function recordDeathFinancialReview({ tx: externalTx, deathCaseId, estateDueKobo = null, estateDetermination = null, adminNotes = null, adminId = null }) {
  const run = async (tx) => {
    const c = await tx.deathCase.findUnique({ where: { id: deathCaseId } });
    if (!c) throw new AppError('Death case not found', 404);

    // Read the actual money picture from existing records.
    const paidAgg = await tx.contributionPayment.aggregate({
      where: { subscription: { userId: c.userId }, status: 'verified' },
      _sum: { amount: true },
    });
    const paidContributions = paidAgg._sum.amount ?? 0;

    const bufferUsed = c.bufferUsedKobo;
    const outstanding = c.outstandingKobo;
    const payout = await tx.payout.findFirst({
      where: { userId: c.userId, status: 'PAID' },
      orderBy: { processedAt: 'desc' },
    });

    const data = {
      status: DEATH_STATES.FINANCIAL_REVIEW,
      financialReviewedAt: new Date(),
      paidContributionsKobo: paidContributions,
      outstandingKobo: outstanding,
      bufferUsedKobo: bufferUsed,
      payoutStatus: payout?.status ?? 'NONE',
    };
    // Only override the estate treatment when a human explicitly provides it.
    if (estateDueKobo !== null && estateDueKobo !== undefined) {
      data.estateDueKobo = Math.max(0, Math.round(Number(estateDueKobo) || 0));
    }
    if (estateDetermination) data.estateDetermination = estateDetermination;
    if (adminNotes !== null && adminNotes !== undefined) data.adminNotes = adminNotes;

    const updated = await tx.deathCase.update({ where: { id: deathCaseId }, data });

    await logAuditTx({
      tx,
      userId: c.userId,
      adminId,
      targetUserId: c.userId,
      action: AUDIT_ACTIONS.RECOVERY_UPDATED,
      reason: `Death case financial review recorded (₦${(paidContributions / 100).toLocaleString('en-NG')} contributed; estate determination ${updated.estateDetermination})`,
      metadata: {
        deathCaseId,
        paidContributionsKobo: paidContributions,
        outstandingKobo: outstanding,
        bufferUsedKobo: bufferUsed,
        estateDueKobo: updated.estateDueKobo,
        estateDetermination: updated.estateDetermination,
      },
    });

    return updated;
  };

  if (externalTx) return run(externalTx);
  return prisma.$transaction(run);
}

// ---------------------------------------------------------------------------
// Guarantors (PART 10) — recorded reference only
// ---------------------------------------------------------------------------

// Records a guarantor for a member as a RECOVERY WORKFLOW REFERENCE. It does
// not create liability: `liabilityAcknowledged` stays false until a human
// explicitly acknowledges it. Nothing in this codebase debits a guarantor.
export async function recordGuarantor({ tx: externalTx, userId, fullName, phone = null, relationship = null, linkedUserId = null, reference = null, notes = null, adminId = null }) {
  const run = async (tx) => {
    const guarantor = await tx.guarantor.create({
      data: { userId, fullName, phone, relationship, linkedUserId, reference, notes, liabilityAcknowledged: false },
    });
    await logAuditTx({
      tx,
      userId,
      adminId,
      targetUserId: userId,
      action: AUDIT_ACTIONS.RECOVERY_UPDATED,
      reason: `Guarantor recorded for recovery workflow (no liability attached)`,
      metadata: { guarantorId: guarantor.id, userId },
    });
    return guarantor;
  };

  if (externalTx) return run(externalTx);
  return prisma.$transaction(run);
}
