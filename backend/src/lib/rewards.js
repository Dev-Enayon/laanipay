// Reward & split math — PURE functions with no I/O. These are the single source
// of truth for how every money flow is divided, and they are unit-tested.
// All monetary values are integer kobo. A reward allocation never exceeds its
// source amount; the remainder is implicitly company/platform revenue.

import { PLATFORM_DEFAULTS } from './config.js';

const DEFAULT_REWARDS = PLATFORM_DEFAULTS.rewards;
const NEEDED_LEVELS = [1, 2, 3];

// Returns a normalized 3-level reward map for a given payment type, clamped to
// non-negative integers. Falls back to defaults for any missing level.
export function levelRewards(type, rewards = DEFAULT_REWARDS) {
  const source = rewards?.[type] && typeof rewards[type] === 'object' ? rewards[type] : {};
  const fallback = DEFAULT_REWARDS[type] ?? {};
  const out = {};
  for (const level of NEEDED_LEVELS) {
    const n = source[level] ?? fallback[level];
    out[level] = Math.max(0, Math.round(Number(n) || 0));
  }
  return out;
}

// 3-level referral split of a single collected fee.
// Returns the per-level rewards, their total, and what is left as company
// revenue. Guards: totalRewards never exceeds feeKobo.
export function splitReferralFee({ feeKobo, type = 'REGISTRATION', rewards }) {
  const byLevel = levelRewards(type, rewards);
  let totalRewards = 0;
  for (const level of NEEDED_LEVELS) {
    if (byLevel[level] > feeKobo - totalRewards) byLevel[level] = feeKobo - totalRewards;
    totalRewards += byLevel[level];
  }
  return {
    byLevel,
    totalRewards,
    companyShare: feeKobo - totalRewards,
  };
}

// Weekly pot split: contributions collected into a pot for one payout week.
// gross = weeklyAmount x paidCount; platform fee = gross x feePercent.
export function weeklyPotSplit(weeklyAmount, paidCount, feePercent = 2) {
  const gw = Math.max(0, Math.round(Number(weeklyAmount) || 0));
  const count = Math.max(0, Math.round(Number(paidCount) || 0));
  const pct = Math.min(100, Math.max(0, Number(feePercent) || 0));

  const gross = gw * count;
  const platformFee = Math.round((gross * pct) / 100);
  const net = gross - platformFee;
  return { gross, platformFee, net };
}

// Expected payout for a collector when the cohort pays in full (cycleWeeks
// members each contributing weeklyAmount).
export function expectedPayout(weeklyAmount, cycleWeeks, feePercent = 2) {
  return weeklyPotSplit(weeklyAmount, cycleWeeks, feePercent);
}

// Reward totals by level for a given payment type (used for UI display).
export function rewardLadder(type, rewards = DEFAULT_REWARDS) {
  return levelRewards(type, rewards);
}