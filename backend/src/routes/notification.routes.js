import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { AppError, asyncHandler } from '../middleware/error.js';
import { logAudit } from '../lib/audit.js';
import {
  NOTIFICATION_CATEGORIES,
  createNotification,
  resolveRecipientCount,
  lazyProcessScheduled,
} from '../lib/notifications.js';

const router = Router();

const MAX_BODY_LEN = 2000;
const MAX_TITLE_LEN = 120;
const MAX_SELECTED = 500;

function str(v) {
  return typeof v === 'string' ? v.trim() : '';
}

function num(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function parseSelectedIds(value) {
  if (Array.isArray(value)) {
    return value.map((v) => str(v)).filter(Boolean);
  }
  if (typeof value === 'string' && value) {
    return value
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean);
  }
  return [];
}

function parseScheduleAt(value) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    throw new AppError('scheduleAt must be a valid date-time', 400);
  }
  if (d.getTime() <= Date.now()) {
    throw new AppError('scheduleAt must be in the future', 400);
  }
  return d.toISOString();
}

// ---------------------------------------------------------------------------
// ADMIN endpoints — all require an authenticated administrator.
// ---------------------------------------------------------------------------

// Live recipient estimate for the admin send form.
router.get(
  '/recipients',
  requireAuth,
  requireAdmin,
  asyncHandler(async (req, res) => {
    const scope = str(req.query.scope);
    const role = str(req.query.role);
    const userIds = parseSelectedIds(req.query.userIds);
    if (!['all', 'role', 'selected', 'specific'].includes(scope)) {
      throw new AppError('scope must be all, role, selected or specific', 400);
    }
    const count = await resolveRecipientCount({ scope, role, userIds });
    res.json({ count });
  }),
);

// Send immediately or schedule for later.
router.post(
  '/send',
  requireAuth,
  requireAdmin,
  asyncHandler(async (req, res) => {
    const title = str(req.body?.title);
    const message = str(req.body?.message);
    const category = str(req.body?.category);
    const type = str(req.body?.type) || 'info';
    const scope = str(req.body?.scope);
    const role = str(req.body?.role);
    const userIds = parseSelectedIds(req.body?.userIds);
    let scheduleAt;
    try {
      scheduleAt = parseScheduleAt(req.body?.scheduleAt);
    } catch (err) {
      throw err;
    }

    if (title.length < 3 || title.length > MAX_TITLE_LEN) {
      throw new AppError(`Title must be between 3 and ${MAX_TITLE_LEN} characters`, 400);
    }
    if (message.length < 3 || message.length > MAX_BODY_LEN) {
      throw new AppError(`Message must be between 3 and ${MAX_BODY_LEN} characters`, 400);
    }
    if (!NOTIFICATION_CATEGORIES.includes(category)) {
      throw new AppError(`Category must be one of: ${NOTIFICATION_CATEGORIES.join(', ')}`, 400);
    }
    if (!['info', 'success', 'error'].includes(type)) {
      throw new AppError('type must be info, success or error', 400);
    }
    if (!['all', 'role', 'selected', 'specific'].includes(scope)) {
      throw new AppError('scope must be all, role, selected or specific', 400);
    }

    let normalizedRole = null;
    if (scope === 'role') {
      if (!['user', 'admin'].includes(role)) {
        throw new AppError('role must be user or admin when targeting a role', 400);
      }
      normalizedRole = role;
    }
    if (scope === 'selected' || scope === 'specific') {
      if (userIds.length === 0) {
        throw new AppError('At least one recipient user id is required', 400);
      }
      if (userIds.length > MAX_SELECTED) {
        throw new AppError(`Cannot target more than ${MAX_SELECTED} users at once`, 400);
      }
    }

    const result = await createNotification({
      title,
      message,
      category,
      type,
      senderId: req.user.id,
      scope: scope === 'specific' ? 'selected' : scope,
      role: normalizedRole,
      userIds,
      scheduleAt,
    });

    await logAudit({
      adminId: req.user.id,
      action: 'ADMIN_NOTIFICATION_SENT',
      reason: `Notification "${title}"`,
      metadata: {
        notificationId: result.id,
        scope,
        recipientCount: result.recipientCount,
        status: result.status,
      },
    });

    res.status(201).json({
      id: result.id,
      status: result.status,
      recipientCount: result.recipientCount,
      scheduledAt: result.scheduledAt,
      sentAt: result.sentAt,
      message: result.status === 'scheduled'
        ? `Notification scheduled to ${result.recipientCount} recipient(s)`
        : `Notification sent to ${result.recipientCount} recipient(s)`,
    });
  }),
);

