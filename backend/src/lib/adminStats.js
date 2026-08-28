// Admin financial statistics — computed from trusted database records only.
// All monetary values are in kobo. Only completed/verified statuses count.

import { Prisma } from '@prisma/client';
import { prisma } from './prisma.js';

const PERIOD_DAYS = { today: 1, '7d': 7, '30d': 30, '3m': 90, '6m': 180, '1y': 365 };
const DEPOSIT_TYPES = ['deposit', 'contribution', 'bonus'];

export function periodRange(period) {
  const end = new Date();
  let start = null;

  if (!period || period === 'all') {
    start = null;
  } else if (period === 'today') {
    start = new Date();
    start.setHours(0, 0, 0, 0);
  } else {
    const days = PERIOD_DAYS[period] ?? 30;
    start = new Date();
    start.setDate(end.getDate() - (days - 1));
    start.setHours(0, 0, 0, 0);
  }

  return { start, end };
}

function whereSince(column, start) {
  return start
    ? Prisma.sql`WHERE ${Prisma.raw(column)} >= ${start}`
    : Prisma.sql`WHERE true`;
}

export async function computeSummary() {
  const [
    statusCounts,
    totalRegistered,
    walletAgg,
    contributions,
    activationRevenue,
    serviceChargeRevenue,
    bonusPayouts,
    expenses,
    txDeposits,
    txWithdrawals,
  ] = await Promise.all([
    prisma.user.groupBy({ by: ['status'], _count: { _all: true } }),
    prisma.user.count(),
    prisma.wallet.aggregate({ _sum: { balance: true, totalContributed: true } }),
    prisma.contributionPayment.aggregate({
      where: { status: 'verified' },
      _sum: { amount: true },
    }),
    prisma.activationPayment.aggregate({
      where: { status: 'verified' },
      _sum: { amount: true },
    }),
    prisma.companyLedger.aggregate({
      where: { type: 'service_charge' },
      _sum: { amount: true },
    }),
    prisma.mlmReferral.aggregate({ _sum: { bonusEarned: true } }),
    prisma.companyLedger.aggregate({ _sum: { amount: true } }),
    prisma.walletTransaction.aggregate({
      where: { status: 'completed', type: { in: DEPOSIT_TYPES } },
      _sum: { amount: true },
    }),
    prisma.walletTransaction.aggregate({
      where: { status: 'completed', type: 'withdrawal' },
      _sum: { amount: true },
    }),
  ]);

  const statusMap = Object.fromEntries(statusCounts.map((s) => [s.status, s._count._all]));

  const totalDeposits = txDeposits._sum.amount ?? 0;
  const totalWithdrawals = txWithdrawals._sum.amount ?? 0;
  const revenue = (activationRevenue._sum.amount ?? 0) + (serviceChargeRevenue._sum.amount ?? 0);
  const bonuses = bonusPayouts._sum.bonusEarned ?? 0;
  const totalExpenses = expenses._sum.amount ?? 0;
  const profit = revenue - bonuses - totalExpenses;

  const mlmRows = await prisma.mlmReferral.findMany({
    where: { level: 1 },
    select: { userId: true, referrerId: true },
  });
  const mlmMemberIds = new Set();
  for (const row of mlmRows) {
    mlmMemberIds.add(row.userId);
    if (row.referrerId) mlmMemberIds.add(row.referrerId);
  }

  return {
    totalRegistered,
    activeUsers: statusMap.active ?? 0,
    suspendedUsers: statusMap.suspended ?? 0,
    totalWalletBalance: walletAgg._sum.balance ?? 0,
    totalUserContributions: contributions._sum.amount ?? 0,
    companyRevenue: revenue,
    companyProfit: profit,
    totalWithdrawals,
    totalDeposits,
    totalMlmMembers: mlmMemberIds.size,
    mlmPayouts: bonuses,
    companyExpenses: totalExpenses,
  };
}

