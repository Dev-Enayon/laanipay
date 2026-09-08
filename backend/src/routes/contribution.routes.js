import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { prisma } from '../lib/prisma.js';
import { AppError, asyncHandler } from '../middleware/error.js';
import { requireAuth, requireActivated } from '../middleware/auth.js';
import { paymentLimiter } from '../middleware/rateLimit.js';
import { sendContributionSubscribedEmail } from '../lib/mailer.js';
import { joinCohort } from '../lib/cohort.js';
import { getPlatformConfig } from '../lib/config.js';
import { expectedPayout } from '../lib/rewards.js';
import {
  CYCLE_WEEKS,
  FREQUENCIES,
  addContributionPeriod,
  cycleLabel,
  planAmount,
  planFrequency,
  periodSuffix,
} from '../lib/contributions.js';

const router = Router();

// A user may hold at most one active contribution subscription of each
// frequency, so the (user, frequency) dimensions stay independent and both
// monthly and weekly contributions can coexist for the same account.

router.get(
  '/plans',
  asyncHandler(async (req, res) => {
    const plans = await prisma.contributionPlan.findMany({
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        name: true,
        frequency: true,
        weeklyAmount: true,
        monthlyAmount: true,
        cycleWeeks: true,
      },
    });

    const monthly = plans
      .filter((p) => planFrequency(p) === 'MONTHLY')
      .sort((a, b) => (a.monthlyAmount ?? 0) - (b.monthlyAmount ?? 0))
      .map((p) => serializePlan(p));
    const weekly = plans
      .filter((p) => planFrequency(p) === 'WEEKLY')
      .sort((a, b) => (a.weeklyAmount ?? 0) - (b.weeklyAmount ?? 0))
      .map((p) => serializePlan(p));

    res.json({ plans: [...monthly, ...weekly], frequencies: FREQUENCIES, cycleWeeks: CYCLE_WEEKS });
  }),
);

router.post(
  '/subscribe',
  requireAuth,
  requireActivated,
  asyncHandler(async (req, res) => {
    const { planId } = req.body ?? {};

    if (typeof planId !== 'string' || !planId) {
      throw new AppError('planId is required', 400);
    }

    const plan = await prisma.contributionPlan.findUnique({ where: { id: planId } });
    if (!plan) {
      throw new AppError('Contribution plan not found', 404);
    }

    const frequency = planFrequency(plan);

    let isNew = false;
    const subscription = await prisma.$transaction(async (tx) => {
      // One active subscription per frequency; existing rows are returned as-is
      // so re-subscribing never duplicates or mutates data.
      const existing = await tx.contributionSubscription.findFirst({
        where: { userId: req.userId, status: 'active', plan: { frequency } },
        include: { plan: true, cohort: true },
      });

      if (existing) return existing;

      isNew = true;
      const nextPaymentDate = addContributionPeriod(new Date(), plan);
      let joined = null;

      if (frequency === 'WEEKLY') {
        const config = await getPlatformConfig();
        joined = await joinCohort({
          tx,
          userId: req.userId,
          planId: plan.id,
          size: config.cohortSize ?? 52,
        });
      }

      return tx.contributionSubscription.create({
        data: {
          userId: req.userId,
          planId: plan.id,
          cohortId: joined?.cohort?.id ?? null,
          status: 'active',
          nextPaymentDate,
        },
        include: { plan: true, cohort: true },
      });
    });

    if (isNew) {
      await prisma.auditLog.create({
        data: {
          userId: req.userId,
          action: 'CONTRIBUTION_SUBSCRIBED',
          metadata: {
            planId: plan.id,
            planName: plan.name,
            frequency,
            amount: planAmount(plan),
            cohortId: subscription.cohortId,
          },
        },
      });

      const nextPaymentDate = addContributionPeriod(new Date(), plan);

      sendContributionSubscribedEmail({
        to: req.user.email,
        name: req.user.fullName,
        planName: plan.name,
        frequency,
        amount: planAmount(plan),
        nextPaymentDate: nextPaymentDate.toISOString().split('T')[0],
      }).catch(() => {});
    }

    res.status(201).json({ subscription: serializeSubscription(subscription) });
  }),
);

