import { prisma } from './lib/prisma.js';
import { randomBytes } from 'node:crypto';
import bcrypt from 'bcrypt';

const CONTRIBUTION_PLANS = [
  { name: 'Starter Saver', monthlyAmount: 100000 },
  { name: 'Growth Saver', monthlyAmount: 500000 },
  { name: 'Premium Saver', monthlyAmount: 1000000 },
  { name: 'Diamond Saver', monthlyAmount: 2000000 },
];

export default async function seed() {
  for (const plan of CONTRIBUTION_PLANS) {
    await prisma.contributionPlan.upsert({
      where: { name: plan.name },
      update: { monthlyAmount: plan.monthlyAmount },
      create: plan,
    });
  }
  console.log('[seed] Contribution plans ready');

  const adminEmail = (process.env.ADMIN_EMAIL ?? 'admin@laanipay.ng').trim().toLowerCase();
  let adminPassword = process.env.ADMIN_PASSWORD;

  if (!adminPassword) {
    adminPassword = randomBytes(12).toString('base64url');
    console.log(`[seed] Generated admin password: ${adminPassword}`);
  }
  const adminName = process.env.ADMIN_NAME ?? 'LaaniPay Admin';

  const existing = await prisma.user.findUnique({ where: { email: adminEmail } });

  if (!existing) {
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
        data: { userId: user.id, action: 'ADMIN_SEEDED', metadata: {} },
      });
    });
    console.log(`[seed] Admin created: ${adminEmail}`);
  } else {
    await prisma.user.update({
      where: { id: existing.id },
      data: {
        role: 'admin',
        status: 'active',
        emailVerifiedAt: existing.emailVerifiedAt ?? new Date(),
      },
    });
    console.log(`[seed] Admin already exists: ${adminEmail}`);
  }
}
