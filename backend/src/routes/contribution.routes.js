import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { prisma } from '../lib/prisma.js';
import { AppError, asyncHandler } from '../middleware/error.js';
import { requireAuth, requireActivated } from '../middleware/auth.js';
import { paymentLimiter } from '../middleware/rateLimit.js';
import { sendContributionSubscribedEmail, sendContributionReceiptEmail } from '../lib/mailer.js';
import { joinCohort } from '../lib/cohort.js';
import { getPlatformConfig } from '../lib/config.js';
import { expectedPayout } from '../lib/rewards.js';
import { recordVerifiedContribution } from '../lib/settlement.js';
import { bufferBalance, contributionBufferSplit } from '../lib/bufferFund.js';
import { buildCatchUpQuote } from '../lib/defaultRecovery.js';
import {
  CYCLE_WEEKS,
  FREQUENCIES,
  addContributionPeriod,
  cycleLabel,
  planAmount,
  planFrequency,
  periodSuffix,
  subscriptionAmount,
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
          // Freeze the amount the user agreed to at subscribe time so later
          // plan tier changes never alter an existing subscription's terms.
          amountKobo: planAmount(plan),
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
      data: { planId: plan.id, cohortId: null, amountKobo: planAmount(plan) },
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

    const build = async (subscription) => {
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

        let myBufferBalance = null;
        if (frequency === 'WEEKLY') {
          const rows = await prisma.bufferLedger.findMany({
            where: { cohortId: subscription.cohort.id, userId: req.userId },
            select: { amountKobo: true, sign: true, eventType: true },
            orderBy: { createdAt: 'asc' },
          });
          myBufferBalance = bufferBalance(rows);
        }

        // The member's delinquency state and any unresolved missed weeks, so
        // the member sees their own situation without contacting support.
        // `member` can be null (a subscription whose cohort has no membership
        // row), so this is guarded rather than assumed.
        const openMisses = member
          ? await prisma.missedContribution.findMany({
              where: { memberId: member.id, status: { in: ['MISSED', 'GRACE', 'DEFAULTED'] } },
              orderBy: { weekIndex: 'asc' },
              select: { id: true, weekIndex: true, amountKobo: true, status: true, graceEndsAt: true },
            })
          : [];
        const openCase = member
          ? await prisma.contributionDefault.findFirst({
              where: { memberId: member.id, status: { in: ['OPEN', 'CONTACTING', 'PROMISED', 'PARTIALLY_RECOVERED', 'ESCALATED'] } },
              orderBy: { createdAt: 'asc' },
              select: { id: true, status: true, outstandingKobo: true, missedKobo: true, fineKobo: true, shortfallKobo: true },
            })
          : null;

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
          // Security-buffer fund: the member's protected share of the group
          // buffer (derived from the ledger; null when the fund is inactive).
          bufferBalance: myBufferBalance,
          // Delinquency state machine + the member's own recovery case. The
          // member's position is never removed mid-cycle and a defaulted
          // member is never silently replaced.
          defaultStatus: member.defaultStatus ?? null,
          participationStatus: member.status ?? null,
          missedContributions: openMisses,
          defaultCase: openCase,
        };
      }

      // The split of the NEXT contribution period into main + security buffer
      // (exposed for display only; the actual recorded split is per-payment).
      const contributionSplit = contributionBufferSplit(
        subscriptionAmount(subscription),
        frequency === 'WEEKLY' ? config.bufferPolicy : null,
      );

      return {
        ...serializeSubscription(subscription),
        frequency,
        cycleLabel: cycleLabel(subscription.plan),
        history: subscription.payments.map((p) => ({
          id: p.id,
          reference: p.paystackReference,
          amount: p.amount,
          mainAmount: p.mainAmount ?? null,
          bufferAmount: p.bufferAmount ?? null,
          status: p.status,
          weekIndex: p.weekIndex,
          paidAt: p.paidAt,
          createdAt: p.createdAt,
        })),
        contributionSplit,
        weeksPaid: paymentsPaid,
        cycleWeeks: CYCLE_WEEKS,
        paymentsPaid,
        totalContributed,
        progress: frequency === 'WEEKLY' ? Math.min(1, paymentsPaid / CYCLE_WEEKS) : null,
        latestPaymentDate: verifiedPayments[0]?.paidAt ?? verifiedPayments[0]?.createdAt ?? null,
        cohort,
      };
    };

    const items = await Promise.all(subscriptions.map(build));
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

