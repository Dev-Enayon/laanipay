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

// Weekly AJO contribution plans (₦1,000 / ₦3,000 / ₦5,000 per week, 52-week cycle).
const CONTRIBUTION_PLANS = [
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
async function main() {
  try {
    await prisma.contributionPlan.deleteMany({
      where: { name: 'Diamond Saver', subscriptions: { none: {} } },
    });
  } catch (err) {
    console.warn('Could not remove legacy plan:', err?.message ?? err);
  }

  for (const plan of CONTRIBUTION_PLANS) {
    await prisma.contributionPlan.upsert({
      where: { name: plan.name },
      update: {
        weeklyAmount: plan.weeklyAmount,
        monthlyAmount: plan.weeklyAmount,
        cycleWeeks: plan.cycleWeeks,
      },
      create: {
        name: plan.name,
        weeklyAmount: plan.weeklyAmount,
        monthlyAmount: plan.weeklyAmount,
        cycleWeeks: plan.cycleWeeks,
      },
    });
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