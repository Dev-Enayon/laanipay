import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { prisma } from '../lib/prisma.js';
import { AppError, asyncHandler } from '../middleware/error.js';
import { requireAuth, requireActivated } from '../middleware/auth.js';
import { paymentLimiter } from '../middleware/rateLimit.js';
import { sendContributionSubscribedEmail } from '../lib/mailer.js';

const router = Router();

export const CYCLE_MONTHS = 12;

router.get(
  '/plans',
  asyncHandler(async (req, res) => {
    const plans = await prisma.contributionPlan.findMany({
      orderBy: { monthlyAmount: 'asc' },
      select: { id: true, name: true, monthlyAmount: true },
    });
    res.json({ plans });
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
        include: { plan: true },
      });

      if (existing) return existing;

      isNew = true;
      const nextPaymentDate = new Date();
      nextPaymentDate.setMonth(nextPaymentDate.getMonth() + 1);

      return tx.contributionSubscription.create({
        data: {
          userId: req.userId,
          planId: plan.id,
          status: 'active',
          nextPaymentDate,
        },
        include: { plan: true },
      });
    });

    if (isNew) {
      await prisma.auditLog.create({
        data: {
          userId: req.userId,
          action: 'CONTRIBUTION_SUBSCRIBED',
          metadata: { planId: plan.id, planName: plan.name, monthlyAmount: plan.monthlyAmount },
        },
      });

      const nextPaymentDate = new Date();
      nextPaymentDate.setMonth(nextPaymentDate.getMonth() + 1);

      sendContributionSubscribedEmail({
        to: req.user.email,
        name: req.user.fullName,
        planName: plan.name,
        monthlyAmount: plan.monthlyAmount,
        nextPaymentDate: nextPaymentDate.toISOString().split('T')[0],
      });
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
      return res.json({ subscription: serializeSubscription(subscription) });
    }

    const updated = await prisma.contributionSubscription.update({
      where: { id: subscription.id },
      data: { planId: plan.id },
      include: { plan: true },
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
          monthlyAmount: plan.monthlyAmount,
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
      include: { plan: true, payments: { orderBy: { createdAt: 'desc' } } },
    });

    if (!subscription) {
      return res.json({ subscription: null, cycleMonths: CYCLE_MONTHS });
    }

    const verifiedPayments = subscription.payments.filter((p) => p.status === 'verified');
    const totalContributed = verifiedPayments.reduce((sum, p) => sum + p.amount, 0);

    res.json({
      subscription: serializeSubscription(subscription),
      history: subscription.payments.map((p) => ({
        id: p.id,
        reference: p.paystackReference,
        amount: p.amount,
        status: p.status,
        paidAt: p.paidAt,
        createdAt: p.createdAt,
      })),
      cycleMonths: CYCLE_MONTHS,
      monthsPaid: verifiedPayments.length,
      totalContributed,
      progress: Math.min(1, verifiedPayments.length / CYCLE_MONTHS),
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
      include: { plan: true },
    });

    if (!subscription) {
      throw new AppError('Active subscription not found', 404);
    }

    const payment = await prisma.$transaction(async (tx) => {
      const pending = await tx.contributionPayment.findFirst({
        where: { subscriptionId: subscription.id, status: 'pending' },
      });

      if (pending) return pending;

      const reference = `laani-cnt-${randomUUID().replaceAll('-', '')}`;
      return tx.contributionPayment.create({
        data: {
          subscriptionId: subscription.id,
          paystackReference: reference,
          amount: subscription.plan.monthlyAmount,
          status: 'pending',
        },
      });
    });

    res.json({
      reference: payment.paystackReference,
      amount: payment.amount,
      email: req.user.email,
    });
  }),
);

function serializeSubscription(subscription) {
  return {
    id: subscription.id,
    status: subscription.status,
    nextPaymentDate: subscription.nextPaymentDate,
    plan: {
      id: subscription.plan.id,
      name: subscription.plan.name,
      monthlyAmount: subscription.plan.monthlyAmount,
    },
  };
}

export default router;