export async function computeCharts(period) {
  const { start } = periodRange(period);

  const [userRows, contribRows, depositRows, withdrawalRows, revenueRows, bonusRows, expenseRows] =
    await Promise.all([
      prisma.$queryRaw`
        SELECT date_trunc('day', "created_at")::date AS day, COUNT(*)::bigint AS value
        FROM "users" ${whereSince('"created_at"', start)}
        GROUP BY 1 ORDER BY 1`,
      prisma.$queryRaw`
        SELECT date_trunc('day', "created_at")::date AS day, SUM("amount")::bigint AS value
        FROM "contribution_payments"
        ${whereSince('"created_at"', start)} AND "status" = 'verified'
        GROUP BY 1 ORDER BY 1`,
      prisma.$queryRaw`
        SELECT date_trunc('day', "created_at")::date AS day, SUM("amount")::bigint AS value
        FROM "wallet_transactions"
        ${whereSince('"created_at"', start)} AND "status" = 'completed' AND "type" IN ('deposit','contribution','bonus')
        GROUP BY 1 ORDER BY 1`,
      prisma.$queryRaw`
        SELECT date_trunc('day', "created_at")::date AS day, SUM("amount")::bigint AS value
        FROM "wallet_transactions"
        ${whereSince('"created_at"', start)} AND "status" = 'completed' AND "type" = 'withdrawal'
        GROUP BY 1 ORDER BY 1`,
      prisma.$queryRaw`
        SELECT date_trunc('day', "verified_at")::date AS day, SUM("amount")::bigint AS value
        FROM "activation_payments"
        ${whereSince('"verified_at"', start)} AND "status" = 'verified'
        GROUP BY 1 ORDER BY 1`,
      prisma.$queryRaw`
        SELECT date_trunc('day', "created_at")::date AS day, SUM("bonus_earned")::bigint AS value
        FROM "mlm_referrals"
        ${whereSince('"created_at"', start)} AND "bonus_earned" > 0
        GROUP BY 1 ORDER BY 1`,
      prisma.$queryRaw`
        SELECT date_trunc('day', "created_at")::date AS day, SUM("amount")::bigint AS value
        FROM "company_ledger"
        ${whereSince('"created_at"', start)} AND "type" = 'expense'
        GROUP BY 1 ORDER BY 1`,
    ]);

  const series = (label, rows) => ({
    label,
    points: rows.map((row) => ({
      date: row.day instanceof Date ? row.day.toISOString().split('T')[0] : String(row.day),
      value: Number(row.value ?? 0),
    })),
  });

  const toMap = (rows) => new Map(rows.map((row) => [row.day.toISOString().split('T')[0], Number(row.value ?? 0)]));

  const revenueMap = toMap(revenueRows);
  const bonusMap = toMap(bonusRows);
  const expenseMap = toMap(expenseRows);
  const allDays = new Set([
    ...revenueMap.keys(),
    ...bonusMap.keys(),
    ...expenseMap.keys(),
  ]);

  const profit = series(
    'Company profit',
    Array.from(allDays)
      .sort()
      .map((date) => ({
        date,
        value: (revenueMap.get(date) ?? 0) - (bonusMap.get(date) ?? 0) - (expenseMap.get(date) ?? 0),
      })),
  );

  const depositMap = toMap(depositRows);
  const withdrawalMap = toMap(withdrawalRows);
  const walletDays = new Set([...depositMap.keys(), ...withdrawalMap.keys()]);
  let running = 0;
  const walletBalanceGrowth = {
    label: 'Wallet balance growth (net)',
    points: Array.from(walletDays)
      .sort()
      .map((date) => {
        running += (depositMap.get(date) ?? 0) - (withdrawalMap.get(date) ?? 0);
        return { date, value: running };
      }),
  };

  return {
    users: series('User growth', userRows),
    contributions: series('Contributions over time', contribRows),
    deposits: series('Deposits', depositRows),
    withdrawals: series('Withdrawals', withdrawalRows),
    revenue: series('Company revenue', revenueRows),
    profit,
    mlmPayouts: series('MLM commission payouts', bonusRows),
    walletBalanceGrowth,
    period,
  };
}
