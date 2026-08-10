import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { AppError, asyncHandler } from '../middleware/error.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

router.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const wallet = await prisma.wallet.findUnique({ where: { userId: req.userId } });
    if (!wallet) {
      throw new AppError('Wallet not found', 404);
    }
    res.json({ balance: wallet.balance });
  }),
);

export default router;
