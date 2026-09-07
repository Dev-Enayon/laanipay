import { prisma } from './lib/prisma.js';
import bcrypt from 'bcrypt';
import { PLATFORM_DEFAULTS } from './lib/config.js';

// Weekly AJO contribution plans (₦1,000 / ₦3,000 / ₦5,000 per week, 52-week cycle).
const CONTRIBUTION_PLANS = [
  { name: 'Starter Saver', weeklyAmount: 100000, cycleWeeks: 52 },
  { name: 'Growth Saver', weeklyAmount: 300000, cycleWeeks: 52 },
  { name: 'Premium Saver', weeklyAmount: 500000, cycleWeeks: 52 },
];

const PLATFORM_SETTINGS = [
  { key: 'registrationFeeKobo', value: PLATFORM_DEFAULTS.registrationFeeKobo, description: 'One-time activation fee (kobo)' },
  {
    key: 'monthlySubscriptionFeeKobo',
    value: PLATFORM_DEFAULTS.monthlySubscriptionFeeKobo,
    description: 'Monthly subscription fee (kobo)',
  },
  { key: 'cohortSize', value: PLATFORM_DEFAULTS.cohortSize, description: 'AJO cohort size (positions)' },
  { key: 'mlmLevels', value: PLATFORM_DEFAULTS.mlmLevels, description: 'Referral reward depth' },
  { key: 'rewards', value: PLATFORM_DEFAULTS.rewards, description: '3-level referral rewards (kobo, by type)' },
];

export default async function seed() {
  // Legacy 4-plan monthly model is superseded by the weekly model. Remove the
  // legacy plan only if it has no active subscription (protect existing data).
  try {
    await prisma.contributionPlan.deleteMany({
      where: { name: 'Diamond Saver', subscriptions: { none: {} } },
    });
  } catch (err) {
    console.warn('[seed] could not remove legacy plan:', err?.message ?? err);
  }

  for (const plan of CONTRIBUTION_PLANS) {
    await prisma.contributionPlan.upsert({
      where: { name: plan.name },
      update: {
        weeklyAmount: plan.weeklyAmount,
        monthlyAmount: plan.weeklyAmount, // legacy column kept in sync for old UIs
        cycleWeeks: plan.cycleWeeks,
      },
      create: {
        name: plan.name,
        weeklyAmount: plan.weeklyAmount,
        monthlyAmount: plan.weeklyAmount,
        cycleWeeks: plan.cycleWeeks,
      },
    });
  }
  console.log('[seed] Weekly contribution plans ready');

  // Runtime config defaults. `update: {}` keeps any admin-tuned values intact.
  for (const setting of PLATFORM_SETTINGS) {
    await prisma.platformSetting.upsert({
      where: { key: setting.key },
      update: {},
      create: { key: setting.key, value: setting.value, description: setting.description },
    });
  }
  console.log('[seed] Platform settings ready');

  const adminEmail = (process.env.ADMIN_EMAIL ?? 'admin@laanipay.ng').trim().toLowerCase();

  const existing = await prisma.user.findUnique({ where: { email: adminEmail } });

  if (!existing) {
    // Initial admin creation requires an explicit ADMIN_PASSWORD in every
    // environment. We never generate, log, or otherwise expose a password.
    // If the operator forgot to set it, we fail closed instead of creating an
    // admin whose credentials we cannot hand over.
    const adminPassword = process.env.ADMIN_PASSWORD;
    if (!adminPassword) {
      console.error(
        '[seed] Cannot create admin account: ADMIN_PASSWORD is not set and the admin account does not exist yet. ' +
          'Set ADMIN_PASSWORD in the environment and restart. No account was created and no password was generated or printed.',
      );
      return;
    }
    if (typeof adminPassword !== 'string' || adminPassword.length < 8) {
      console.error('[seed] ADMIN_PASSWORD must be a string of at least 8 characters. Aborting admin creation.');
      return;
    }

    const adminName = process.env.ADMIN_NAME ?? 'LaaniPay Admin';
    const passwordHash = await bcrypt.hash(adminPassword, 10);

    await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          fullName: adminName,
          email: adminEmail,
          phone: '+2340000000000',
          passwordHash,
          activationStatus: true,
          emailVerifiedAt: new Date(),
          role: 'admin',
          status: 'active',
        },
      });
      await tx.wallet.create({ data: { userId: user.id } });
      await tx.mlmRank.create({ data: { userId: user.id, rank: 'marketer' } });
      await tx.auditLog.create({
        data: { userId: user.id, action: 'ADMIN_SEEDED', metadata: { source: 'seed', email: adminEmail } },
      });
    });
    console.log(`[seed] Admin created: ${adminEmail}`);
  } else {
    // Existing account: credentials and role are NEVER modified by the seed.
    // Password rotation and role changes are explicit, audited admin actions.
    if (process.env.ADMIN_PASSWORD) {
      console.log('[seed] Admin account already exists — password left unchanged (ADMIN_PASSWORD ignored for existing accounts).');
    }
    console.log(`[seed] Admin account present: ${adminEmail}`);
  }
}