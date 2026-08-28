import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { AppError, asyncHandler } from '../middleware/error.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { billingMonthFor, nextChargeDate } from '../lib/serviceCharge.js';
import { runMonthlyChargeOnce } from '../lib/scheduler.js';
import { env } from '../config/env.js';

const router = Router();

// User-facing: current user's service-charge status + history + notifications.
router.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const [charges, notifications, wallet, monthCharged] = await Promise.all([
      prisma.serviceCharge.findMany({
        where: { userId: req.userId },
        orderBy: { billingMonth: 'desc' },
      }),
      prisma.notification.findMany({
        where: { userId: req.userId },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
      prisma.wallet.findUnique({ where: { userId: req.userId }, select: { balance: true } }),
      prisma.serviceCharge.findFirst({
        where: { userId: req.userId, billingMonth: billingMonthFor() },
        select: { status: true },
      }),
    ]);

    const nextDate = nextChargeDate();
    const nextChargeStr = `${nextDate.getFullYear()}-${String(nextDate.getMonth() + 1).padStart(2, '0')}-${String(
      nextDate.getDate(),
    ).padStart(2, '0')}`;

    res.json({
      monthlyFeeKobo: env.serviceChargeKobo,
      currentMonth: billingMonthFor(),
      currentMonthStatus: monthCharged?.status ?? 'not_processed',
      nextChargeDate: nextChargeStr,
      balance: wallet?.balance ?? 0,
      charges: charges.map((c) => ({
        id: c.id,
        amountKobo: c.amountKobo,
        billingMonth: c.billingMonth,
        status: c.status,
        failureReason: c.failureReason,
        collectedAt: c.collectedAt,
      })),
      notifications: notifications.map((n) => ({
        id: n.id,
        title: n.title,
        body: n.body,
        type: n.type,
        read: Boolean(n.readAt),
        createdAt: n.createdAt,
      })),
    });
  }),
);

// User-facing: mark notifications read.
router.post(
  '/notifications/read',
  requireAuth,
  asyncHandler(async (req, res) => {
    await prisma.notification.updateMany({
      where: { userId: req.userId, readAt: null },
      data: { readAt: new Date() },
    });
    res.json({ message: 'Notifications marked as read' });
  }),
);

// Admin: all service charges with reconciliation info.
router.get(
  '/admin',
  requireAuth,
  requireAdmin,
  asyncHandler(async (req, res) => {
    const charges = await prisma.serviceCharge.findMany({
      orderBy: [{ billingMonth: 'desc' }, { collectedAt: 'desc' }],
      include: { user: { select: { id: true, fullName: true, email: true } } },
      take: 500,
    });
    const totals = await prisma.serviceCharge.groupBy({
      by: ['status', 'billingMonth'],
      _count: { _all: true },
      _sum: { amountKobo: true },
    });
    res.json({
      monthlyFeeKobo: env.serviceChargeKobo,
      charges: charges.map((c) => ({
        id: c.id,
        userId: c.userId,
        user: c.user ? c.user.fullName : null,
        email: c.user ? c.user.email : null,
        amountKobo: c.amountKobo,
        billingMonth: c.billingMonth,
        status: c.status,
        failureReason: c.failureReason,
        walletTransactionId: c.walletTransactionId,
        creditedTo: c.creditedTo,
        companyLedgerId: c.companyLedgerId,
        paystackReference: c.paystackReference,
        paystackStatus: c.paystackStatus,
        collectedAt: c.collectedAt,
      })),
      totals,
    });
  }),
);

// Admin: manually trigger the (idempotent) monthly collection.
router.post(
  '/admin/run',
  requireAuth,
  requireAdmin,
  asyncHandler(async (req, res) => {
    const billingMonth = (req.body?.billingMonth ?? '').trim();
    if (billingMonth && !/^\d{4}-\d{2}$/.test(billingMonth)) {
      throw new AppError('billingMonth must be in YYYY-MM format', 400);
    }
    const summary = await runMonthlyChargeOnce(billingMonth || undefined);
    res.json({ message: 'Service charge run complete', month: billingMonth || billingMonthFor(), ...summary });
  }),
);

export default router;