// Initiate payment. When the member has unresolved missed contributions this
// becomes a CATCH-UP payment whose amount is the full quote
// (missed + current + fine) rather than a single period. The amount is written
// onto the payment row up front together with its split, and the settlement
// path re-verifies that the money actually paid matches the quote.
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
    const periodAmount = subscriptionAmount(subscription);
    const isWeekly = frequency === 'WEEKLY';
    const weekIndex = isWeekly && subscription.cohort?.status === 'ACTIVE' ? subscription.cohort.currentWeek : null;
    const cohortId = isWeekly ? (subscription.cohort?.id ?? null) : null;

    // Build the catch-up quote when this member has unresolved misses. A missed
    // contribution is never quietly dropped from the amount charged.
    let catchUp = null;
    if (isWeekly && cohortId) {
      const resolved = await loadCatchUpForSubscription({ db: prisma, subscription });
      if (resolved.missedRows.length > 0) {
        catchUp = resolved;
      }
    }

    const amount = catchUp ? catchUp.quote.totalKobo : periodAmount;

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
          kind: catchUp ? 'catchup' : 'regular',
          // The split is recorded up front so it is auditable even before the
          // money lands; settlement re-verifies it against the real payment.
          ...(catchUp
            ? {
                missedKobo: catchUp.quote.missedKobo,
                currentKobo: catchUp.quote.currentKobo,
                fineKobo: catchUp.quote.fineKobo,
              }
            : {}),
        },
      });
    });

    res.json({
      reference: payment.paystackReference,
      amount: payment.amount,
      email: req.user.email,
      frequency,
      weekIndex,
      ...(catchUp
        ? {
            kind: 'catchup',
            breakdown: {
              missedKobo: catchUp.quote.missedKobo,
              currentKobo: catchUp.quote.currentKobo,
              fineKobo: catchUp.quote.fineKobo,
            },
          }
        : {}),
    });
  }),
);

