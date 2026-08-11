import { Router } from 'express';
import { createHmac, randomUUID } from 'node:crypto';
import { prisma } from '../lib/prisma.js';
import { settlePayment } from '../lib/settlement.js';
import { env } from '../config/env.js';
import { AppError, asyncHandler } from '../middleware/error.js';
import { requireAuth } from '../middleware/auth.js';
import { verifyLimiter } from '../middleware/rateLimit.js';

const router = Router();

router.post(
  '/initialize',
  requireAuth,
  asyncHandler(async (req, res) => {
    if (req.user.activationStatus) {
      throw new AppError('Account is already activated', 409);
    }
    if (!req.user.emailVerifiedAt) {
      throw new AppError('Please verify your email address before activating your account', 403);
    }

    const existing = await prisma.activationPayment.findFirst({
      where: { userId: req.userId, status: 'pending' },
    });

    if (existing) {
      return res.json({
        reference: existing.paystackReference,
        amount: existing.amount,
        email: req.user.email,
      });
    }

    const reference = `laani-act-${randomUUID()}`;

    const payment = await prisma.activationPayment.create({
      data: {
        userId: req.userId,
        paystackReference: reference,
        amount: env.activationFeeKobo,
        status: 'pending',
      },
    });

    res.json({ reference: payment.paystackReference, amount: payment.amount, email: req.user.email });
  }),
);

router.post(
  '/verify',
  requireAuth,
  verifyLimiter,
  asyncHandler(async (req, res) => {
    const { reference } = req.body ?? {};

    if (typeof reference !== 'string' || !reference) {
      throw new AppError('Payment reference is required', 400);
    }

    const result = await settlePayment({ reference, expectedUserId: req.userId });
    res.json(result);
  }),
);

// Paystack webhook — server-to-server notification of charge.success.
// Signature is HMAC-SHA512 of the raw body using the Paystack secret key.
// The browser-callback verify flow remains the primary path; the webhook
// provides a reliable fallback and is idempotent with it.
router.post(
  '/webhook',
  asyncHandler(async (req, res) => {
    const signature = req.headers['x-paystack-signature'];
    const rawBody = req.rawBody;
    const secret = env.paystackSecretKey;

    if (!signature || !rawBody || !secret) {
      return res.status(401).json({ error: 'Invalid signature' });
    }

    const expected = createHmac('sha512', secret).update(rawBody).digest('hex');
    if (expected !== signature) {
      return res.status(401).json({ error: 'Invalid signature' });
    }

    let event;
    try {
      event = JSON.parse(rawBody.toString('utf8'));
    } catch {
      return res.status(400).json({ error: 'Invalid payload' });
    }

    if (event?.event === 'charge.success' && event?.data?.reference) {
      try {
        await settlePayment({ reference: event.data.reference });
      } catch (err) {
        // Acknowledge receipt regardless; unknown references are logged, not retried.
        console.error('[webhook] settlement failed:', err.message);
      }
    }

    res.json({ received: true });
  }),
);

export default router;
