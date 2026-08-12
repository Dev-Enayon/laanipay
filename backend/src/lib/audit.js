import { prisma } from './prisma.js';

export async function logAudit({ userId, adminId, targetUserId, action, reason, metadata }) {
  try {
    await prisma.auditLog.create({
      data: {
        userId: userId ?? null,
        adminId: adminId ?? null,
        targetUserId: targetUserId ?? null,
        action,
        reason: reason ?? null,
        metadata: metadata ?? {},
      },
    });
  } catch (err) {
    console.error('[audit] failed to write audit log:', err.message);
  }
}
