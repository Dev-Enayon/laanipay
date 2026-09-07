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

const router = Router();

export const CYCLE_WEEKS = 52;

function addOneWeek(date) {
  const d = new Date(date);
  d.setDate(d.getDate() + 7);
  return d;
}

router.get(
  '/plans',
  asyncHandler(async (req, res) => {
    const plans = await prisma.contributionPlan.findMany({
      orderBy: { weeklyAmount: 'asc' },
      select: { id: true, name: true, weeklyAmount: true, monthlyAmount: true, cycleWeeks: true },
    });
    res.json({ plans, cycleWeeks: CYCLE_WEEKS });
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

    let isNew = false;
    const subscription = await prisma.$transaction(async (tx) => {
      const existing = await tx.contributionSubscription.findFirst({
        where: { userId: req.userId, status: 'active' },
        include: { plan: true, cohort: true },
      });

      if (existing) return existing;

      isNew = true;
      const nextPaymentDate = addOneWeek(new Date());
      const config = await getPlatformConfig();
      const joined = await joinCohort({
        tx,
        userId: req.userId,
        planId: plan.id,
        size: config.cohortSize ?? 52,
      });

      return tx.contributionSubscription.create({
        data: {
          userId: req.userId,
          planId: plan.id,
          cohortId: joined.cohort.id,
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
            weeklyAmount: plan.weeklyAmount,
            cohortId: subscription.cohortId,
          },
        },
      });

      const nextPaymentDate = addOneWeek(new Date());

      sendContributionSubscribedEmail({
        to: req.user.email,
        name: req.user.fullName,
        planName: plan.name,
        weeklyAmount: plan.weeklyAmount,
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
      include: { plan: true },
    });

    if (!subscription) {
      throw new AppError('No active subscription to change', 404);
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

    await prisma.auditLog.create({
      data: {
        userId: req.userId,
        action: 'CONTRIBUTION_PLAN_CHANGED',
        metadata: {
          fromPlanId: subscription.planId,
          fromPlanName: subscription.plan.name,
          toPlanId: plan.id,
          planName: plan.name,
          weeklyAmount: plan.weeklyAmount,
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
    const subscription = await prisma.contributionSubscription.findFirst({
      where: { userId: req.userId, status: 'active' },
      include: {
        plan: { include: { cohorts: true } },
        payments: { orderBy: { createdAt: 'desc' } },
        cohort: { include: { members: true } },
      },
    });

    if (!subscription) {
      return res.json({
        subscription: null,
        cycleWeeks: CYCLE_WEEKS,
        cohort: null,
        expectedPayout: null,
      });
    }

    const config = await getPlatformConfig();
    const verifiedPayments = subscription.payments.filter((p) => p.status === 'verified');
    const totalContributed = verifiedPayments.reduce((sum, p) => sum + p.amount, 0);
    const weeksPaid = verifiedPayments.length;

    let cohort = null;
    const member = subscription.cohort?.members.find((m) => m.userId === req.userId) ?? null;

    if (subscription.cohort) {
      const fullPayout = expectedPayout(
        subscription.plan.weeklyAmount,
        subscription.plan.cycleWeeks,
        config.platformFeePercent ?? 2,
      );
      const nextPayoutGross = subscription.plan.weeklyAmount ?? 0;
      const nextPayoutNet = nextPayoutGross - Math.round((nextPayoutGross * (config.platformFeePercent ?? 2)) / 100);
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

    res.json({
      subscription: serializeSubscription(subscription),
      history: subscription.payments.map((p) => ({
        id: p.id,
        reference: p.paystackReference,
        amount: p.amount,
        status: p.status,
        weekIndex: p.weekIndex,
        paidAt: p.paidAt,
        createdAt: p.createdAt,
      })),
      cycleWeeks: CYCLE_WEEKS,
      weeksPaid,
      weeksRemaining: Math.max(0, CYCLE_WEEKS - weeksPaid),
      totalContributed,
      progress: Math.min(1, weeksPaid / CYCLE_WEEKS),
      platformFeePercent: config.platformFeePercent ?? 2,
      monthlySubscriptionFeeKobo: config.monthlySubscriptionFeeKobo,
      cohort,
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
          amount: subscription.plan.weeklyAmount,
          weekIndex: subscription.cohort?.status === 'ACTIVE' ? subscription.cohort.currentWeek : null,
          cohortId: subscription.cohort?.id ?? null,
          status: 'pending',
        },
      });
    });

    res.json({
      reference: payment.paystackReference,
      amount: payment.amount,
      email: req.user.email,
      weekIndex: payment.weekIndex,
    });
  }),
);

function serializeSubscription(subscription) {
  return {
    id: subscription.id,
    status: subscription.status,
    nextPaymentDate: subscription.nextPaymentDate,
    cohortId: subscription.cohortId,
    plan: {
      id: subscription.plan.id,
      name: subscription.plan.name,
      weeklyAmount: subscription.plan.weeklyAmount,
      monthlyAmount: subscription.plan.monthlyAmount,
      cycleWeeks: subscription.plan.cycleWeeks,
    },
  };
}

export default router;