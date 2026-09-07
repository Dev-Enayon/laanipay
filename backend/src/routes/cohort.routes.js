import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { asyncHandler } from '../middleware/error.js';
import { requireAuth, requireActivated } from '../middleware/auth.js';
import { getPlatformConfig } from '../lib/config.js';
import { expectedPayout } from '../lib/rewards.js';

const router = Router();

// The user's current AJO cohort: position, week progress, collection week and
// their expected (full-payment) payout.
router.get(
  '/my',
  requireAuth,
  requireActivated,
  asyncHandler(async (req, res) => {
    const subscription = await prisma.contributionSubscription.findFirst({
      where: { userId: req.userId, status: 'active' },
      include: {
        plan: true,
        cohort: {
          include: {
            members: {
              where: { userId: req.userId },
              include: { user: { select: { id: true, fullName: true, createdAt: true } } },
            },
            _count: { select: { members: true } },
          },
        },
      },
    });

    if (!subscription?.cohort) {
      return res.json({ cohort: null, subscription: null });
    }

    const config = await getPlatformConfig();
    const feePercent = config.platformFeePercent ?? 2;
    const member = subscription.cohort.members[0] ?? null;

    const myPayments = await prisma.contributionPayment.findMany({
      where: { cohortId: subscription.cohort.id, status: 'verified', subscription: { userId: req.userId } },
      orderBy: { createdAt: 'desc' },
      select: { weekIndex: true, amount: true, paidAt: true, paystackReference: true },
    });

    const fullPayout = expectedPayout(subscription.plan.weeklyAmount, subscription.plan.cycleWeeks, feePercent);

    res.json({
      cohort: {
        id: subscription.cohort.id,
        name: subscription.cohort.name,
        status: subscription.cohort.status,
        currentWeek: subscription.cohort.currentWeek,
        size: subscription.cohort.size,
        memberCount: subscription.cohort._count.members,
        startedAt: subscription.cohort.startedAt,
        position: member?.position ?? null,
        collectedWeek: member?.collectedWeek ?? null,
        memberStatus: member?.status ?? null,
      },
      plan: {
        id: subscription.plan.id,
        name: subscription.plan.name,
        weeklyAmount: subscription.plan.weeklyAmount,
        cycleWeeks: subscription.plan.cycleWeeks,
      },
      // Weeks remaining until collection = position (the week they collect).
      weeksToCollect: member?.position ? Math.max(0, member.position - subscription.cohort.currentWeek) : null,
      paidThisCycleWeek: !!myPayments.find((p) => p.weekIndex === subscription.cohort.currentWeek),
      feePercent,
      expectedPayout: fullPayout,
      history: myPayments,
      subscription: {
        id: subscription.id,
        status: subscription.status,
        nextPaymentDate: subscription.nextPaymentDate,
      },
    });
  }),
);

export default router;