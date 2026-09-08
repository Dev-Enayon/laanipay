// Weekly AJO cohort engine.
//
// A cohort is a fixed-size set of positions (default 52). Members join in
// order; when full the cohort goes ACTIVE and a weekly cycle starts in which
// position N collects the week-N pool. The pool for a week is the sum of the
// verified contributions made by ACTIVE members that week; the platform keeps
// a configurable fee; the collector receives the remainder as an internal
// wallet credit (see payoutProvider.js for the honest scope of settlement).
//
// Money-flow rules enforced here:
//   - A revenue-neutral pot: payouts are funded strictly from the collected
//     pot; the platform fee (>= 0) is the only deduction; net never exceeds gross.
//   - Idempotent weeks: the unique (cohortId, weekIndex) payout constraint
//     means a week can be processed at most once, even if the function is
//     called concurrently or retried.
//   - No double membership: a user can hold at most one position per cohort.
//   - All state changes happen in one transaction per week.

import { prisma } from './prisma.js';
import { getPlatformConfig } from './config.js';
import { weeklyPotSplit } from './rewards.js';
import { disbursePayout } from './payoutProvider.js';
import { AppError } from '../middleware/error.js';
import { env } from '../config/env.js';

// Thrown when a cohort week was already advanced by another process/instance.
// Callers treat it as an idempotent skip, never as a failure.
export class CohortAlreadyAdvancedError extends Error {
  constructor(cohortId, week) {
    super(`Cohort ${cohortId} week ${week} was already advanced`);
    this.name = 'CohortAlreadyAdvancedError';
    this.code = 'COHORT_ALREADY_ADVANCED';
  }
}

// Find (or create) an open cohort for a plan. Called inside a transaction.
export async function ensureOpenCohort(tx, planId, size = 52) {
  const open = await tx.cohort.findFirst({
    where: { planId, status: 'RECRUITING' },
    orderBy: { createdAt: 'asc' },
    include: { _count: { select: { members: true } } },
  });

  if (open && open._count.members < open.size) return open;

  const name = `AJO Cohort ${new Date().getFullYear()}-${String(
    await tx.cohort.count({ where: { planId } }) + 1,
  ).padStart(2, '0')}`;
  return tx.cohort.create({
    data: { name, planId, size },
    include: { _count: { select: { members: true } } },
  });
}

// Add a user to an open cohort for the plan. Idempotent: if the user already
// sits in a non-completed cohort for the plan they are returned as-is.
// Race-safe: a unique (cohortId, userId) violation on a retry is caught and the
// existing membership returned.
export async function joinCohort({ tx, userId, planId, size = 52 }) {
  const existing = await tx.cohortMember.findFirst({
    where: { userId, cohort: { planId, status: { in: ['RECRUITING', 'ACTIVE'] } } },
    include: { cohort: true },
  });
  if (existing) {
    return { cohort: existing.cohort, member: existing, isNew: false };
  }

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const cohort = await ensureOpenCohort(tx, planId, size);
    const memberCount = await tx.cohortMember.count({ where: { cohortId: cohort.id } });

    if (memberCount >= cohort.size) {
      // Open cohort filled by a concurrent join — mark full and retry with a
      // fresh cohort.
      await tx.cohort.update({
        where: { id: cohort.id },
        data: { status: 'ACTIVE', currentWeek: 1, startedAt: new Date() },
      });
      continue;
    }

    try {
      const member = await tx.cohortMember.create({
        data: {
          cohortId: cohort.id,
          userId,
          position: memberCount + 1,
          status: 'ACTIVE',
        },
      });

      if (member.position === cohort.size) {
        await tx.cohort.update({
          where: { id: cohort.id },
          data: { status: 'ACTIVE', currentWeek: 1, startedAt: new Date() },
        });
      }

      return { cohort, member, isNew: true };
    } catch (err) {
      const isUniqueViolation =
        err?.code === 'P2002' || /duplicate key|unique constraint/i.test(`${err?.message ?? ''}`);
      if (!isUniqueViolation) throw err;
      const found = await tx.cohortMember.findFirst({
        where: { userId, cohortId: cohort.id },
        include: { cohort: true },
      });
      if (found) return { cohort: found.cohort, member: found, isNew: false };
    }
  }

  throw new AppError('Could not join a cohort. Please retry.', 409);
}

