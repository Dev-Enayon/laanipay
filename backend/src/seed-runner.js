import { prisma } from './lib/prisma.js';
import bcrypt from 'bcrypt';
import { PLATFORM_DEFAULTS } from './lib/config.js';

// Monthly contribution plans — the original product model. These five tiers
// are the single source of truth for the available monthly amounts. Existing
// monthly plans are UPDATED to their tier (deliberate product decision, not a
// blanket overwrite); existing subscriptions are protected by their
// amountKobo snapshot, so changing the tier never changes what a current
// subscriber pays. Weekly plans are never touched by the monthly tiers.
const MONTHLY_PLANS = [
  { name: 'Starter Saver', monthlyAmount: 1000000 },
  { name: 'Growth Saver', monthlyAmount: 1500000 },
  { name: 'Premium Saver', monthlyAmount: 2000000 },
  { name: 'Diamond Saver', monthlyAmount: 2500000 },
  { name: 'Elite Saver', monthlyAmount: 3000000 },
];

// Weekly AJO contribution plans — an additional frequency that coexists with
// the monthly model as separate plan rows (same names, frequency = WEEKLY).
const WEEKLY_PLANS = [
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

async function ensurePlan(plan) {
  // Keyed on (name, frequency): the identical monthly and weekly names are
  // distinct rows. The update payload ONLY carries the amount that belongs to
  // this plan's frequency:
  //   * MONTHLY plans are the product-defined tiers and are maintained to those
  //     exact amounts (existing subscriptions are protected by their amountKobo
  //     snapshot, which this never touches).
  //   * WEEKLY plans use `update: {}` so their amounts (and any admin-tuned
  //     weekly rates) are NEVER overwritten by the seed.
  const frequency = plan.monthlyAmount !== undefined ? 'MONTHLY' : 'WEEKLY';
  const data = { name: plan.name, frequency };
  const update = {};
  if (plan.monthlyAmount !== undefined) {
    data.monthlyAmount = plan.monthlyAmount;
    update.monthlyAmount = plan.monthlyAmount;
  }
  if (plan.weeklyAmount !== undefined) data.weeklyAmount = plan.weeklyAmount;
  if (plan.cycleWeeks !== undefined) data.cycleWeeks = plan.cycleWeeks;
  await prisma.contributionPlan.upsert({
    where: { name_frequency: { name: plan.name, frequency } },
    update,
    create: data,
  });
}

export default async function seed() {
  for (const plan of MONTHLY_PLANS) {
    await ensurePlan(plan);
  }
  for (const plan of WEEKLY_PLANS) {
    await ensurePlan(plan);
  }
  console.log('[seed] Monthly and weekly contribution plans ready');

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