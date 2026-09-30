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
  // Contribution security-buffer policy. DISABLED BY DEFAULT — until an admin
  // enables it, every contribution is 100% main contribution (zero behavior
  // change). When enabled, each verified WEEKLY contribution is split into
  // main + buffer (mode 'percent' diverts `percent`% of the paid amount;
  // mode 'flat' diverts a fixed `flatKobo`). The invariant
  // mainAmount + bufferAmount === amount is enforced by lib/bufferFund.js.
  bufferPolicy: {
    enabled: false,
    mode: 'percent',
    percent: 0,
    flatKobo: 0,
    // May the buffer fully protect a week's collector payout from a default?
    // DISABLED by default: without an approved business decision, a miss
    // simply shrinks that week's pot exactly as it does today. When enabled,
    // the buffer is advanced for the shortfall and restored on catch-up.
    protectPayouts: false,
    // Business policy knobs that are deliberately OFF until approved. When
    // `allowPartialProtection` is false an insufficient buffer produces
    // BUFFER_INSUFFICIENT and NO partial debit is written.
    allowPartialProtection: false,
    // Whether the main pot may be tapped to cover a shortfall. OFF by default
    // and, per business rules, must stay off unless explicitly approved.
    mainPotFallback: false,
    // Cycle-end buffer disposition has no approved rule yet. The balance stays
    // auditable and is transferred NOWHERE until this is resolved.
    cycleEndDisposition: 'UNRESOLVED',
  },
  // Missed-contribution / grace / default policy. DISABLED by default: with
  // this off, nothing is recorded, no default is opened and no member is ever
  // touched. `graceDays` is a value, not a hard-coded 7.
  defaultPolicy: {
    enabled: false,
    graceDays: 7,
    // Close participation once grace expires without a catch-up. Off by
    // default so no existing member is affected until approved.
    closeOnDefault: false,
    // Notify the member when a miss is detected and when grace starts.
    notifyOnMiss: true,
    notifyOnGrace: true,
  },
  // Default fine policy. DISABLED and zero-valued: the proposed ₦2,000 is NOT
  // production-approved, so it is not hard-coded anywhere. `amountKobo` is
  // only ever used when `enabled` is true.
  finePolicy: {
    enabled: false,
    amountKobo: 0,
    destination: 'unassigned', // label only; no automatic transfer is performed
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
// Deep-merges a stored policy object over the shipped defaults. A plain
// assignment would REPLACE the whole object, so any key added in a later
// release (e.g. protectPayouts on an existing bufferPolicy row) would come back
// as `undefined` instead of its safe default. Merging means existing rows
// automatically pick up new keys, and a partially-stored policy can never
// silently disable a safety default.
function mergePolicy(defaults, stored) {
  if (stored === null || typeof stored !== 'object' || Array.isArray(stored)) {
    return structuredClone(defaults);
  }
  if (defaults === null || typeof defaults !== 'object' || Array.isArray(defaults)) {
    return structuredClone(stored);
  }
  const out = structuredClone(defaults);
  for (const [k, v] of Object.entries(stored)) {
    if (v !== undefined) out[k] = typeof v === 'object' && v !== null ? mergePolicy(out[k], v) : v;
  }
  return out;
}

// Exported for tests only.
export const mergePolicyForTest = mergePolicy;

export async function getPlatformConfig() {
  const store = await loadStore();
  const config = structuredClone(PLATFORM_DEFAULTS);

  for (const [key, value] of store.entries()) {
    if (key === 'platformFeePercent') continue; // fee is env-driven, never stored
    if (value !== undefined && value !== null && Object.prototype.hasOwnProperty.call(config, key)) {
      config[key] = mergePolicy(config[key], value);
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