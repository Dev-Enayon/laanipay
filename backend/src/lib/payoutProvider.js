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
// `args`: { tx, payout, collector, cohort, plan, gross, platformFee, net,
//           protectedFromBuffer }
// `protectedFromBuffer` is the portion of `net` that came from the group
// security buffer rather than from the week's collected pot. It is threaded
// through to the wallet transaction, the company ledger and the member
// notification so the disbursement is fully explainable: gross - fee is the pot
// portion, and the buffer advance is shown separately. Defaults to 0, which
// preserves the exact pre-buffer behaviour.
export async function disbursePayout({
  tx,
  payout,
  collector,
  cohort,
  plan,
  gross,
  platformFee,
  net,
  protectedFromBuffer = 0,
}) {
  if (net <= 0) return { credited: false, reason: 'no_funds' };
  const protectedKobo = Math.max(0, Math.round(Number(protectedFromBuffer) || 0));

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
      metadata: {
        payoutId: payout.id,
        cohortId: cohort.id,
        weekIndex: cohort.currentWeek,
        gross,
        platformFee,
        potPortion: net - protectedKobo,
        protectedFromBuffer: protectedKobo,
      },
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
      description:
        `AJO payout disbursement — ${cohort.name}, week ${cohort.currentWeek} to ${collector.userId}` +
        (protectedKobo > 0
          ? ` (includes ₦${(protectedKobo / 100).toLocaleString('en-NG')} advanced from the group security buffer)`
          : ''),
    },
  });

  // NOTE: the buffer advance is deliberately NOT written to the company ledger.
  // The single outflow is already recorded above as `payout_disbursement`
  // (amount = net, which includes the protected portion), and the movement of
  // the fund itself is recorded in the BufferLedger. Writing a second company
  // ledger row for the same money would double-count the outflow in the admin
  // totals, so the two ledgers are kept non-overlapping: BufferLedger tracks
  // the fund, CompanyLedger tracks company outflows.

  await tx.notification.create({
    data: {
      userId: collector.userId,
      title: 'AJO payout received',
      body: `You received ₦${(net / 100).toLocaleString('en-NG')} for your ${plan.name} AJO collection (week ${
        cohort.currentWeek
      }, gross ₦${(gross / 100).toLocaleString('en-NG')}, platform fee ₦${(platformFee / 100).toLocaleString(
        'en-NG',
      )}${protectedKobo > 0 ? `, group buffer cover ₦${(protectedKobo / 100).toLocaleString('en-NG')}` : ''}).`,
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
        potPortion: net - protectedKobo,
        protectedFromBuffer: protectedKobo,
        walletTransactionId: wtx.id,
        feeLedgerId: feeLedger.id,
        provider: 'internal',
      },
    },
  });

  return { credited: true, walletTransactionId: wtx.id, balanceAfter: wallet.balance };
}