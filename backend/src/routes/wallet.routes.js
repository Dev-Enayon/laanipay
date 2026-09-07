import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { AppError, asyncHandler } from '../middleware/error.js';
import { requireAuth } from '../middleware/auth.js';
import { requestWithdrawal } from '../lib/withdrawals.js';

const router = Router();

router.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const wallet = await prisma.wallet.findUnique({ where: { userId: req.userId } });
    if (!wallet) {
      throw new AppError('Wallet not found', 404);
    }
    res.json({
      balance: wallet.balance,
      heldBalance: wallet.heldBalance,
      totalContributed: wallet.totalContributed,
    });
  }),
);

// User withdrawal requests (funds are reserved pending admin/provider settlement).
router.post(
  '/withdrawals',
  requireAuth,
  asyncHandler(async (req, res) => {
    const withdrawal = await requestWithdrawal({
      userId: req.userId,
      amountKobo: req.body?.amountKobo,
      bank: req.body?.bank,
    });
    res.status(201).json({ withdrawal });
  }),
);

router.get(
  '/withdrawals',
  requireAuth,
  asyncHandler(async (req, res) => {
    const withdrawals = await prisma.withdrawal.findMany({
      where: { userId: req.userId },
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(Number(req.query.limit) || 20, 1), 100),
    });
    res.json({ withdrawals });
  }),
);

export default router;