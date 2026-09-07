// Platform configuration — admin-editable runtime settings backed by the
// platform_settings table, with hard-coded defaults as fallback. Financial
// rules (fees, rewards, cohort size) are read from here so they can be tuned
// without a deploy.
//
// Environment overrides: WEEKLY_PLATFORM_FEE_PERCENTAGE (0–100) overrides the
// stored platform fee for the weekly pot. All monetary values are in kobo.

import { prisma } from './prisma.js';

export const PLATFORM_DEFAULTS = {
  // One-time activation fee (kobo). DB-authoritative; env.activationFeeKobo is
  // the fallback default.
  registrationFeeKobo: 150000,
  // Monthly subscription fee (kobo), deducted from the wallet by the
  // service-charge job. DB-authoritative; env.serviceChargeKobo is fallback.
  monthlySubscriptionFeeKobo: 30000,
  // Weekly AJO cohort dimension.
  cohortSize: 52,
  // Maximum number of referrals a user may sponsor directly (3-level payout).
  mlmLevels: 3,
  // Reward rules per payment type, keyed by tree level (1 = direct).
  rewards: {
    REGISTRATION: { 1: 20000, 2: 10000, 3: 5000 },
    MONTHLY_SUBSCRIPTION: { 1: 5000, 2: 3000, 3: 2000 },
  },
};

// The platform fee is env-configurable and read fresh on every payout.
export function platformFeePercent() {
  const raw = Number(process.env.WEEKLY_PLATFORM_FEE_PERCENTAGE);
  if (Number.isFinite(raw)) {
    return Math.min(100, Math.max(0, raw));
  }
  return 2; // default 2%
}

async function loadStore() {
  const rows = await prisma.platformSetting.findMany();
  return new Map(rows.map((r) => [r.key, r.value]));
}

// Reads the full effective config, merging DB overrides over defaults.
// Values are JSON scalars (numbers/objects/arrays). Callers should treat the
// result as the source of truth for financial rules.
export async function getPlatformConfig() {
  const store = await loadStore();
  const config = structuredClone(PLATFORM_DEFAULTS);

  for (const [key, value] of store.entries()) {
    if (key === 'platformFeePercent') continue; // fee is env-driven, never stored
    if (value !== undefined && value !== null && Object.prototype.hasOwnProperty.call(config, key)) {
      config[key] = value;
    }
  }

  config.platformFeePercent = platformFeePercent();
  return config;
}

// Convenience: read a single setting key with its default fallback.
export async function getPlatformSetting(key) {
  const config = await getPlatformConfig();
  return config[key];
}

// Upsert a single setting. `nValue` may be any JSON-serializable value.
export async function setPlatformSetting(key, nValue, description = null) {
  await prisma.platformSetting.upsert({
    where: { key },
    update: { value: nValue, description },
    create: { key, value: nValue, description },
  });
  return getPlatformSetting(key);
}