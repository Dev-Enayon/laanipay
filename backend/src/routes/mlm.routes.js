import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { RANKS, rankFromDirectCount } from '../lib/mlm.js';
import { asyncHandler } from '../middleware/error.js';
import { requireAuth, requireActivated } from '../middleware/auth.js';

const router = Router();

router.get(
  '/overview',
  requireAuth,
  requireActivated,
  asyncHandler(async (req, res) => {
    const [downlineRows, wallet, latestRank, ranks] = await Promise.all([
      prisma.mlmReferral.findMany({
        where: { referrerId: req.userId },
        include: {
          user: {
            select: {
              id: true,
              fullName: true,
              email: true,
              activationStatus: true,
              createdAt: true,
            },
          },
        },
        orderBy: [{ level: 'asc' }, { createdAt: 'desc' }],
      }),
      prisma.wallet.findUnique({ where: { userId: req.userId } }),
      prisma.mlmRank.findFirst({
        where: { userId: req.userId },
        orderBy: { achievedAt: 'desc' },
      }),
      prisma.mlmRank.findMany({
        where: { userId: req.userId },
        orderBy: { achievedAt: 'asc' },
      }),
    ]);

    const directRows = downlineRows.filter((row) => row.level === 1);
    const directActivated = directRows.filter((row) => row.user.activationStatus);
    const directCount = directActivated.length;
    const totalDownline = new Set(downlineRows.map((row) => row.user.id)).size;
    const totalBonusEarned = downlineRows.reduce((sum, row) => sum + row.bonusEarned, 0);

    const currentRank = rankFromDirectCount(directCount);

    const downline = Array.from(
      downlineRows
        .reduce((map, row) => {
          const entry = map.get(row.user.id);
          const user = {
            id: row.user.id,
            fullName: row.user.fullName,
            email: row.user.email,
            activationStatus: row.user.activationStatus,
            joinedAt: row.user.createdAt,
          };
          if (!entry) {
            map.set(row.user.id, { ...user, level: row.level, bonusEarned: row.bonusEarned });
          }
          return map;
        }, new Map())
        .values(),
    );

    res.json({
      referralCode: req.user.referralCode,
      directCount,
      totalDownline,
      totalBonusEarned,
      walletBalance: wallet?.balance ?? 0,
      currentRank: currentRank.key,
      rankAchievedAt: latestRank?.achievedAt ?? null,
      ranks: ranks.map((rank) => ({ rank: rank.rank, achievedAt: rank.achievedAt })),
      downline,
      rankLadder: RANKS,
    });
  }),
);

router.get(
  '/plans',
  asyncHandler(async (req, res) => {
    res.json({ ranks: RANKS });
  }),
);

export default router;
