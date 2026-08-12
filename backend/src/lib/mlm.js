// MLM compensation model — single source of truth for the earning rules.
// All monetary values are in kobo.

export const MLM_LEVELS = 3;

// Basic plan ladder (kobo), per level of the activation tree.
export const BASIC_BONUS_BY_LEVEL = { 1: 50000, 2: 20000, 3: 10000 };

// Pro plan (unlocked at Director rank) pays a 30% boost on the Basic ladder.
export const PRO_BOOST_MULTIPLIER = 1.3;

export const RANKS = [
  { key: 'marketer', label: 'Marketer', minDirect: 1 },
  { key: 'manager', label: 'Manager', minDirect: 5 },
  { key: 'director', label: 'Director', minDirect: 15 },
  { key: 'ruby_director', label: 'Ruby Director', minDirect: 30 },
  { key: 'diamond_director', label: 'Diamond Director', minDirect: 50 },
];

const DIRECTOR_INDEX = RANKS.findIndex((rank) => rank.key === 'director');

export function rankFromDirectCount(count) {
  let current = RANKS[0];
  for (const rank of RANKS) {
    if (count >= rank.minDirect) current = rank;
    else break;
  }
  return current;
}

export function bonusForLevel(level, isPro = false) {
  const base = BASIC_BONUS_BY_LEVEL[level] ?? 0;
  if (!base) return 0;
  if (!isPro) return base;
  return Math.round(base * PRO_BOOST_MULTIPLIER);
}

// Walks the activation tree from a newly-activated user, crediting each
// activated upline (up to MLM_LEVELS deep) with the level bonus and
// recording the earned row in mlm_referrals.
// `tx` is a Prisma transaction client.
// Returns { credited, rankChanges } where each entry carries the recipient
// email/name so the caller can fire notification emails after commit.
export async function creditActivationBonuses(activatedUserId, tx) {
  const placement = await tx.mlmReferral.findFirst({
    where: { userId: activatedUserId, level: 1 },
    include: { referrer: true },
  });

  if (!placement?.referrerId) return { credited: [], rankChanges: [] };

  let uplineId = placement.referrerId;
  let level = 1;
  let credited = [];
  let rankChanges = [];

  while (uplineId && level <= MLM_LEVELS) {
    const upline = await tx.user.findUnique({ where: { id: uplineId } });

    if (upline?.activationStatus) {
      const directCount = await tx.mlmReferral.count({
        where: { referrerId: upline.id, level: 1, user: { activationStatus: true } },
      });
      const currentRank = rankFromDirectCount(directCount);
      const isPro = RANKS.indexOf(currentRank) >= DIRECTOR_INDEX;
      const bonus = bonusForLevel(level, isPro);

      if (bonus > 0) {
        await tx.mlmReferral.upsert({
          where: {
            userId_referrerId_level: { userId: activatedUserId, referrerId: upline.id, level },
          },
          update: { bonusEarned: bonus },
          create: {
            userId: activatedUserId,
            referrerId: upline.id,
            level,
            bonusEarned: bonus,
          },
        });
        await tx.wallet.update({
          where: { userId: upline.id },
          data: { balance: { increment: bonus } },
        });
        const walletAfter = await tx.wallet.findUnique({
          where: { userId: upline.id },
          select: { balance: true },
        });
        await tx.walletTransaction.create({
          data: {
            userId: upline.id,
            type: 'bonus',
            amount: bonus,
            balanceAfter: walletAfter?.balance ?? bonus,
            status: 'completed',
            description: `Level ${level} referral bonus`,
            metadata: { sourceUserId: activatedUserId, level },
          },
        });
        credited.push({
          userId: upline.id,
          email: upline.email,
          name: upline.fullName,
          level,
          bonus,
        });
      }

      if (level === 1) {
        const rankResult = await recordRankFor(tx, upline.id);
        if (rankResult.changed) {
          rankChanges.push({
            userId: upline.id,
            email: upline.email,
            name: upline.fullName,
            rank: rankResult.rank.key,
          });
        }
      }
    }

    const next = await tx.mlmReferral.findFirst({
      where: { userId: uplineId, level: 1 },
    });
    uplineId = next?.referrerId ?? null;
    level += 1;
  }

  return { credited, rankChanges };
}

export async function recordRankFor(tx, userId) {
  const directCount = await tx.mlmReferral.count({
    where: { referrerId: userId, level: 1, user: { activationStatus: true } },
  });
  const rank = rankFromDirectCount(directCount);

  const latest = await tx.mlmRank.findFirst({
    where: { userId },
    orderBy: { achievedAt: 'desc' },
  });

  let changed = false;
  if (!latest || RANKS.findIndex((r) => r.key === rank.key) > RANKS.findIndex((r) => r.key === latest.rank)) {
    await tx.mlmRank.create({ data: { userId, rank: rank.key } });
    changed = true;
  }

  return { rank, changed };
}
