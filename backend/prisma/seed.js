import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import bcrypt from 'bcrypt';
import { PrismaClient } from '@prisma/client';

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set — cannot run seed.');
  process.exit(1);
}

const prisma = new PrismaClient();

const CONTRIBUTION_PLANS = [
  { name: 'Starter Saver', monthlyAmount: 100000 },
  { name: 'Growth Saver', monthlyAmount: 500000 },
  { name: 'Premium Saver', monthlyAmount: 1000000 },
  { name: 'Diamond Saver', monthlyAmount: 2000000 },
];

async function main() {
  for (const plan of CONTRIBUTION_PLANS) {
    await prisma.contributionPlan.upsert({
      where: { name: plan.name },
      update: { monthlyAmount: plan.monthlyAmount },
      create: plan,
    });
    console.log(`Plan ready: ${plan.name} (₦${plan.monthlyAmount / 100})`);
  }

  const adminEmail = (process.env.ADMIN_EMAIL ?? 'admin@laanipay.ng').trim().toLowerCase();
  let adminPassword = process.env.ADMIN_PASSWORD;

  if (!adminPassword) {
    adminPassword = randomBytes(12).toString('base64url');
    console.log(
      `ADMIN_PASSWORD was not set — generated: ${adminPassword} (set ADMIN_PASSWORD to choose your own)`,
    );
  }
  const adminName = process.env.ADMIN_NAME ?? 'LaaniPay Admin';

  const existing = await prisma.user.findUnique({ where: { email: adminEmail } });

  let admin = null;
  if (!existing) {
    const passwordHash = await bcrypt.hash(adminPassword, 10);
    admin = await prisma.$transaction(async (tx) => {
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
        data: { userId: user.id, action: 'ADMIN_SEEDED', metadata: {} },
      });
      return user;
    });
    console.log(`Admin account ready: ${admin.email} (activation: true)`);
  } else {
    await prisma.user.update({
      where: { id: existing.id },
      data: {
        role: 'admin',
        status: 'active',
        emailVerifiedAt: existing.emailVerifiedAt ?? new Date(),
      },
    });
    console.log(`Admin account already exists: ${existing.email}`);
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error('Seed failed:', err);
    await prisma.$disconnect();
    process.exit(1);
  });
