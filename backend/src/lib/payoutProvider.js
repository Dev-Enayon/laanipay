// Payout provider — the single place a payout is actually settled.
//
// Honest scope boundary: only 'internal' settlement is implemented. A payout
// credits the collector's in-app wallet balance. No real-time Paystack bank
// transfer is wired (that would require recipients' verified NUBAN accounts,
// Paystack Transfer Recipients, and webhook reconciliation). The provider
// column on the payout row makes it explicit which mode was used.
//
// All amounts are kobo. Must be called inside a Prisma transaction.

// Settles an already-created payout for the current cohort week.
// `args`: { tx, payout, collector, cohort, plan, gross, platformFee, net }
// Idempotent by construction — the caller only ever creates one payout per
// (cohort, week) via the unique constraint.
export async function disbursePayout({ tx, payout, collector, cohort, plan, gross, platformFee, net }) {
  if (net <= 0) return { credited: false, reason: 'no_funds' };

  const wallet = await tx.wallet.update({
    where: { userId: collector.userId },
    data: { balance: { increment: net } },
  });

  const wtx = await tx.walletTransaction.create({
    data: {
      userId: collector.userId,
      type: 'payout',
      amount: net,
      balanceAfter: wallet.balance,
      status: 'completed',
      description: `AJO payout — ${plan.name}, week ${cohort.currentWeek}`,
      metadata: { payoutId: payout.id, cohortId: cohort.id, weekIndex: cohort.currentWeek, gross, platformFee },
    },
  });

  const feeLedger = await tx.companyLedger.create({
    data: {
      type: 'platform_fee',
      amount: platformFee,
      description: `AJO platform fee — ${cohort.name}, week ${cohort.currentWeek}`,
    },
  });

  await tx.companyLedger.create({
    data: {
      type: 'payout_disbursement',
      amount: net,
      description: `AJO payout disbursement — ${cohort.name}, week ${cohort.currentWeek} to ${collector.userId}`,
    },
  });

  await tx.notification.create({
    data: {
      userId: collector.userId,
      title: 'AJO payout received',
      body: `You received ₦${(net / 100).toLocaleString('en-NG')} for your ${plan.name} AJO collection (week ${
        cohort.currentWeek
      }, gross ₦${(gross / 100).toLocaleString('en-NG')}, platform fee ₦${(platformFee / 100).toLocaleString(
        'en-NG',
      )}).`,
      type: 'success',
      category: 'system',
    },
  });

  await tx.auditLog.create({
    data: {
      userId: collector.userId,
      action: 'COHORT_PAYOUT_DISBURSED',
      metadata: {
        payoutId: payout.id,
        cohortId: cohort.id,
        weekIndex: cohort.currentWeek,
        gross,
        platformFee,
        net,
        walletTransactionId: wtx.id,
        feeLedgerId: feeLedger.id,
        provider: 'internal',
      },
    },
  });

  return { credited: true, walletTransactionId: wtx.id, balanceAfter: wallet.balance };
}