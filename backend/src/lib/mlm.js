// MLM compensation model — single source of truth for the earning rules.
// All monetary values are in kobo.

export const MLM_LEVELS = 3;

// 3-level referral rewards on a new registration (₦200 / ₦100 / ₦50).
// The remainder of the ₦1500 activation fee is platform revenue.
export const BASIC_BONUS_BY_LEVEL = { 1: 20000, 2: 10000, 3: 5000 };

// 3-level rewards on the monthly ₦300 subscription (₦50 / ₦30 / ₦20).
export const MONTHLY_BONUS_BY_LEVEL = { 1: 5000, 2: 3000, 3: 2000 };

export const RANKS = [
  { key: 'marketer', label: 'Marketer', minDirect: 1 },
  { key: 'manager', label: 'Manager', minDirect: 5 },
  { key: 'director', label: 'Director', minDirect: 15 },
  { key: 'ruby_director', label: 'Ruby Director', minDirect: 30 },
  { key: 'diamond_director', label: 'Diamond Director', minDirect: 50 },
];

export function rankFromDirectCount(count) {
  let current = RANKS[0];
  for (const rank of RANKS) {
    if (count >= rank.minDirect) current = rank;
    else break;
  }
  return current;
}

export function bonusForLevel(level) {
  return BASIC_BONUS_BY_LEVEL[level] ?? 0;
}

async function monthlyRewardForLevel(level, tx) {
  const { getPlatformConfig } = await import('./config.js');
  const config = await getPlatformConfig();
  const rewards = config.rewards?.MONTHLY_SUBSCRIPTION;
  return Math.max(0, Math.round(Number(rewards?.[level] ?? MONTHLY_BONUS_BY_LEVEL[level]) || 0));
}

// Walks the activation tree of a user, returning activated, non-suspended
// uplines up to MLM_LEVELS deep as [{ userId, level, user }].
async function walkUplines(tx, userId) {
  const placement = await tx.mlmReferral.findFirst({
    where: { userId, level: 1 },
  });
  if (!placement?.referrerId) return [];

  let uplineId = placement.referrerId;
  let level = 1;
  const uplines = [];

  while (uplineId && level <= MLM_LEVELS) {
    const upline = await tx.user.findUnique({ where: { id: uplineId } });
    if (upline?.activationStatus && upline.status !== 'suspended') {
      uplines.push({ userId: upline.id, level, user: upline });
    }
    const next = await tx.mlmReferral.findFirst({ where: { userId: uplineId, level: 1 } });
    uplineId = next?.referrerId ?? null;
    level += 1;
  }

  return uplines;
}

// Credits one reward: writes the ReferralReward ledger row (unique reference =
// impossible to double-credit) and increments the recipient's wallet. All
// inside the caller's transaction.
//
// Defense-in-depth: the wallet is only credited when THIS call newly claimed
// the reward row. If the row already exists (webhook retry, scheduler re-run,
// concurrent call), the wallet is NOT credited again and the existing reward
// state is returned instead. The unique `reference` constraint remains the
// ultimate protection; this check makes the code robust even outside it.
async function creditReward({ tx, type, recipientUserId, sourceUserId, level, amountKobo, reference, description }) {
  if (amountKobo <= 0) return null;

  let created = false;
  try {
    await tx.referralReward.create({
      data: {
        type,
        userId: recipientUserId,
        sourceUserId,
        level,
        amountKobo,
        reference,
        status: 'earned',
      },
    });
    created = true;
  } catch (err) {
    const isUniqueViolation =
      err?.code === 'P2002' || /duplicate key|unique constraint/i.test(`${err?.message ?? ''}`);
    if (!isUniqueViolation) throw err;
    // The reward was already claimed — do not credit the wallet again.
    const existing = await tx.referralReward.findUnique({ where: { reference } });
    return existing
      ? { userId: recipientUserId, amountKobo: existing.amountKobo, level, already: true }
      : null;
  }

  if (!created) return null;

  const wallet = await tx.wallet.update({
    where: { userId: recipientUserId },
    data: { balance: { increment: amountKobo } },
  });

  await tx.walletTransaction.create({
    data: {
      userId: recipientUserId,
      type: 'bonus',
      amount: amountKobo,
      balanceAfter: wallet.balance,
      status: 'completed',
      description,
      metadata: { level, rewardType: type, sourceUserId },
    },
  });

  return { userId: recipientUserId, amountKobo, level };
}

// Credits the 3-level referral rewards for a new registration and records the
// rank for the direct sponsor. Returns { credited, rankChanges }.
export async function creditActivationBonuses(activatedUserId, tx) {
  const uplines = await walkUplines(tx, activatedUserId);
  const credited = [];
  const rankChanges = [];

  for (const { userId, level, user } of uplines) {
    const bonus = bonusForLevel(level);
    if (bonus > 0) {
      await tx.mlmReferral.upsert({
        where: {
          userId_referrerId_level: { userId: activatedUserId, referrerId: userId, level },
        },
        update: { bonusEarned: bonus },
        create: {
          userId: activatedUserId,
          referrerId: userId,
          level,
          bonusEarned: bonus,
        },
      });

      await creditReward({
        tx,
        type: 'REGISTRATION',
        recipientUserId: userId,
        sourceUserId: activatedUserId,
        level,
        amountKobo: bonus,
        reference: `REG:${activatedUserId}:L${level}`,
        description: `Level ${level} registration reward`,
      }).then((reward) => {
        if (reward && !reward.already) {
          credited.push({
            userId,
            email: user.email,
            name: user.fullName,
            level,
            bonus,
          });
        }
      });
    }

    if (level === 1) {
      const rankResult = await recordRankFor(tx, userId);
      if (rankResult.changed) {
        rankChanges.push({
          userId,
          email: user.email,
          name: user.fullName,
          rank: rankResult.rank.key,
        });
      }
    }
  }

  return { credited, rankChanges };
}

// Credits the 3-level referral rewards for a monthly subscription payment
// (type MONTHLY_SUBSCRIPTION). Rewards are config-driven (or pass a pre-capped
// `rewardsByLevel` map so the sum can never exceed the collected fee).
// Idempotent per (billingMonth, payer, level) via the unique ledger reference.
export async function creditSubscriptionRewards({ tx, payerUserId, billingMonth, rewardsByLevel = null }) {
  const uplines = await walkUplines(tx, payerUserId);
  const credited = [];

  for (const { userId, level, user } of uplines) {
    const bonus =
      rewardsByLevel?.[level] != null
        ? Number(rewardsByLevel[level]) || 0
        : await monthlyRewardForLevel(level, tx);
    if (bonus > 0) {
      const reward = await creditReward({
        tx,
        type: 'MONTHLY_SUBSCRIPTION',
        recipientUserId: userId,
        sourceUserId: payerUserId,
        level,
        amountKobo: bonus,
        reference: `SUB:${billingMonth}:${payerUserId}:L${level}`,
        description: `Level ${level} monthly subscription reward (${billingMonth})`,
      });
      if (reward && !reward.already) {
        credited.push({ userId, email: user.email, name: user.fullName, level, bonus });
      }
    }
  }

  return { credited };
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