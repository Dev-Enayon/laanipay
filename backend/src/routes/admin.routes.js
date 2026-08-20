import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { asyncHandler, AppError } from '../middleware/error.js';
import { logAudit } from '../lib/audit.js';
import { computeSummary, computeCharts } from '../lib/adminStats.js';

const router = Router();

router.use(requireAuth, requireAdmin);

const LEVELS = 3;

function num(value, fallback) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

async function buildDepthMap() {
  const rows = await prisma.mlmReferral.findMany({
    where: { level: 1 },
    select: { userId: true, referrerId: true },
  });
  const parent = new Map();
  for (const row of rows) {
    if (row.referrerId) parent.set(row.userId, row.referrerId);
  }
  const depth = new Map();
  const getDepth = (id) => {
    if (depth.has(id)) return depth.get(id);
    const p = parent.get(id);
    const d = p ? getDepth(p) + 1 : 1;
    depth.set(id, d);
    return d;
  };
  for (const id of parent.keys()) getDepth(id);
  return depth;
}

// --- Overview statistics + period charts ---

router.get(
  '/stats',
  asyncHandler(async (req, res) => {
    const period = req.query.period ?? 'all';
    const [summary, charts] = await Promise.all([computeSummary(), computeCharts(period)]);
    res.json({ summary, charts });
  }),
);

// --- User management ---

router.get(
  '/users',
  asyncHandler(async (req, res) => {
    const search = (req.query.search ?? '').trim();
    const status = req.query.status ?? '';
    const planId = req.query.planId ?? '';
    const level = req.query.level ? num(req.query.level, 0) : 0;
    const sort = ['wallet_balance', 'total_contributed', 'created_at'].includes(req.query.sort)
      ? req.query.sort
      : 'created_at';
    const order = req.query.order === 'asc' ? 'asc' : 'desc';
    const page = Math.max(1, num(req.query.page, 1));
    const pageSize = Math.min(100, Math.max(1, num(req.query.pageSize, 20)));

    const where = { AND: [] };

    if (search) {
      where.AND.push({
        OR: [
          { fullName: { contains: search, mode: 'insensitive' } },
          { email: { contains: search, mode: 'insensitive' } },
          { phone: { contains: search, mode: 'insensitive' } },
        ],
      });
    }
    if (status === 'active' || status === 'suspended') {
      where.AND.push({ status });
    }
    if (planId) {
      where.AND.push({
        contributionSubscriptions: { some: { planId, status: 'active' } },
      });
    }
    let depthMap = null;
    if (level > 0) {
      depthMap = await buildDepthMap();
      const ids = Array.from(depthMap.entries())
        .filter(([, d]) => d === level)
        .map(([id]) => id);
      where.AND.push({ id: { in: ids } });
    }

    const orderBy = (() => {
      if (sort === 'wallet_balance') return [{ wallet: { balance: order } }];
      if (sort === 'total_contributed') return [{ wallet: { totalContributed: order } }];
      return [{ createdAt: order }];
    })();

    const [total, users] = await Promise.all([
      prisma.user.count({ where }),
      prisma.user.findMany({
        where,
        orderBy,
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          fullName: true,
          email: true,
          phone: true,
          status: true,
          activationStatus: true,
          role: true,
          referralCode: true,
          createdAt: true,
          lastActivityAt: true,
          wallet: { select: { balance: true, totalContributed: true } },
          contributionSubscriptions: {
            where: { status: 'active' },
            take: 1,
            include: { plan: { select: { id: true, name: true, monthlyAmount: true } } },
          },
        },
      }),
    ]);

    const ids = users.map((u) => u.id);

    const [withdrawalRows, directRows, downlineRows] = await Promise.all([
      prisma.walletTransaction.groupBy({
        by: ['userId'],
        where: { userId: { in: ids }, type: 'withdrawal', status: 'completed' },
        _sum: { amount: true },
      }),
      prisma.mlmReferral.groupBy({
        by: ['referrerId'],
        where: { referrerId: { in: ids }, level: 1 },
        _count: { _all: true },
      }),
      prisma.mlmReferral.groupBy({
        by: ['referrerId'],
        where: { referrerId: { in: ids } },
        _count: { _all: true },
      }),
    ]);

    const withdrawnByUser = Object.fromEntries(withdrawalRows.map((r) => [r.userId, r._sum.amount ?? 0]));
    const directByUser = Object.fromEntries(directRows.map((r) => [r.referrerId, r._count._all]));
    const downlineByUser = Object.fromEntries(downlineRows.map((r) => [r.referrerId, r._count._all]));

    if (!depthMap) {
      depthMap = await buildDepthMap();
    }

    const rows = users.map((u) => ({
      id: u.id,
      fullName: u.fullName,
      email: u.email,
      phone: u.phone,
      status: u.status,
      activationStatus: u.activationStatus,
      role: u.role,
      referralCode: u.referralCode,
      createdAt: u.createdAt,
      lastActivityAt: u.lastActivityAt,
      walletBalance: u.wallet?.balance ?? 0,
      totalContributed: u.wallet?.totalContributed ?? 0,
      totalWithdrawn: withdrawnByUser[u.id] ?? 0,
      plan: u.contributionSubscriptions[0]?.plan ?? null,
      mlmLevel: depthMap.get(u.id) ?? 1,
      directReferrals: directByUser[u.id] ?? 0,
      totalDownline: downlineByUser[u.id] ?? 0,
    }));

    res.json({ users: rows, total, page, pageSize, levels: LEVELS });
  }),
);

