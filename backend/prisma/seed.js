import 'dotenv/config';
import bcrypt from 'bcrypt';
import { PrismaClient } from '@prisma/client';
import { PrismaNeon } from '@prisma/adapter-neon';

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set — skipping seed.');
  process.exit(0);
}

const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

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

// Weekly AJO contribution plans (₦1,000 / ₦3,000 / ₦5,000 per week, 52-week
// cycle) — an additional frequency that coexists with the monthly model as
// separate plan rows (same names, frequency = WEEKLY).
const WEEKLY_PLANS = [
  { name: 'Starter Saver', weeklyAmount: 100000, cycleWeeks: 52 },
  { name: 'Growth Saver', weeklyAmount: 300000, cycleWeeks: 52 },
  { name: 'Premium Saver', weeklyAmount: 500000, cycleWeeks: 52 },
];

// Defaults mirror src/lib/config.js PLATFORM_DEFAULTS.
const PLATFORM_SETTINGS = [
  { key: 'registrationFeeKobo', value: 150000, description: 'One-time activation fee (kobo)' },
  { key: 'monthlySubscriptionFeeKobo', value: 30000, description: 'Monthly subscription fee (kobo)' },
  { key: 'cohortSize', value: 52, description: 'AJO cohort size (positions)' },
  { key: 'mlmLevels', value: 3, description: 'Referral reward depth' },
  {
    key: 'rewards',
    value: {
      REGISTRATION: { 1: 20000, 2: 10000, 3: 5000 },
      MONTHLY_SUBSCRIPTION: { 1: 5000, 2: 3000, 3: 2000 },
    },
    description: '3-level referral rewards (kobo, by type)',
  },
];

// NOTE: src/seed-runner.js is the boot-time seed used by the server. This file
// exists for `npx prisma db seed` / manual seeding and must stay in sync there.
//
// SAFETY: same guarantees as src/seed-runner.js —
//  - A new admin is created ONLY when ADMIN_PASSWORD is an explicit env var of
//    >= 8 characters. We never generate, log, expose or randomly fall back to a
//    password.
//  - Existing accounts are NEVER modified: password, role, status and email
//    verification are left exactly as they are.
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

async function main() {
  for (const plan of MONTHLY_PLANS) {
    await ensurePlan(plan);
    console.log(`Plan ready: ${plan.name} (₦${plan.monthlyAmount / 100}/month)`);
  }
  for (const plan of WEEKLY_PLANS) {
    await ensurePlan(plan);
    console.log(`Plan ready: ${plan.name} (₦${plan.weeklyAmount / 100}/week)`);
  }

  for (const setting of PLATFORM_SETTINGS) {
    await prisma.platformSetting.upsert({
      where: { key: setting.key },
      update: {},
      create: { key: setting.key, value: setting.value, description: setting.description },
    });
  }
  console.log('Platform settings ready');

  const adminEmail = (process.env.ADMIN_EMAIL ?? 'admin@laanipay.ng').trim().toLowerCase();
  const adminName = process.env.ADMIN_NAME ?? 'LaaniPay Admin';

  const existing = await prisma.user.findUnique({ where: { email: adminEmail } });

  if (!existing) {
    // Initial admin creation requires an explicit ADMIN_PASSWORD of >= 8 chars.
    // We never generate or print one; fail closed if the operator forgot it.
    const adminPassword = process.env.ADMIN_PASSWORD;
    if (!adminPassword || typeof adminPassword !== 'string' || adminPassword.length < 8) {
      console.error(
        'Cannot create admin account: ADMIN_PASSWORD must be set to a string of at least 8 ' +
          'characters and the account does not exist yet. No account was created and no ' +
          'password was generated or printed.',
      );
      await prisma.$disconnect();
      process.exit(1);
    }

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
        data: { userId: user.id, action: 'ADMIN_SEEDED', metadata: { source: 'manual-seed' } },
      });
      return user;
    });
    console.log(`Admin account created: ${adminEmail}`);
  } else {
    // Existing account: credentials, role and status are NEVER modified.
    console.log(`Admin account already exists — left unchanged: ${adminEmail}`);
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error('Seed failed:', err.message ?? err);
    await prisma.$disconnect();
  });