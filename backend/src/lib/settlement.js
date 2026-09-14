import { prisma } from './prisma.js';
import { verifyTransaction } from './paystack.js';
import { creditActivationBonuses } from './mlm.js';
import { ensureSubscriptionCohort } from './cohort.js';
import { AppError } from '../middleware/error.js';
import {
  sendActivationSuccessEmail,
  sendBonusReceivedEmail,
  sendRankUpEmail,
  sendContributionReceiptEmail,
} from './mailer.js';
import { addContributionPeriod, planFrequency } from './contributions.js';

// Settles a payment reference against Paystack and, on success, records the
// outcome in the database. Idempotent and safe under concurrent calls
// (browser callback + webhook racing) because the status flip only happens
// for rows still in 'pending'.
//
// When `expectedUserId` is provided (REST verification), the reference must
// belong to that user. Webhook calls omit it.
export async function settlePayment({ reference, expectedUserId }) {
  const activation = await prisma.activationPayment.findUnique({
    where: { paystackReference: reference },
  });

  if (activation) {
    if (expectedUserId && activation.userId !== expectedUserId) {
      throw new AppError('Payment reference does not belong to this account', 403);
    }

    if (activation.status === 'verified') {
      return { verified: true, kind: 'activation', already: true, bonusesCredited: [] };
    }

    const result = await verifyTransaction(reference);
    const data = result?.data ?? {};

    if (data.status !== 'success' || Number(data.amount) !== activation.amount) {
      await prisma.activationPayment.update({
        where: { id: activation.id },
        data: { status: 'failed' },
      });
      return { verified: false, kind: 'activation', reason: 'Payment not successful' };
    }

    let bonusesCredited = [];
    let rankChanges = [];
    let freshlyActivated = false;

    await prisma.$transaction(async (tx) => {
      const claimed = await tx.activationPayment.updateMany({
        where: { id: activation.id, status: 'pending' },
        data: { status: 'verified', verifiedAt: new Date() },
      });

      if (claimed.count === 1) {
        freshlyActivated = true;
        await tx.user.update({
          where: { id: activation.userId },
          data: { activationStatus: true },
        });
        const mlmResult = await creditActivationBonuses(activation.userId, tx);
        bonusesCredited = mlmResult.credited;
        rankChanges = mlmResult.rankChanges;
        await tx.auditLog.create({
          data: {
            userId: activation.userId,
            action: 'ACCOUNT_ACTIVATED',
            metadata: { reference, amount: activation.amount },
          },
        });
      }
    });

    if (freshlyActivated) {
      const user = await prisma.user.findUnique({ where: { id: activation.userId } });
      if (user) {
        sendActivationSuccessEmail({ to: user.email, name: user.fullName, bonuses: bonusesCredited }).catch(() => {});
        for (const bonus of bonusesCredited) {
          sendBonusReceivedEmail({
            to: bonus.email,
            name: bonus.name,
            referrerName: user.fullName,
            bonus: bonus.bonus,
            level: bonus.level,
          }).catch(() => {});
        }
        for (const change of rankChanges) {
          sendRankUpEmail({ to: change.email, name: change.name, rank: change.rank }).catch(() => {});
        }
      }
    }

    return { verified: true, kind: 'activation', bonusesCredited };
  }

  const contribution = await prisma.contributionPayment.findUnique({
    where: { paystackReference: reference },
    include: { subscription: { include: { plan: true, cohort: true } } },
  });

  if (contribution) {
    if (expectedUserId && contribution.subscription.userId !== expectedUserId) {
      throw new AppError('Payment reference does not belong to this account', 403);
    }

    if (contribution.status === 'verified') {
      return { verified: true, kind: 'contribution', already: true };
    }

    const result = await verifyTransaction(reference);
    const data = result?.data ?? {};

    if (data.status !== 'success' || Number(data.amount) !== contribution.amount) {
      await prisma.contributionPayment.update({
        where: { id: contribution.id },
        data: { status: 'failed' },
      });
      return { verified: false, kind: 'contribution', reason: 'Payment not successful' };
    }

    // nextPaymentDate advances by one contribution period (+1 month for MONTHLY
    // plans, +1 week for WEEKLY plans) inside the shared verified-contribution
    // recorder below.
    let freshlyVerified = false;
    let verifier = { weekIndex: null, cohortId: null, cohortName: null };
    let nextPaymentDate = null;

    await prisma.$transaction(async (tx) => {
      const claimed = await tx.contributionPayment.updateMany({
        where: { id: contribution.id, status: 'pending' },
        data: { status: 'verified', paidAt: new Date() },
      });

      if (claimed.count === 1) {
        freshlyVerified = true;
        const recorded = await recordVerifiedContribution({
          tx,
          subscription: contribution.subscription,
          payment: contribution,
          reference,
        });
        verifier = recorded.verifier;
        nextPaymentDate = recorded.nextPaymentDate;
      }
    });

    if (freshlyVerified) {
      const plan = contribution.subscription.plan;
      const user = await prisma.user.findUnique({ where: { id: contribution.subscription.userId } });
      if (user && nextPaymentDate) {
        sendContributionReceiptEmail({
          to: user.email,
          name: user.fullName,
          planName: plan?.name ?? 'Contribution plan',
          amount: contribution.amount,
          reference,
          nextPaymentDate: nextPaymentDate.toISOString().split('T')[0],
        }).catch(() => {});
      }
    }

    return { verified: true, kind: 'contribution', ...verifier };
  }

  throw new AppError('Unknown payment reference', 404);
}