// Admin notification history.
router.get(
  '/admin',
  requireAuth,
  requireAdmin,
  asyncHandler(async (req, res) => {
    lazyProcessScheduled();
    const page = num(req.query.page, 1);
    const pageSize = Math.min(100, num(req.query.pageSize, 20));
    const status = str(req.query.status);
    const category = str(req.query.category);

    const where = { senderId: { not: null } };
    if (status) where.status = status;
    if (category) where.category = category;

    const [total, notifications] = await Promise.all([
      prisma.notification.count({ where }),
      prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { sender: { select: { id: true, fullName: true } } },
      }),
    ]);

    const pageIds = notifications.map((n) => n.id);
    const receiptRows = pageIds.length
      ? await prisma.notificationReceipt.groupBy({
          by: ['notificationId'],
          where: { notificationId: { in: pageIds } },
          _count: { _all: true },
        })
      : [];

    const receiptMap = Object.fromEntries(receiptRows.map((r) => [r.notificationId, r._count._all]));

    res.json({
      total,
      page,
      pageSize,
      notifications: notifications.map((n) => ({
        id: n.id,
        title: n.title,
        body: n.body,
        type: n.type,
        category: n.category,
        recipientType: n.recipientType,
        recipientRole: n.recipientRole,
        recipientCount: n.recipientCount,
        deliveredCount: receiptMap[n.id] ?? 0,
        status: n.status,
        scheduledAt: n.scheduledAt,
        sentAt: n.sentAt,
        createdAt: n.createdAt,
        sender: n.sender ? { id: n.sender.id, fullName: n.sender.fullName } : null,
      })),
    });
  }),
);

// Cancel a scheduled notification.
router.post(
  '/admin/:id/cancel',
  requireAuth,
  requireAdmin,
  asyncHandler(async (req, res) => {
    const notification = await prisma.notification.findUnique({ where: { id: req.params.id } });
    if (!notification) throw new AppError('Notification not found', 404);
    if (notification.status !== 'scheduled') {
      throw new AppError('Only scheduled notifications can be cancelled', 409);
    }
    const updated = await prisma.notification.update({
      where: { id: notification.id },
      data: { status: 'cancelled' },
    });
    await logAudit({
      adminId: req.user.id,
      action: 'ADMIN_NOTIFICATION_CANCELLED',
      reason: `Notification "${updated.title}"`,
      metadata: { notificationId: updated.id },
    });
    res.json({ message: 'Notification cancelled', status: 'cancelled' });
  }),
);

// ---------------------------------------------------------------------------
// USER endpoints — authenticated members only, scoped to their own data.
// ---------------------------------------------------------------------------

