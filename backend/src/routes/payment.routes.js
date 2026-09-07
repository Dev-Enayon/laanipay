import { Router } from 'express';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { prisma } from '../lib/prisma.js';
import { settlePayment } from '../lib/settlement.js';
import { getPlatformConfig } from '../lib/config.js';
import { applyProviderResult } from '../lib/withdrawals.js';
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

    const config = await getPlatformConfig();
    const amount = config.registrationFeeKobo ?? env.activationFeeKobo;

    const payment = await prisma.$transaction(async (tx) => {
      await tx.activationPayment.updateMany({
        where: { userId: req.userId, status: 'pending' },
        data: { status: 'cancelled' },
      });

      const reference = `laani-act-${randomUUID()}`;
      return tx.activationPayment.create({
        data: {
          userId: req.userId,
          paystackReference: reference,
          amount,
          status: 'pending',
        },
      });
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
// Every event is persisted (webhook_events) for audit and idempotency: the
// unique (provider, event, reference) row means a retried webhook settles the
// underlying payment at most once. The browser-callback verify flow remains
// the primary path; the webhook provides a reliable fallback.
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
    const sigBuf = Buffer.from(signature, 'hex');
    const expBuf = Buffer.from(expected, 'hex');
    if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
      return res.status(401).json({ error: 'Invalid signature' });
    }

    let event;
    try {
      event = JSON.parse(rawBody.toString('utf8'));
    } catch {
      return res.status(400).json({ error: 'Invalid payload' });
    }

    const eventName = event?.event ?? 'unknown';
    const reference = typeof event?.data?.reference === 'string' ? event.data.reference : null;

    // Persist the event (idempotent via unique key). Null references are
    // recorded as plain rows since composite-unique lookups require a value.
    let row;
    try {
      if (reference) {
        row = await prisma.webhookEvent.upsert({
          where: {
            provider_event_reference: { provider: 'paystack', event: eventName, reference },
          },
          update: {},
          create: {
            provider: 'paystack',
            event: eventName,
            reference,
            status: 'RECEIVED',
            body: event,
          },
        });
      } else {
        row = await prisma.webhookEvent.create({
          data: {
            provider: 'paystack',
            event: eventName,
            reference: null,
            status: 'RECEIVED',
            body: event,
          },
        });
      }
    } catch (err) {
      console.error('[webhook] failed to persist event:', err?.message ?? err);
    }

    if (eventName === 'charge.success' && reference && row) {
      if (row.status !== 'PROCESSED') {
        try {
          await settlePayment({ reference });
          await prisma.webhookEvent
            .update({ where: { id: row.id }, data: { status: 'PROCESSED' } })
            .catch(() => {});
        } catch (err) {
          // Unknown references (or Paystack errors) are logged, not retried
          // forever by Paystack. The row marks the failure for admin review.
          await prisma.webhookEvent
            .update({
              where: { id: row.id },
              data: { status: 'FAILED', message: String(err?.message ?? err) },
            })
            .catch(() => {});
          console.error('[webhook] settlement failed:', err?.message ?? err);
        }
      }
    } else if (
      (eventName === 'transfer.success' || eventName === 'transfer.failed') &&
      reference &&
      row
    ) {
      if (row.status !== 'PROCESSED') {
        try {
          const ok = eventName === 'transfer.success';
          const message =
            ok ? null : String(event?.data?.failure_reason ?? 'Transfer failed');
          const result = await applyProviderResult({
            reference,
            ok,
            message,
          });
          await prisma.webhookEvent
            .update({
              where: { id: row.id },
              data: {
                status: result?.ignored ? 'IGNORED' : 'PROCESSED',
                message: result?.ignored ? `Unknown reference: ${reference}` : null,
              },
            })
            .catch(() => {});
          if (result?.ignored) {
            console.warn('[webhook] ignored transfer event for unknown reference:', reference);
          }
        } catch (err) {
          await prisma.webhookEvent
            .update({
              where: { id: row.id },
              data: { status: 'FAILED', message: String(err?.message ?? err) },
            })
            .catch(() => {});
          console.error('[webhook] transfer event handling failed:', err?.message ?? err);
        }
      }
    } else if (row && row.status === 'RECEIVED') {
      // Recorded events we take no action on (transfer.*, invoice.*, etc.).
      await prisma.webhookEvent
        .update({ where: { id: row.id }, data: { status: 'IGNORED' } })
        .catch(() => {});
    }

    res.json({ received: true });
  }),
);

export default router;