router.get(
  '/users/:id',
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({
      where: { id: req.params.id },
      include: {
        wallet: true,
        contributionSubscriptions: {
          orderBy: { createdAt: 'desc' },
          include: { plan: true, payments: { orderBy: { createdAt: 'desc' } } },
        },
        mlmRanks: { orderBy: { achievedAt: 'desc' } },
        downline: {
          orderBy: [{ level: 'asc' }, { createdAt: 'desc' }],
          include: { user: { select: { id: true, fullName: true, email: true, activationStatus: true } } },
        },
        placement: { include: { referrer: { select: { id: true, fullName: true, email: true } } } },
      },
    });

    if (!user) {
      throw new AppError('User not found', 404);
    }

    const [transactions, bonusesAgg] = await Promise.all([
      prisma.walletTransaction.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
      prisma.mlmReferral.aggregate({
        where: { referrerId: user.id },
        _sum: { bonusEarned: true },
      }),
    ]);

    const [withdrawnRows, depthMap] = await Promise.all([
      prisma.walletTransaction.groupBy({
        by: ['userId'],
        where: { userId: user.id, type: 'withdrawal', status: 'completed' },
        _sum: { amount: true },
      }),
      buildDepthMap(),
    ]);

    const activeSub = user.contributionSubscriptions.find((s) => s.status === 'active') ?? null;
    const verifiedPayments = activeSub?.payments.filter((p) => p.status === 'verified') ?? [];
    const directCount = user.downline.filter((r) => r.level === 1).length;
    const directActivated = user.downline.filter((r) => r.level === 1 && r.user.activationStatus).length;

    logAudit({
      adminId: req.user.id,
      targetUserId: user.id,
      action: 'ADMIN_USER_VIEWED',
      metadata: { email: user.email },
    });

    res.json({
      user: {
        id: user.id,
        fullName: user.fullName,
        email: user.email,
        phone: user.phone,
        status: user.status,
        role: user.role,
        activationStatus: user.activationStatus,
        referralCode: user.referralCode,
        createdAt: user.createdAt,
        lastActivityAt: user.lastActivityAt,
        suspendedAt: user.suspendedAt,
        suspendedBy: user.suspendedBy,
        suspendedReason: user.suspendedReason,
        reactivatedAt: user.reactivatedAt,
        reactivatedBy: user.reactivatedBy,
      },
      wallet: {
        balance: user.wallet?.balance ?? 0,
        totalContributed: user.wallet?.totalContributed ?? 0,
        totalWithdrawn: withdrawnRows[0]?._sum.amount ?? 0,
      },
      transactions: transactions.map((t) => ({
        id: t.id,
        type: t.type,
        amount: t.amount,
        balanceAfter: t.balanceAfter,
        status: t.status,
        reference: t.reference,
        description: t.description,
        createdAt: t.createdAt,
      })),
      contribution: {
        subscription: activeSub
          ? {
              id: activeSub.id,
              status: activeSub.status,
              nextPaymentDate: activeSub.nextPaymentDate,
              plan: {
                id: activeSub.plan.id,
                name: activeSub.plan.name,
                monthlyAmount: activeSub.plan.monthlyAmount,
              },
            }
          : null,
        history: activeSub?.payments.map((p) => ({
          id: p.id,
          reference: p.paystackReference,
          amount: p.amount,
          status: p.status,
          paidAt: p.paidAt,
          createdAt: p.createdAt,
        })) ?? [],
        monthsPaid: verifiedPayments.length,
        totalContributed: verifiedPayments.reduce((sum, p) => sum + p.amount, 0),
      },
      mlm: {
        depth: depthMap.get(user.id) ?? 1,
        directCount,
        directActivated,
        totalDownline: user.downline.length,
        bonusesEarned: bonusesAgg._sum.bonusEarned ?? 0,
        currentRank: user.mlmRanks[0]?.rank ?? null,
        ranks: user.mlmRanks.map((r) => ({ rank: r.rank, achievedAt: r.achievedAt })),
        referrer: user.placement[0]?.referrer ?? null,
        downline: user.downline.map((r) => ({
          id: r.user.id,
          fullName: r.user.fullName,
          email: r.user.email,
          activationStatus: r.user.activationStatus,
          level: r.level,
          bonusEarned: r.bonusEarned,
        })),
      },
    });
  }),
);

