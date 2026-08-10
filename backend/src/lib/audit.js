import { prisma } from './prisma.js';

export async function logAudit({ userId, action, metadata }) {
  try {
    await prisma.auditLog.create({
      data: { userId: userId ?? null, action, metadata: metadata ?? {} },
    });
  } catch (err) {
    console.error('[audit] failed to write audit log:', err.message);
  }
}