// Ensure a subscription points at a live (non-completed) cohort for its plan.
// Fixes legacy rows created before cohorts existed and renews members whose
// cohort has completed. Returns { cohort, member }.
//
// MONTHLY plans have no cohorts by design: this returns a null cohort so no
// code path can ever drag a monthly subscription into the weekly cohort
// engine, even if called defensively.
export async function ensureSubscriptionCohort(tx, subscription) {
  if (subscription?.plan?.frequency && subscription.plan.frequency !== 'WEEKLY') {
    return { cohort: null, member: null };
  }

  const cohort =
    subscription.cohortId && subscription.cohort?.status !== 'COMPLETED'
      ? subscription.cohort
      : null;

  if (cohort) {
    const member = await tx.cohortMember.findFirst({
      where: { cohortId: cohort.id, userId: subscription.userId },
    });
    if (member) return { cohort, member };
  }

  const config = await getPlatformConfig();
  const joined = await joinCohort({
    tx,
    userId: subscription.userId,
    planId: subscription.planId,
    size: config.cohortSize ?? 52,
  });

  if (subscription.cohortId !== joined.cohort.id) {
    await tx.contributionSubscription.update({
      where: { id: subscription.id },
      data: { cohortId: joined.cohort.id },
    });
  }

  return joined;
}

// True when the payout provider is wired to actually move money externally.
// Today that is never the case — settlement is internal wallet credit only.
export function canDisburseExternally() {
  return false;
}