// Pay the current contribution period from the user's LaaniPay wallet balance.
// Mirrors POST /pay (same subscription claim/cancel semantics), but the payment
// is recorded as verified immediately and the wallet balance is debited in the
// same atomic transaction. The verified-payment downstream (cohort attribution,
// nextPaymentDate, totalContributed, ledger, audit, receipt email) is shared
// with settlePayment via recordVerifiedContribution, so wallet-paid
// contributions are treated identically to Paystack-paid ones.
router.post(
  '/pay/wallet',
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
    const reference = `laani-wal-${randomUUID().replaceAll('-', '')}`;

    // A member paying from their wallet must settle exactly what a Paystack
    // payment would settle. Otherwise a defaulted member could "pay up" from
    // their wallet, have only the current period applied, and leave the missed
    // weeks (and any fine) outstanding with no indication anything was wrong.
    const resolved = await loadCatchUpForSubscription({ db: prisma, subscription });
    const catchUp = resolved.missedRows.length > 0 ? resolved : null;
    const amount = catchUp ? catchUp.quote.totalKobo : resolved.periodAmount;

    const { payment, nextPaymentDate } = await prisma.$transaction(async (tx) => {
      const wallet = await tx.wallet.findUnique({ where: { userId: req.userId } });
      if (!wallet) throw new AppError('Wallet not found', 404);
      if (wallet.balance < amount) {
        throw new AppError(
          `Insufficient wallet balance (₦${(wallet.balance / 100).toLocaleString('en-NG')} available, ₦${(amount / 100).toLocaleString('en-NG')} required)`,
          400,
        );
      }

      await tx.contributionPayment.updateMany({
        where: { subscriptionId: subscription.id, status: 'pending' },
        data: { status: 'cancelled' },
      });

      const payment = await tx.contributionPayment.create({
        data: {
          subscriptionId: subscription.id,
          paystackReference: reference,
          amount,
          status: 'verified',
          paidAt: new Date(),
          // The same marker settlement uses to route a catch-up payment
          // through missed-restoration, fine collection and debt closure.
          kind: catchUp ? 'catchup' : 'regular',
          ...(catchUp
            ? {
                missedKobo: catchUp.quote.missedKobo,
                currentKobo: catchUp.quote.currentKobo,
                fineKobo: catchUp.quote.fineKobo,
              }
            : {}),
        },
      });

      const recorded = await recordVerifiedContribution({ tx, subscription, payment, reference });

      // Debit the wallet for the contribution and record the ledger entry with
      // the post-debit balance (rollback-safe: a negative balance throws, which
      // reverts the whole transaction).
      const updated = await tx.wallet.update({
        where: { userId: req.userId },
        data: { balance: { decrement: amount } },
      });
      if (updated.balance < 0) {
        throw new AppError('Insufficient wallet balance', 400);
      }

      await tx.walletTransaction.create({
        data: {
          userId: req.userId,
          type: 'wallet_contribution',
          amount,
          balanceAfter: updated.balance,
          status: 'completed',
          reference,
          description: catchUp
            ? `Catch-up contribution paid from wallet (missed ₦${(catchUp.quote.missedKobo / 100).toLocaleString('en-NG')}, current ₦${(catchUp.quote.currentKobo / 100).toLocaleString('en-NG')}, fine ₦${(catchUp.quote.fineKobo / 100).toLocaleString('en-NG')})`
            : `${frequency === 'WEEKLY' ? 'Weekly' : 'Monthly'} contribution paid from wallet`,
          metadata: {
            subscriptionId: subscription.id,
            frequency,
            kind: catchUp ? 'catchup' : 'regular',
            ...(catchUp
              ? {
                  missedKobo: catchUp.quote.missedKobo,
                  currentKobo: catchUp.quote.currentKobo,
                  fineKobo: catchUp.quote.fineKobo,
                }
              : {}),
          },
        },
      });

      return { payment, nextPaymentDate: recorded.nextPaymentDate };
    });

    await prisma.auditLog.create({
      data: {
        userId: req.userId,
        action: 'CONTRIBUTION_WALLET_PAYMENT',
        metadata: { subscriptionId: subscription.id, reference, amount, frequency },
      },
    });

    const nextPaymentDateIso = nextPaymentDate.toISOString().split('T')[0];
    sendContributionReceiptEmail({
      to: req.user.email,
      name: req.user.fullName,
      planName: subscription.plan?.name ?? 'Contribution plan',
      amount,
      reference,
      nextPaymentDate: nextPaymentDateIso,
    }).catch(() => {});

    res.status(201).json({
      payment: {
        id: payment.id,
        reference: payment.paystackReference,
        amount: payment.amount,
        status: payment.status,
        weekIndex: recorded.verifier.weekIndex,
        paidAt: payment.paidAt,
      },
      nextPaymentDate: nextPaymentDateIso,
    });
  }),
);

// ---------------------------------------------------------------------------
// Catch-up (a returning member settles missed + current + fine)
// ---------------------------------------------------------------------------