router.patch(
  '/plan',
  requireAuth,
  requireActivated,
  asyncHandler(async (req, res) => {
    const { planId } = req.body ?? {};

    if (typeof planId !== 'string' || !planId) {
      throw new AppError('planId is required', 400);
    }

    const plan = await prisma.contributionPlan.findUnique({ where: { id: planId } });
    if (!plan) {
      throw new AppError('Contribution plan not found', 404);
    }

    const subscription = await prisma.contributionSubscription.findFirst({
      where: { userId: req.userId, status: 'active' },
      include: { plan: true, cohort: true },
    });

    if (!subscription) {
      throw new AppError('No active subscription to change', 404);
    }

    if (planFrequency(subscription.plan) !== planFrequency(plan)) {
      throw new AppError(
        'A plan can only be changed within the same frequency. Join the other frequency as a separate subscription instead.',
        400,
      );
    }

    if (subscription.planId === plan.id) {
      const fresh = await prisma.contributionSubscription.findFirst({
        where: { id: subscription.id },
        include: { plan: true, cohort: true },
      });
      return res.json({ subscription: serializeSubscription(fresh) });
    }

    const updated = await prisma.contributionSubscription.update({
      where: { id: subscription.id },
      data: { planId: plan.id, cohortId: null },
      include: { plan: true, cohort: true },
    });

    // Changing the plan moves the member into the matching weekly cohort.
    // Monthly plans have no cohort by design.
    const frequency = planFrequency(plan);
    if (frequency === 'WEEKLY') {
      await prisma.$transaction(async (tx) => {
        const config = await getPlatformConfig();
        const joined = await joinCohort({
          tx,
          userId: req.userId,
          planId: plan.id,
          size: config.cohortSize ?? 52,
        });
        await tx.contributionSubscription.update({
          where: { id: subscription.id },
          data: { cohortId: joined.cohort.id },
        });
      });
    }

    await prisma.auditLog.create({
      data: {
        userId: req.userId,
        action: 'CONTRIBUTION_PLAN_CHANGED',
        metadata: {
          fromPlanId: subscription.planId,
          fromPlanName: subscription.plan.name,
          toPlanId: plan.id,
          planName: plan.name,
          frequency,
        },
      },
    });

    res.json({ subscription: serializeSubscription(updated) });
  }),
);

router.get(
  '/overview',
  requireAuth,
  requireActivated,
  asyncHandler(async (req, res) => {
    const subscriptions = await prisma.contributionSubscription.findMany({
      where: { userId: req.userId, status: 'active' },
      orderBy: { createdAt: 'asc' },
      include: {
        plan: { include: { cohorts: true } },
        payments: { orderBy: { createdAt: 'desc' } },
        cohort: { include: { members: true } },
      },
    });

    const config = await getPlatformConfig();
    const platformFeePercent = config.platformFeePercent ?? 2;

    if (subscriptions.length === 0) {
      return res.json({
        subscription: null,
        subscriptions: [],
        cycleWeeks: CYCLE_WEEKS,
        cohort: null,
        expectedPayout: null,
        platformFeePercent,
      });
    }

    const build = (subscription) => {
      const frequency = planFrequency(subscription.plan);
      const verifiedPayments = subscription.payments.filter((p) => p.status === 'verified');
      const totalContributed = verifiedPayments.reduce((sum, p) => sum + p.amount, 0);
      const paymentsPaid = verifiedPayments.length;

      let cohort = null;
      const member = subscription.cohort?.members.find((m) => m.userId === req.userId) ?? null;

      if (subscription.cohort) {
        const fullPayout = expectedPayout(
          subscription.plan.weeklyAmount,
          subscription.plan.cycleWeeks,
          platformFeePercent,
        );
        const nextPayoutGross = subscription.plan.weeklyAmount ?? 0;
        const nextPayoutNet = nextPayoutGross - Math.round((nextPayoutGross * platformFeePercent) / 100);
        cohort = {
          id: subscription.cohort.id,
          name: subscription.cohort.name,
          status: subscription.cohort.status,
          currentWeek: subscription.cohort.currentWeek,
          size: subscription.cohort.size,
          startedAt: subscription.cohort.startedAt,
          position: member?.position ?? null,
          collectedWeek: member?.collectedWeek ?? null,
          totalPaid: member?.totalPaid ?? 0,
          memberStatus: member?.status ?? null,
          // The collector receives the pool of the members who pay that week.
          expectedPayout: fullPayout,
          weeksLeftToCollect: member?.position ? Math.max(0, member.position - subscription.cohort.currentWeek) : null,
          yourNextPayoutNet: nextPayoutNet,
        };
      }

      return {
        ...serializeSubscription(subscription),
        frequency,
        cycleLabel: cycleLabel(subscription.plan),
        history: subscription.payments.map((p) => ({
          id: p.id,
          reference: p.paystackReference,
          amount: p.amount,
          status: p.status,
          weekIndex: p.weekIndex,
          paidAt: p.paidAt,
          createdAt: p.createdAt,
        })),
        weeksPaid: paymentsPaid,
        cycleWeeks: CYCLE_WEEKS,
        paymentsPaid,
        totalContributed,
        progress: frequency === 'WEEKLY' ? Math.min(1, paymentsPaid / CYCLE_WEEKS) : null,
        latestPaymentDate: verifiedPayments[0]?.paidAt ?? verifiedPayments[0]?.createdAt ?? null,
        cohort,
      };
    };

    const items = subscriptions.map(build);
    const primary = items[0];

    res.json({
      subscription: primary,
      subscriptions: items,
      cycleWeeks: CYCLE_WEEKS,
      cohort: primary.cohort,
      expectedPayout: primary.cohort?.expectedPayout ?? null,
      weeksPaid: primary.weeksPaid,
      paymentsPaid: primary.paymentsPaid,
      totalContributed: primary.totalContributed,
      progress: primary.progress,
      platformFeePercent,
      monthlySubscriptionFeeKobo: config.monthlySubscriptionFeeKobo,
    });
  }),
);

