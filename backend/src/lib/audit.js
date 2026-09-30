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

// Transactional audit for FINANCIAL events. Unlike logAudit this THROWS on
// failure: a buffer debit, fine, default, recovery or death transition must
// never commit without its audit trail, because the audit row and the money
// movement are supposed to be atomic. Must be called inside the caller's
// Prisma transaction (pass its `tx`) so a rollback takes the log with it.
export async function logAuditTx({ tx, userId, adminId, targetUserId, action, reason, metadata }) {
  if (!tx) throw new Error('logAuditTx requires a transaction client');
  return tx.auditLog.create({
    data: {
      userId: userId ?? null,
      adminId: adminId ?? null,
      targetUserId: targetUserId ?? null,
      action,
      reason: reason ?? null,
      metadata: metadata ?? {},
    },
  });
}