// --- Suspend / reactivate ---

router.post(
  '/users/:id/suspend',
  asyncHandler(async (req, res) => {
    const target = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!target) {
      throw new AppError('User not found', 404);
    }
    if (target.id === req.user.id) {
      throw new AppError('You cannot suspend your own account', 400);
    }
    if (target.role === 'admin') {
      throw new AppError('You cannot suspend an administrator', 400);
    }
    if (target.status === 'suspended') {
      throw new AppError('Account is already suspended', 409);
    }

    const reason = (req.body?.reason ?? '').trim();
    if (!reason) {
      throw new AppError('A suspension reason is required', 400);
    }

    await prisma.user.update({
      where: { id: target.id },
      data: {
        status: 'suspended',
        suspendedAt: new Date(),
        suspendedBy: req.user.id,
        suspendedReason: reason,
        reactivatedAt: null,
        reactivatedBy: null,
      },
    });

    await logAudit({
      adminId: req.user.id,
      targetUserId: target.id,
      action: 'ADMIN_USER_SUSPENDED',
      reason,
      metadata: { email: target.email },
    });

    res.json({ message: 'Account suspended', status: 'suspended' });
  }),
);

router.post(
  '/users/:id/reactivate',
  asyncHandler(async (req, res) => {
    const target = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!target) {
      throw new AppError('User not found', 404);
    }
    if (target.status !== 'suspended') {
      throw new AppError('Account is not suspended', 409);
    }

    const reason = (req.body?.reason ?? '').trim() || 'Account reactivated';

    await prisma.user.update({
      where: { id: target.id },
      data: {
        status: 'active',
        reactivatedAt: new Date(),
        reactivatedBy: req.user.id,
      },
    });

    await logAudit({
      adminId: req.user.id,
      targetUserId: target.id,
      action: 'ADMIN_USER_REACTIVATED',
      reason,
      metadata: { email: target.email },
    });

    res.json({ message: 'Account reactivated', status: 'active' });
  }),
);

// --- Manual wallet adjustments ---