// Records everything that a newly VERIFIED contribution payment entails. Called
// inside the caller's transaction, by both:
//   - settlePayment (Paystack contribution checkout — money came externally),
//   - POST /contributions/pay/wallet (the contribution was paid from the user's
//     LaaniPay wallet balance).
// Because both paths share this function, wallet-paid contributions behave
// byte-for-byte like Paystack-paid ones: cohort attribution, nextPaymentDate
// advance, totalContributed, wallet ledger, and audit trail.
//
// `subscription` must include `plan` and `cohort`; `payment` must be the
// ContributionPayment row (already `status: 'verified'` with `paidAt` set).
export async function recordVerifiedContribution({ tx, subscription, payment, reference }) {
  const frequency = planFrequency(subscription.plan);
  const nextPaymentDate = addContributionPeriod(subscription.nextPaymentDate, subscription.plan);

  // Weekly cycle + AJO cohort attribution only; monthly contributions have no
  // cohort (cohort.js also guards this defensively).
  let cohort = null;
  let weekIndex = null;
  if (frequency === 'WEEKLY') {
    const joined = await ensureSubscriptionCohort(tx, subscription);
    cohort = joined.cohort;
    weekIndex = cohort?.status === 'ACTIVE' ? cohort.currentWeek : null;
  }

  await tx.contributionPayment.update({
    where: { id: payment.id },
    data: { weekIndex, cohortId: cohort?.id ?? null },
  });

  if (cohort && weekIndex) {
    const memberRow = await tx.cohortMember.findFirst({
      where: { cohortId: cohort.id, userId: subscription.userId },
    });
    if (memberRow) {
      await tx.cohortMember.update({
        where: { id: memberRow.id },
        data: {
          lastPaidWeek: weekIndex,
          totalPaid: { increment: payment.amount },
        },
      });
    }
  }

  await tx.contributionSubscription.update({
    where: { id: subscription.id },
    data: { nextPaymentDate },
  });
  const wallet = await tx.wallet.update({
    where: { userId: subscription.userId },
    data: { totalContributed: { increment: payment.amount } },
  });
  await tx.walletTransaction.create({
    data: {
      userId: subscription.userId,
      type: 'contribution',
      amount: payment.amount,
      balanceAfter: wallet.balance,
      status: 'completed',
      reference,
      description: `${frequency === 'WEEKLY' ? 'Weekly' : 'Monthly'} contribution — ${subscription.plan?.name ?? 'Contribution plan'}`,
      metadata: {
        planId: subscription.planId,
        frequency,
        weekIndex,
        cohortId: cohort?.id ?? null,
      },
    },
  });
  await tx.auditLog.create({
    data: {
      userId: subscription.userId,
      action: 'CONTRIBUTION_PAYMENT_VERIFIED',
      metadata: {
        reference,
        amount: payment.amount,
        frequency,
        weekIndex,
        cohortId: cohort?.id ?? null,
      },
    },
  });

  return {
    verifier: { weekIndex, cohortId: cohort?.id ?? null, cohortName: cohort?.name ?? null },
    nextPaymentDate,
  };
}