router.post(
  '/pay',
  requireAuth,
  requireActivated,
  paymentLimiter,
  asyncHandler(async (req, res) => {
    const { subscriptionId } = req.body ?? {};

    if (typeof subscriptionId !== 'string' || !subscriptionId) {
      throw new AppError('subscriptionId is required', 400);
    }

    const subscription = await prisma.contributionSubscription.findFirst({
      where: { id: subscriptionId, userId: req.userId, status: 'active' },
      include: { plan: true, cohort: true },
    });

    if (!subscription) {
      throw new AppError('Active subscription not found', 404);
    }

    const frequency = planFrequency(subscription.plan);
    const amount = planAmount(subscription.plan);
    const isWeekly = frequency === 'WEEKLY';
    const weekIndex = isWeekly && subscription.cohort?.status === 'ACTIVE' ? subscription.cohort.currentWeek : null;
    const cohortId = isWeekly ? (subscription.cohort?.id ?? null) : null;

    const payment = await prisma.$transaction(async (tx) => {
      await tx.contributionPayment.updateMany({
        where: { subscriptionId: subscription.id, status: 'pending' },
        data: { status: 'cancelled' },
      });

      const reference = `laani-cnt-${randomUUID().replaceAll('-', '')}`;
      return tx.contributionPayment.create({
        data: {
          subscriptionId: subscription.id,
          paystackReference: reference,
          amount,
          weekIndex,
          cohortId,
          status: 'pending',
        },
      });
    });

    res.json({
      reference: payment.paystackReference,
      amount: payment.amount,
      email: req.user.email,
      frequency,
      weekIndex,
    });
  }),
);

function serializePlan(plan) {
  return {
    id: plan.id,
    name: plan.name,
    frequency: planFrequency(plan),
    weeklyAmount: plan.weeklyAmount,
    monthlyAmount: plan.monthlyAmount,
    cycleWeeks: plan.cycleWeeks,
    amount: planAmount(plan),
    periodSuffix: periodSuffix(planFrequency(plan)),
    cycleLabel: cycleLabel(plan),
  };
}

function serializeSubscription(subscription) {
  const frequency = planFrequency(subscription.plan);
  return {
    id: subscription.id,
    status: subscription.status,
    nextPaymentDate: subscription.nextPaymentDate,
    cohortId: subscription.cohortId,
    frequency,
    plan: {
      id: subscription.plan.id,
      name: subscription.plan.name,
      frequency,
      weeklyAmount: subscription.plan.weeklyAmount,
      monthlyAmount: subscription.plan.monthlyAmount,
      cycleWeeks: subscription.plan.cycleWeeks,
      amount: planAmount(subscription.plan),
      periodSuffix: periodSuffix(frequency),
      cycleLabel: cycleLabel(subscription.plan),
    },
  };
}

export default router;