// Returns what a weekly member currently owes after missing contribution(s),
// split into its parts so the UI can show the breakdown rather than one opaque
// total. The amounts come from the member's actual missed rows, their
// subscription amount and any assessed fine — nothing is hard-coded.
//
// If the member owes nothing beyond the current period, `catchUpRequired` is
// false and the normal /pay flow applies.
router.get(
  '/catch-up',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { subscriptionId } = req.query ?? {};

    const subscription = await prisma.contributionSubscription.findFirst({
      where: {
        userId: req.userId,
        status: 'active',
        ...(typeof subscriptionId === 'string' && subscriptionId ? { id: subscriptionId } : {}),
      },
      include: { plan: true, cohort: true },
    });
    if (!subscription) throw new AppError('Active subscription not found', 404);

    const frequency = planFrequency(subscription.plan);
    if (frequency !== 'WEEKLY') {
      return res.json({ catchUpRequired: false, reason: 'Monthly plans have no missed-contribution cycle', quote: null });
    }

    // Same helper the pay routes use, so the amount shown here is exactly the
    // amount that will be charged.
    const { member, missedRows, openCase, assessedFine, quote } = await loadCatchUpForSubscription({
      db: prisma,
      subscription,
    });
    const fineKobo = assessedFine?.status === 'ASSESSED' ? assessedFine.amountKobo : 0;

    res.json({
      catchUpRequired: quote.missedKobo > 0,
      subscriptionId: subscription.id,
      cohortId: subscription.cohortId ?? null,
      memberStatus: member?.defaultStatus ?? null,
      participationStatus: member?.status ?? null,
      quote,
      breakdown: {
        missed: missedRows.map((m) => ({ id: m.id, weekIndex: m.weekIndex, amountKobo: m.amountKobo, status: m.status, graceEndsAt: m.graceEndsAt })),
        current: { amountKobo: quote.currentKobo },
        fine: assessedFine ? { id: assessedFine.id, amountKobo: fineKobo, status: assessedFine.status, destination: assessedFine.destination } : null,
        // How much of the missed portion will go back into the group buffer
        // (bounded by what was actually advanced). Shown for transparency.
        bufferRestoreEstimate: openCase ? openCase.bufferUsedKobo : 0,
      },
      outstandingKobo: openCase?.outstandingKobo ?? 0,
    });
  }),
);

// Shared catch-up quote builder. Used by the catch-up quote endpoint, the
// Paystack route and the wallet route so all three agree on exactly what is
// owed. Keeping this in ONE place matters financially: if the wallet route used
// a different amount than the Paystack route, a member could pay from their
// wallet and silently leave the debt unsettled.
async function loadCatchUpForSubscription({ db, subscription }) {
  const frequency = planFrequency(subscription.plan);
  const cohortId = subscription.cohortId ?? null;
  const periodAmount = subscriptionAmount(subscription);

  if (frequency !== 'WEEKLY' || !cohortId) {
    return { member: null, missedRows: [], openCase: null, assessedFine: null, quote: buildCatchUpQuote({ missedRows: [], currentAmountKobo: periodAmount }), periodAmount };
  }

  const member = await db.cohortMember.findFirst({ where: { cohortId, userId: subscription.userId } });
  if (!member) {
    return { member: null, missedRows: [], openCase: null, assessedFine: null, quote: buildCatchUpQuote({ missedRows: [], currentAmountKobo: periodAmount }), periodAmount };
  }

  const missedRows = await db.missedContribution.findMany({
    where: { memberId: member.id, status: { in: ['MISSED', 'GRACE', 'DEFAULTED'] } },
    orderBy: { weekIndex: 'asc' },
  });

  const config = await getPlatformConfig();
  const openCase = await db.contributionDefault.findFirst({
    where: { memberId: member.id, status: { in: ['OPEN', 'CONTACTING', 'PROMISED', 'PARTIALLY_RECOVERED', 'ESCALATED'] } },
    orderBy: { createdAt: 'asc' },
  });

  // The fine is only charged while the fine policy is enabled and the fine is
  // still ASSESSED. Never a hard-coded amount.
  const assessedFine =
    openCase && config.finePolicy?.enabled === true
      ? await db.contributionFine.findUnique({ where: { reference: `fine:${openCase.id}` } })
      : null;

  const quote = buildCatchUpQuote({
    missedRows,
    currentAmountKobo: periodAmount,
    fineKobo: assessedFine?.status === 'ASSESSED' ? assessedFine.amountKobo : 0,
  });

  return { member, missedRows, openCase, assessedFine, quote, periodAmount };
}

function serializePlan(plan) {  return {
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
    amount: subscriptionAmount(subscription),
    amountKobo: subscription.amountKobo ?? null,
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