// Process the current week of one cohort: aggregate the week's verified
// contributions, settle the payout to the week's collector, deduct the
// platform fee, and advance to the next week. Completes the cohort when the
// last position has collected.
//
// Idempotent per (cohort, week). Returns a summary for the caller.
export async function processCohortWeek({ cohortId, tx: externalTx }) {
  const run = async (tx) => {
    const cohort = await tx.cohort.findUnique({
      where: { id: cohortId },
      include: {
        plan: true,
        members: true,
      },
    });

    if (!cohort) throw new AppError('Cohort not found', 404);

    if (cohort.status === 'COMPLETED') {
      return { cohortId, skipped: 'completed' };
    }

    if (cohort.status !== 'ACTIVE') {
      // Nothing to pay until the cohort is full.
      return { cohortId, skipped: 'not_active' };
    }

    if (cohort.currentWeek > cohort.size) {
      await tx.cohort.update({
        where: { id: cohort.id },
        data: { status: 'COMPLETED', completedAt: new Date() },
      });
      return { cohortId, skipped: 'completed' };
    }

    // Anti-double-advance time guard (default 6h, configurable, 0 disables).
    // A cohort must never be advanced twice in quick succession by a cron tick
    // plus a manual admin run, or by overlapping instances.
    const minHours = env.cohortMinAdvanceHours;
    if (minHours > 0 && cohort.lastAdvancedAt) {
      const elapsedMs = Date.now() - new Date(cohort.lastAdvancedAt).getTime();
      if (elapsedMs < minHours * 60 * 60 * 1000) {
        return {
          cohortId,
          week: cohort.currentWeek,
          skipped: 'advance_guard',
          reason: `last advance ${Math.round(elapsedMs / 60000)}m ago (min ${minHours}h)`,
        };
      }
    }

    const week = cohort.currentWeek;
    const collector = cohort.members.find((m) => m.position === week && m.status === 'ACTIVE');

    const activeMemberIds = new Set(
      cohort.members.filter((m) => m.status === 'ACTIVE').map((m) => m.userId),
    );

    const paymentRows = await tx.contributionPayment.findMany({
      where: { cohortId: cohort.id, weekIndex: week, status: 'verified' },
      select: { subscription: { select: { userId: true } } },
    });
    const uniquePayers = [...new Set(paymentRows.map((r) => r.subscription.userId))];
    const paidCount = uniquePayers.filter((id) => activeMemberIds.has(id)).length;

    const config = await getPlatformConfig();
    const feePercent = config.platformFeePercent ?? 2;
    const { gross, platformFee, net } = weeklyPotSplit(
      cohort.plan.weeklyAmount,
      paidCount,
      feePercent,
    );

    const existing = await tx.payout.findUnique({
      where: { cohortId_weekIndex: { cohortId: cohort.id, weekIndex: week } },
    });
    if (existing) return { cohortId, week, alreadyProcessed: true, existing };

    const target = collector ?? cohort.members.find((m) => m.status === 'ACTIVE') ?? null;
    const payable = net > 0 && !!collector;

    let payout = null;
    if (target) {
      payout = await tx.payout.create({
        data: {
          cohortId: cohort.id,
          cohortMemberId: target.id,
          userId: target.userId,
          planId: cohort.planId,
          weekIndex: week,
          grossAmount: gross,
          platformFee,
          netAmount: net,
          status: payable ? 'PAID' : 'SKIPPED',
          provider: 'internal',
          processedAt: payable ? new Date() : null,
        },
      });
    }

    let credited = { credited: false };
    if (payable && payout && collector) {
      credited = await disbursePayout({
        tx,
        payout,
        collector,
        cohort,
        plan: cohort.plan,
        gross,
        platformFee,
        net,
      });
      await tx.cohortMember.update({
        where: { id: collector.id },
        data: { collectedWeek: week },
      });
    }

    // Advance the cohort week atomically. The optimistic guard
    // (WHERE currentWeek = week) makes N -> N+1 happen at most once even when
    // two processes/instances race: whoever commits first wins, the other sees
    // zero updated rows, rolls back its payout and reports idempotently.
    const nextWeek = week + 1;
    const completesCohort = nextWeek > cohort.size;
    const advanced = await tx.cohort.updateMany({
      where: { id: cohort.id, currentWeek: week, status: 'ACTIVE' },
      data: {
        currentWeek: nextWeek,
        lastAdvancedAt: new Date(),
        ...(completesCohort ? { status: 'COMPLETED', completedAt: new Date() } : {}),
      },
    });

    if (advanced.count === 0) {
      throw new CohortAlreadyAdvancedError(cohort.id, week);
    }

    return {
      cohortId: cohort.id,
      cohortName: cohort.name,
      week,
      paidCount,
      gross,
      platformFee,
      net,
      collectorId: collector?.userId ?? null,
      payoutId: payout?.id ?? null,
      payoutStatus: payout?.status ?? 'SKIPPED',
      credited: credited.credited,
    };
  };

  if (externalTx) return run(externalTx);
  return prisma.$transaction(run);
}

// Advance every ACTIVE cohort by one week (used by the weekly scheduler and by
// the admin "advance week" tool). Each cohort is processed independently so a
// single failure never blocks the rest. Returns per-cohort summaries.
export async function runDueCohortPayouts() {
  const cohorts = await prisma.cohort.findMany({ where: { status: 'ACTIVE' } });
  const results = [];
  for (const cohort of cohorts) {
    try {
      results.push(await processCohortWeek({ cohortId: cohort.id }));
    } catch (err) {
      if (err instanceof CohortAlreadyAdvancedError || err?.code === 'COHORT_ALREADY_ADVANCED') {
        results.push({ cohortId: cohort.id, skipped: 'already_advanced', reason: err?.message });
        continue;
      }
      console.error('[cohort] week processing failed for', cohort.id, err?.message ?? err);
      results.push({ cohortId: cohort.id, failed: true, reason: err?.message ?? 'unknown' });
    }
  }
  return results;
}