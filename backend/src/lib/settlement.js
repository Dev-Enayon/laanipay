import { prisma } from './prisma.js';
import { verifyTransaction } from './paystack.js';
import { creditActivationBonuses } from './mlm.js';
import { AppError } from '../middleware/error.js';
import {
  sendActivationSuccessEmail,
  sendBonusReceivedEmail,
  sendRankUpEmail,
  sendContributionReceiptEmail,
} from './mailer.js';

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
    include: { subscription: { include: { plan: true } } },
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

    const nextPaymentDate = new Date(contribution.subscription.nextPaymentDate);
    nextPaymentDate.setDate(1);
    nextPaymentDate.setMonth(nextPaymentDate.getMonth() + 1);
    const lastDay = new Date(nextPaymentDate.getFullYear(), nextPaymentDate.getMonth() + 1, 0).getDate();
    nextPaymentDate.setDate(Math.min(contribution.subscription.nextPaymentDate.getDate(), lastDay));

    let freshlyVerified = false;

    await prisma.$transaction(async (tx) => {
      const claimed = await tx.contributionPayment.updateMany({
        where: { id: contribution.id, status: 'pending' },
        data: { status: 'verified', paidAt: new Date() },
      });

      if (claimed.count === 1) {
        freshlyVerified = true;
        await tx.contributionSubscription.update({
          where: { id: contribution.subscriptionId },
          data: { nextPaymentDate },
        });
        const wallet = await tx.wallet.update({
          where: { userId: contribution.subscription.userId },
          data: { totalContributed: { increment: contribution.amount } },
        });
        await tx.walletTransaction.create({
          data: {
            userId: contribution.subscription.userId,
            type: 'contribution',
            amount: contribution.amount,
            balanceAfter: wallet.balance,
            status: 'completed',
            reference: contribution.paystackReference,
            description: `Monthly contribution — ${contribution.subscription.plan?.name ?? 'Contribution plan'}`,
            metadata: { planId: contribution.subscription.planId },
          },
        });
        await tx.auditLog.create({
          data: {
            userId: contribution.subscription.userId,
            action: 'CONTRIBUTION_PAYMENT_VERIFIED',
            metadata: { reference, amount: contribution.amount },
          },
        });
      }
    });

    if (freshlyVerified) {
      const user = await prisma.user.findUnique({ where: { id: contribution.subscription.userId } });
      if (user) {
        sendContributionReceiptEmail({
          to: user.email,
          name: user.fullName,
          planName: contribution.subscription.plan?.name ?? 'Contribution plan',
          amount: contribution.amount,
          reference,
          nextPaymentDate: nextPaymentDate.toISOString().split('T')[0],
        }).catch(() => {});
      }
    }

    return { verified: true, kind: 'contribution' };
  }

  throw new AppError('Unknown payment reference', 404);
}
