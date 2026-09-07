// Monthly ₦300 subscription (amount from admin settings) — core, idempotent,
// atomic. All amounts in kobo.
import { prisma } from './prisma.js';
import { env } from '../config/env.js';
import { getPlatformConfig } from './config.js';
import { splitReferralFee } from './rewards.js';
import { creditSubscriptionRewards } from './mlm.js';

const AMOUNT = async (config) => {
  const cfg = config ?? (await getPlatformConfig());
  return cfg.monthlySubscriptionFeeKobo ?? (env.serviceChargeKobo || 30000); // ₦300 monthly subscription
};

export function naira(kobo) {
  return `₦${(kobo / 100).toLocaleString('en-NG')}`;
}

// 'YYYY-MM' string for a given Date (local time).
export function billingMonthFor(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

// First day of the next month (local), used for the "next expected charge date".
export function nextChargeDate(date = new Date()) {
  const d = new Date(date.getFullYear(), date.getMonth() + 1, 1);
  return d;
}

/**
 * Collects the service charge for `billingMonth` for ALL eligible users.
 * Idempotent: the unique (userId, billingMonth) constraint guarantees a user
 * is never charged twice for the same month, even if this runs concurrently
 * on multiple scheduler instances or is triggered manually.
 *
 * Processes each user independently so one failure doesn't stop the rest.
 * Returns a summary { collected, insufficient, failed, skipped }.
 */
export async function collectMonthlyServiceCharge(billingMonth) {
  const month = billingMonth ?? billingMonthFor();
  const amount = await AMOUNT();

  let summary = { collected: 0, insufficient: 0, failed: 0, skipped: 0 };

  // Look up the admin account to credit the collected fee to.
  const admin = await prisma.user.findFirst({
    where: { role: 'admin', email: env.adminEmail },
  });

  // Batch user ids. For large numbers of users this runs per-user transactions
  // (bounded, sequential) — safe and auditable for a financial feature.
  const ids = await prisma.user.findMany({
    where: {
      activationStatus: true,
      status: { not: 'suspended' },
      wallet: { isNot: null },
    },
    select: { id: true },
  });

  for (const { id: userId } of ids) {
    const result = await collectForUser({ userId, billingMonth: month, amount, admin });
    if (result.status === 'collected') summary.collected += 1;
    else if (result.status === 'insufficient_funds') summary.insufficient += 1;
    else if (result.status === 'failed') summary.failed += 1;
    else summary.skipped += 1;
  }

  return summary;
}

/**
 * Collects the charge for a single user/month. Atomic and idempotent.
 * - The full monthly fee is deducted, never a negative balance.
 * - Insufficient balance => records 'insufficient_funds' row + notification, no deduction.
 * - Success => wallet debited, admin wallet credited, CompanyLedger income,
 *   WalletTransaction (service_charge), Notification, AuditLog.
 */
export async function collectForUser({ userId, billingMonth, amount, admin }) {
  if (!amount) amount = await AMOUNT();
  const month = billingMonth ?? billingMonthFor();

  try {
    const row = await prisma.$transaction(async (tx) => {
      // Claim this (user, month) atomically. If it already exists, skip.
      const existing = await tx.serviceCharge.findUnique({
        where: { userId_billingMonth: { userId, billingMonth: month } },
      });
      if (existing) return { status: 'skipped', id: existing.id };

      // Read wallet inside the transaction so balance is consistent.
      const wallet = await tx.wallet.findUnique({ where: { userId } });
      if (!wallet) {
        // No wallet => not an eligible payer; record nothing (skip).
        return { status: 'skipped' };
      }

      if (wallet.balance < amount) {
        // Insufficient funds: do NOT go negative. Record attempt + notify.
        const row = await tx.serviceCharge.create({
          data: {
            userId,
            amountKobo: amount,
            currency: env.serviceChargeCurrency,
            billingMonth: month,
            status: 'insufficient_funds',
            failureReason: 'Insufficient wallet balance',
          },
        });
        await tx.auditLog.create({
          data: {
            userId,
            action: 'SERVICE_CHARGE_INSUFFICIENT',
            metadata: { billingMonth: month, amountKobo: amount },
          },
        });
        await tx.notification.create({
          data: {
            userId,
            title: 'Monthly subscription not collected',
            body: `We could not collect the ${naira(amount)} monthly subscription because your wallet balance is below ${naira(
              amount,
            )}. It will be retried in a future month when funds are available.`,
            type: 'error',
          },
        });
        return { status: 'insufficient_funds', id: row.id };
      }

      // Enough funds. Deduct atomically and guard against going negative.
      let creditedAdmin = admin;
      if (!creditedAdmin) {
        creditedAdmin = await tx.user.findFirst({ where: { role: 'admin' } });
      }

      const updatedWallet = await tx.wallet.update({
        where: { userId },
        data: { balance: { decrement: amount } },
      });
      if (updatedWallet.balance < 0) {
        // Shouldn't happen (checked above) but never allow negative balances.
        throw new Error('Service charge would drive wallet balance negative');
      }

      // Credit the admin wallet (the internal settlement target).
      if (creditedAdmin) {
        await tx.wallet.upsert({
          where: { userId: creditedAdmin.id },
          update: { balance: { increment: amount } },
          create: { userId: creditedAdmin.id, balance: amount },
        });
      }

      // 3-level referral rewards on the monthly subscription. The split is
      // capped against the collected amount, so rewards can never exceed the
      // fee; the balance is platform revenue (ledger row below).
      const config = await getPlatformConfig();
      const split = splitReferralFee({
        feeKobo: amount,
        type: 'MONTHLY_SUBSCRIPTION',
        rewards: config.rewards,
      });
      if (split.totalRewards > 0) {
        await creditSubscriptionRewards({
          tx,
          payerUserId: userId,
          billingMonth: month,
          rewardsByLevel: split.byLevel,
        });
      }

      // Company ledger income entry for reconciliation.
      const ledger = await tx.companyLedger.create({
        data: {
          type: 'service_charge',
          amount,
          description: `Monthly subscription — ${month}`,
          adminId: creditedAdmin?.id ?? null,
        },
      });

      // Wallet transaction ledger (separate row, clear description).
      const wtx = await tx.walletTransaction.create({
        data: {
          userId,
          type: 'service_charge',
          amount,
          balanceAfter: updatedWallet.balance,
          status: 'completed',
          description: `Monthly subscription - ${naira(amount)}`,
          metadata: { billingMonth: month, ledgerId: ledger.id, creditedTo: creditedAdmin?.email ?? null },
        },
      });

      // Persist the service-charge record (the single source of truth).
      const row = await tx.serviceCharge.create({
        data: {
          userId,
          amountKobo: amount,
          currency: env.serviceChargeCurrency,
          billingMonth: month,
          status: 'collected',
          walletTransactionId: wtx.id,
          creditedTo: creditedAdmin?.id ?? null,
          companyLedgerId: ledger.id,
          // Internal settlement: no outbound Paystack transfer for this mode.
          paystackReference: null,
          paystackStatus: 'internal',
          collectedAt: new Date(),
        },
      });

      // Notify the user on their dashboard.
      await tx.notification.create({
        data: {
          userId,
          title: 'Monthly Subscription Deducted',
          body: `${naira(amount)} has been deducted from your wallet as your monthly subscription.`,
          type: 'success',
        },
      });

      // Audit trail.
      await tx.auditLog.create({
        data: {
          userId,
          action: 'SERVICE_CHARGE_COLLECTED',
          metadata: {
            billingMonth: month,
            amountKobo: amount,
            walletTransactionId: wtx.id,
            balanceAfter: updatedWallet.balance,
          },
        },
      });

      return { status: 'collected', id: row.id, walletTransactionId: wtx.id };
    });

    return row;
  } catch (err) {
    console.error('[serviceCharge] collection failed for', userId, month, err?.message ?? err);
    return { status: 'failed' };
  }
}