router.post(
  '/users/:id/wallet',
  asyncHandler(async (req, res) => {
    const target = await prisma.user.findUnique({
      where: { id: req.params.id },
      include: { wallet: true },
    });
    if (!target) {
      throw new AppError('User not found', 404);
    }
    if (!target.wallet) {
      throw new AppError('User has no wallet', 400);
    }

    const { type, amount, note } = req.body ?? {};
    const validTypes = ['deposit', 'withdrawal', 'adjustment'];
    if (!validTypes.includes(type)) {
      throw new AppError('Invalid adjustment type', 400);
    }

    const amountNum = num(amount, 0);
    if (type !== 'adjustment' && amountNum <= 0) {
      throw new AppError('Amount must be greater than zero', 400);
    }
    if (type === 'adjustment' && amountNum === 0) {
      throw new AppError('Amount must not be zero', 400);
    }
    const description = (note ?? '').trim();
    if (!description) {
      throw new AppError('A note describing the adjustment is required', 400);
    }

    const delta = type === 'withdrawal' ? -amountNum : type === 'adjustment' ? amountNum : amountNum;

    const wallet = await prisma.$transaction(async (tx) => {
      const current = await tx.wallet.findUnique({ where: { userId: target.id } });
      const newBalance = current.balance + delta;
      if (newBalance < 0) {
        throw new AppError('Insufficient wallet balance', 400);
      }
      const updated = await tx.wallet.update({
        where: { id: target.wallet.id },
        data: { balance: newBalance },
      });
      await tx.walletTransaction.create({
        data: {
          userId: target.id,
          type,
          amount: Math.abs(amountNum),
          balanceAfter: newBalance,
          status: 'completed',
          description,
          metadata: { adminId: req.user.id, sign: delta < 0 ? -1 : 1 },
        },
      });
      return updated;
    });

    await logAudit({
      adminId: req.user.id,
      targetUserId: target.id,
      action: 'ADMIN_WALLET_ADJUSTMENT',
      reason: description,
      metadata: { type, amount: Math.abs(amountNum), sign: delta < 0 ? -1 : 1, balanceAfter: wallet.balance },
    });

    res.json({ message: 'Wallet updated', balance: wallet.balance });
  }),
);

// --- Company expenses ---

router.post(
  '/expenses',
  asyncHandler(async (req, res) => {
    const amount = num(req.body?.amount, 0);
    const description = (req.body?.description ?? '').trim();

    if (amount <= 0) {
      throw new AppError('Amount must be greater than zero', 400);
    }
    if (!description) {
      throw new AppError('A description is required', 400);
    }

    const ledger = await prisma.companyLedger.create({
      data: {
        type: 'expense',
        amount,
        description,
        adminId: req.user.id,
      },
    });

    await logAudit({
      adminId: req.user.id,
      action: 'ADMIN_EXPENSE_RECORDED',
      reason: description,
      metadata: { ledgerId: ledger.id, amount },
    });

    res.status(201).json({ message: 'Expense recorded', ledger });
  }),
);

// --- Admin activity log ---

router.get(
  '/audit-logs',
  asyncHandler(async (req, res) => {
    const page = Math.max(1, num(req.query.page, 1));
    const pageSize = Math.min(100, Math.max(1, num(req.query.pageSize, 20)));
    const action = (req.query.action ?? '').trim();
    const targetUserId = req.query.targetUserId ?? '';

    const where = {
      OR: [
        { adminId: { not: null } },
        { targetUserId: { not: null } },
        { action: { startsWith: 'ADMIN_' } },
      ],
      ...(action ? { action } : {}),
      ...(targetUserId ? { targetUserId } : {}),
    };

    const [total, logs] = await Promise.all([
      prisma.auditLog.count({ where }),
      prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          adminUser: { select: { id: true, fullName: true, email: true } },
          targetUser: { select: { id: true, fullName: true, email: true } },
        },
      }),
    ]);

    res.json({
      logs: logs.map((l) => ({
        id: l.id,
        action: l.action,
        reason: l.reason,
        metadata: l.metadata,
        createdAt: l.createdAt,
        admin: l.adminUser ? { id: l.adminUser.id, fullName: l.adminUser.fullName, email: l.adminUser.email } : null,
        target: l.targetUser
          ? { id: l.targetUser.id, fullName: l.targetUser.fullName, email: l.targetUser.email }
          : null,
      })),
      total,
      page,
      pageSize,
    });
  }),
);

export default router;