// The authenticated user's notifications (direct system messages + broadcast
// receipts), merged newest-first with pagination.
router.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    lazyProcessScheduled();
    const userId = req.userId;
    const page = num(req.query.page, 1);
    const pageSize = Math.min(50, num(req.query.pageSize, 25));
    const fetchLimit = Math.min(page * pageSize + pageSize, 1000);

    const [directRows, receiptRows, directTotal, receiptTotal] = await Promise.all([
      prisma.notification.findMany({
        where: { userId, dismissedAt: null },
        orderBy: { createdAt: 'desc' },
        take: fetchLimit,
      }),
      prisma.notificationReceipt.findMany({
        where: { userId, dismissedAt: null },
        orderBy: { createdAt: 'desc' },
        take: fetchLimit,
        include: { notification: true },
      }),
      prisma.notification.count({ where: { userId, dismissedAt: null } }),
      prisma.notificationReceipt.count({ where: { userId, dismissedAt: null } }),
    ]);

    // Resolve admin sender names for broadcast notifications.
    const senderIds = new Set();
    for (const r of receiptRows) {
      if (r.notification.senderId) senderIds.add(r.notification.senderId);
    }
    let senderMap = new Map();
    if (senderIds.size > 0) {
      const admins = await prisma.user.findMany({
        where: { id: { in: Array.from(senderIds) } },
        select: { id: true, fullName: true },
      });
      senderMap = new Map(admins.map((a) => [a.id, a.fullName]));
    }

    const items = [];
    for (const d of directRows) {
      items.push({
        id: d.id,
        mode: 'direct',
        title: d.title,
        body: d.body,
        type: d.type,
        category: d.category ?? null,
        read: Boolean(d.readAt),
        createdAt: d.createdAt,
        sentAt: d.sentAt,
        senderName: null,
      });
    }
    for (const r of receiptRows) {
      const n = r.notification;
      items.push({
        id: n.id,
        mode: 'broadcast',
        title: n.title,
        body: n.body,
        type: n.type,
        category: n.category ?? null,
        read: Boolean(r.readAt),
        createdAt: r.createdAt,
        sentAt: n.sentAt,
        senderName: n.senderId ? (senderMap.get(n.senderId) ?? 'Admin') : null,
      });
    }

    items.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    const total = directTotal + receiptTotal;
    const start = (page - 1) * pageSize;
    const notifications = items.slice(start, start + pageSize);

    res.json({ total, page, pageSize, notifications });
  }),
);

router.get(
  '/unread-count',
  requireAuth,
  asyncHandler(async (req, res) => {
    lazyProcessScheduled();
    const userId = req.userId;
    const [direct, broadcast] = await Promise.all([
      prisma.notification.count({ where: { userId, readAt: null, dismissedAt: null } }),
      prisma.notificationReceipt.count({ where: { userId, readAt: null, dismissedAt: null } }),
    ]);
    res.json({ count: direct + broadcast });
  }),
);

// Mark a single notification as read (direct notification or broadcast receipt).
router.post(
  '/:id/read',
  requireAuth,
  asyncHandler(async (req, res) => {
    lazyProcessScheduled();
    const userId = req.userId;
    const { id } = req.params;

    const notification = await prisma.notification.findUnique({ where: { id } });
    if (!notification) throw new AppError('Notification not found', 404);

    if (notification.userId === userId) {
      await prisma.notification.updateMany({
        where: { id, userId, readAt: null },
        data: { readAt: new Date() },
      });
      return res.json({ message: 'Notification marked as read', read: true });
    }

    // Broadcast: only a legitimate recipient (existing receipt) can mark read.
    const receipt = await prisma.notificationReceipt.findUnique({
      where: { notificationId_userId: { notificationId: id, userId } },
    });
    if (!receipt) throw new AppError('Notification not found', 404);

    await prisma.notificationReceipt.update({
      where: { id: receipt.id },
      data: { readAt: new Date() },
    });
    res.json({ message: 'Notification marked as read', read: true });
  }),
);

// Mark all of the user's notifications as read.
router.post(
  '/read-all',
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = req.userId;
    const now = new Date();
    const [, receiptResult] = await Promise.all([
      prisma.notification.updateMany({ where: { userId, readAt: null }, data: { readAt: now } }),
      prisma.notificationReceipt.updateMany({
        where: { userId, readAt: null, dismissedAt: null },
        data: { readAt: now },
      }),
    ]);
    res.json({ message: 'All notifications marked as read', updated: receiptResult.count });
  }),
);

// Dismiss/remove a notification for the authenticated user.
router.delete(
  '/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = req.userId;
    const { id } = req.params;

    const notification = await prisma.notification.findUnique({ where: { id } });
    if (!notification) throw new AppError('Notification not found', 404);

    if (notification.userId === userId) {
      await prisma.notification.deleteMany({ where: { id, userId } });
      return res.json({ message: 'Notification dismissed', dismissed: true });
    }

    const receipt = await prisma.notificationReceipt.findUnique({
      where: { notificationId_userId: { notificationId: id, userId } },
    });
    if (!receipt) throw new AppError('Notification not found', 404);

    await prisma.notificationReceipt.update({
      where: { id: receipt.id },
      data: { dismissedAt: new Date() },
    });
    res.json({ message: 'Notification dismissed', dismissed: true });
  }),
);

export default router;