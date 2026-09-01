// Admin notification / messaging core.
//
// Foundation-only in-app messaging: notifications are written to the DB and read
// inside the app. Push delivery is intentionally NOT wired (no Firebase/APNs in
// the project). The `pushStatus` field on each notification is recorded
// (`not_configured`) so a provider (FCM/APNs) can be added later without
// redesigning the model or the send pipeline.

import cron from 'node-cron';
import { prisma } from './prisma.js';

export const NOTIFICATION_CATEGORIES = ['announcement', 'system', 'reminder', 'promotion', 'alert'];

// Eligible recipients: platform users who are not suspended.
// Broadcasts are delivered to active accounts only.
async function buildRecipientIds({ scope, role = null, userIds = [] }) {
  const base = { status: { not: 'suspended' } };

  if (scope === 'all') {
    const rows = await prisma.user.findMany({ where: base, select: { id: true } });
    return rows.map((r) => r.id);
  }

  if (scope === 'role') {
    const validRole = role === 'admin' ? 'admin' : 'user';
    const rows = await prisma.user.findMany({ where: { ...base, role: validRole }, select: { id: true } });
    return rows.map((r) => r.id);
  }

  // scope === 'selected' | 'specific'
  const ids = [...new Set((userIds ?? []).filter((id) => typeof id === 'string' && id))];
  if (ids.length === 0) return [];
  const rows = await prisma.user.findMany({ where: { ...base, id: { in: ids } }, select: { id: true } });
  const found = new Set(rows.map((r) => r.id));
  return ids.filter((id) => found.has(id));
}

export async function resolveRecipientCount({ scope, role = null, userIds = [] }) {
  const ids = await buildRecipientIds({ scope, role, userIds });
  return ids.length;
}

// Create receipts for a sent broadcast (idempotent at the DB level via the
// unique (notificationId, userId) constraint).
async function materializeReceipts(notificationId, userIds) {
  if (userIds.length === 0) return 0;
  const rows = userIds.map((userId) => ({
    notificationId,
    userId,
    deliveredAt: new Date(),
  }));
  await prisma.notificationReceipt.createMany({ data: rows, skipDuplicates: true });
  return userIds.length;
}

/**
 * Create an admin notification.
 * - scheduleAt in the future  -> status 'scheduled'; receipts are created when
 *   processScheduledNotifications() fires (cron + lazy on API access).
 * - otherwise                 -> sent immediately; receipts are created now.
 *
 * Returns the created notification + the number of intended recipients.
 */
export async function createNotification({
  title,
  message,
  category,
  type = 'info',
  senderId,
  scope,
  role = null,
  userIds = [],
  scheduleAt = null,
  recipientCount = null,
}) {
  const recipients = await buildRecipientIds({ scope, role, userIds });
  const now = new Date();
  const isScheduled = !!scheduleAt && new Date(scheduleAt).getTime() > now.getTime();

  const notification = await prisma.notification.create({
    data: {
      title,
      body: message,
      type,
      category,
      senderId,
      recipientType: scope,
      recipientIds: scope === 'selected' ? recipients : undefined,
      recipientRole: scope === 'role' ? role : undefined,
      recipientCount: recipientCount ?? recipients.length,
      status: isScheduled ? 'scheduled' : 'sent',
      scheduledAt: isScheduled ? new Date(scheduleAt) : undefined,
      sentAt: isScheduled ? undefined : now,
      pushStatus: 'not_configured',
    },
  });

  if (!isScheduled) {
    await materializeReceipts(notification.id, recipients);
  }

  return {
    id: notification.id,
    status: notification.status,
    scheduledAt: notification.scheduledAt,
    sentAt: notification.sentAt,
    recipientCount: recipients.length,
  };
}

/**
 * Fire any scheduled notifications whose time has come.
 * Safe to call repeatedly and from multiple processes: each notification is
 * claimed atomically (scheduled -> sending), receipts are inserted with
 * skipDuplicates, then it is marked sent. Failures are recorded as 'failed'.
 * Returns a summary of processed/errored notifications.
 */
export async function processScheduledNotifications() {
  const now = new Date();
  const due = await prisma.notification.findMany({
    where: { status: 'scheduled', scheduledAt: { lte: now } },
    select: { id: true, recipientType: true, recipientRole: true, recipientIds: true },
  });

  let processed = 0;
  let errored = 0;

  for (const n of due) {
    const claimed = await prisma.notification.updateMany({
      where: { id: n.id, status: 'scheduled' },
      data: { status: 'sending' },
    });
    if (claimed.count !== 1) continue; // another process picked it up

    try {
      const recipients = await buildRecipientIds({
        scope: n.recipientType,
        role: n.recipientRole,
        userIds: Array.isArray(n.recipientIds) ? n.recipientIds : [],
      });
      await materializeReceipts(n.id, recipients);
      await prisma.notification.update({
        where: { id: n.id },
        data: { status: 'sent', sentAt: new Date(), recipientCount: recipients.length },
      });
      processed += 1;
    } catch (err) {
      console.error('[notifications] scheduled send failed for', n.id, err?.message ?? err);
      await prisma.notification
        .update({ where: { id: n.id }, data: { status: 'failed' } })
        .catch(() => {});
      errored += 1;
    }
  }

  if (due.length > 0) {
    console.log(`[notifications] processed ${processed} scheduled, ${errored} errored`);
  }
  return { processed, errored, scanned: due.length };
}

// Every minute the process is awake, fire due notifications. The free tier may
// sleep through exact send times — the lazy call in the user/admin read paths
// backfills anything missed on next access.
export function startNotificationScheduler() {
  try {
    cron.schedule('* * * * *', () => {
      processScheduledNotifications().catch((err) =>
        console.error('[notifications] scheduler tick failed:', err?.message ?? err),
      );
    });
    console.log('[notifications] scheduler started (every minute)');
  } catch (err) {
    console.error('[notifications] scheduler failed to start:', err?.message ?? err);
  }
}

// Best-effort lazy kick so scheduled sends fire even if cron never ran
// (render free tier). Never fails the surrounding request.
export function lazyProcessScheduled() {
  Promise.resolve(processScheduledNotifications()).catch(() => {});
}