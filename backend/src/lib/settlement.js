import { prisma } from './prisma.js';
import { verifyTransaction } from './paystack.js';
import { creditActivationBonuses } from './mlm.js';
import { AppError } from '../middleware/error.js';

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

    await prisma.$transaction(async (tx) => {
      const claimed = await tx.activationPayment.updateMany({
        where: { id: activation.id, status: 'pending' },
        data: { status: 'verified', verifiedAt: new Date() },
      });

      if (claimed.count === 1) {
        await tx.user.update({
          where: { id: activation.userId },
          data: { activationStatus: true },
        });
        bonusesCredited = await creditActivationBonuses(activation.userId, tx);
        await tx.auditLog.create({
          data: {
            userId: activation.userId,
            action: 'ACCOUNT_ACTIVATED',
            metadata: { reference, amount: activation.amount },
          },
        });
      }
    });

    return { verified: true, kind: 'activation', bonusesCredited };
  }

  const contribution = await prisma.contributionPayment.findUnique({
    where: { paystackReference: reference },
    include: { subscription: true },
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
    nextPaymentDate.setMonth(nextPaymentDate.getMonth() + 1);

    await prisma.$transaction(async (tx) => {
      const claimed = await tx.contributionPayment.updateMany({
        where: { id: contribution.id, status: 'pending' },
        data: { status: 'verified', paidAt: new Date() },
      });

      if (claimed.count === 1) {
        await tx.contributionSubscription.update({
          where: { id: contribution.subscriptionId },
          data: { nextPaymentDate },
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

    return { verified: true, kind: 'contribution' };
  }

  throw new AppError('Unknown payment reference', 404);
}
