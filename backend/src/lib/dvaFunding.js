// Paystack Dedicated Virtual Account (DVA) wallet funding.
//
// Flows implemented here:
//   1. Provisioning — create/fetch the Paystack customer for a user, then
//      create a DVA (`POST /dedicated_account`) and persist it locally. At most
//      one ACTIVE virtual account per user; re-provisioning marks older rows
//      INACTIVE.
//   2. Crediting — a bank transfer into the DVA arrives as a signed
//      `charge.success` webhook. The deposit is matched back to the user by
//      their Paystack customer_code and credited to the wallet in ONE atomic
//      transaction, keyed on the UNIQUE Paystack transaction reference so a
//      replayed webhook is a no-op.
//
// Money model: the DVA is an external collection account on the company's
// Paystack balance. A credited deposit increases the user's LaaniPay wallet
// balance (a liability to the user) — it is never recorded in CompanyLedger,
// which tracks company revenue/expenses only.

import { prisma } from './prisma.js';
import { env } from '../config/env.js';
import { AppError } from '../middleware/error.js';
import { createCustomer, createDedicatedAccount } from './paystack.js';
import { PaystackError } from './paystack.js';

export function canProvideDva() {
  return env.paystackDvaEnabled;
}

function isUniqueViolation(err) {
  return err?.code === 'P2002' || /duplicate key|unique constraint/i.test(`${err?.message ?? ''}`);
}

// True when a Paystack error indicates the DVA cannot be created until the
// customer is identified/validated (Financial-Services merchant requirement).
// Matches the classic Paystack messages: "Customer identification is required"
// and the *validation* variants ("Kindly ensure that your customer is
// validated.") that are also returned for this business type. Surfaces as
// DVA_REQUIRES_VALIDATION; BVN capture is out of scope for this phase.
export function isIdentificationRequiredError(err) {
  return err instanceof PaystackError && /(identif|validat)/i.test(err.message);
}

// Prisma raises P2021/P2022 when the 0012 DVA migration has not been applied to
// the connected database — the most common cause of a brand-new feature failing
// in production with a generic HTTP 500.
function isMigrationNotApplied(err) {
  return (
    err?.code === 'P2021' ||
    err?.code === 'P2022' ||
    /table .* does not exist|column .* does not exist|relation .* does not exist/i.test(
      `${err?.message ?? ''}`,
    )
  );
}

// Converts provisioning failures into safe, typed AppErrors so the frontend
// receives a useful code (and an appropriate HTTP status) instead of a masked
// 500 "Internal server error". Detailed Paystack responses stay server-side.
// Unknown errors (e.g. transient DB failures) are returned unchanged so the
// global error handler still logs them and responds 500.
export function mapProvisionError(err) {
  if (isIdentificationRequiredError(err)) {
    return new AppError(
      'Paystack requires customer validation before a virtual account can be created for this business. Customer validation (BVN capture) is not supported yet.',
      400,
      'DVA_REQUIRES_VALIDATION',
    );
  }

  if (err instanceof PaystackError) {
    const message = `${err.message ?? ''}`;
    const code = err.code ?? 'PAYSTACK_SERVICE_ERROR';

    // Paystack: "You need to add a bank account for Dedicated Virtual Account"
    // (or similar) — the merchant has no eligible collection bank configured.
    if (/add a bank account|bank account for/i.test(message)) {
      return new AppError(
        'Paystack does not offer virtual accounts for this business account yet.',
        400,
        'DVA_NOT_AVAILABLE',
      );
    }

    // Paystack rejected the configured preferred bank (e.g. invalid slug or
    // not permitted for this merchant). This is a server configuration problem.
    if (/invalid.*bank|bank.*invalid|preferred/i.test(message)) {
      return new AppError(
        'The virtual-account bank configured on the server is not accepted by Paystack.',
        500,
        'DVA_CONFIGURATION_ERROR',
      );
    }

    // Client-facing status policy: bad-request/not-found details may be shown
    // directly; auth/forbidden/service failures are masked server-side (the
    // code still tells the frontend what happened) and are never returned as
    // 401/403 so the frontend token-refresh flow is not triggered.
    const status = ['PAYSTACK_BAD_REQUEST', 'PAYSTACK_NOT_FOUND'].includes(code)
      ? err.statusCode >= 400 && err.statusCode < 500
        ? err.statusCode
        : 400
      : 502;

    return new AppError(message, status, code);
  }

  if (isMigrationNotApplied(err)) {
    console.error('[dva] database migration 0012 appears not to be applied:', err?.message);
    return new AppError(
      'Wallet funding is not fully deployed on the server (database migration required).',
      500,
      'DVA_CONFIGURATION_ERROR',
    );
  }

  return err;
}

// Pure classification of an incoming `charge.success` deposit payload —
// no DB access, so it is unit-testable. Returns either
// { ok: true, amountKobo, customerCode, transactionId, channel } or
// { ok: false, reason }.
export function classifyDeposit(data) {
  const channel = String(data?.channel ?? '').toLowerCase();
  if (!['bank', 'bank_transfer'].includes(channel)) {
    return { ok: false, reason: 'not_a_bank_transfer' };
  }
  if (String(data?.currency ?? 'NGN').toUpperCase() !== 'NGN') {
    return { ok: false, reason: 'non_ngn_currency' };
  }
  const amountKobo = Number(data?.amount);
  if (!Number.isInteger(amountKobo) || amountKobo <= 0) {
    return { ok: false, reason: 'non_positive_amount' };
  }
  const customerCode =
    typeof data?.customer?.customer_code === 'string' ? data.customer.customer_code : null;
  if (!customerCode) {
    return { ok: false, reason: 'missing_customer_code' };
  }
  return {
    ok: true,
    amountKobo,
    customerCode,
    transactionId: data.id != null ? String(data.id) : null,
    channel,
  };
}

function splitFullName(fullName) {
  const parts = (fullName ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: '', lastName: '' };
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') };
}

// ---------------------------------------------------------------------------
// Provisioning
// ---------------------------------------------------------------------------

// Advisory-lock key namespacing DVA provisioning per user. Serializes the
// whole provisioning section (ACTIVE re-check + Paystack customer/DVA creation
// + local persistence) so two concurrent requests for the same user cannot
// both reach Paystack. See getOrCreateVirtualAccount below.
function dvaProvisionLockKey(userId) {
  return `laanipay::dva::${userId}`;
}

// Returns the user's active DVA, provisioning a Paystack customer + DVA on
// first use. `user` must carry id, email, fullName and phone (requireAuth
// selects exactly these). Idempotent: an existing ACTIVE row is returned as-is.
//
// Concurrency: the ENTIRE provisioning section runs inside ONE interactive
// transaction and is serialized per user with a Postgres advisory lock
// (pg_advisory_xact_lock), keyed by userId. The lock is transaction-scoped
// (auto-released on commit/rollback, even if the request dies) and lives in
// the shared Postgres, so it serializes concurrent requests across every app
// instance — not just within one process. Without it, two simultaneous
// requests could both observe "no ACTIVE DVA" and each provision a separate
// Paystack dedicated account before either local row existed.
//
// Trade-offs / remaining external-API race (deliberately documented — do NOT
// present this as fully concurrency-safe; requirement 7/8):
//   - The lock holds one DB connection open while the external Paystack call
//     is in flight. Provisioning is rare, so this is the safest practical
//     trade-off. The transaction carries generous timeout/maxWait; a concurrent
//     request for the same user BLOCKS on the lock rather than racing, and
//     fails with a transaction timeout if the first attempt exceeds ~60s.
//   - The advisory lock only protects the LOCAL "we have no DVA yet" check.
//     It cannot make Paystack's side atomic with ours. If the process crashes
//     AFTER Paystack accepted the DVA but BEFORE our transaction commits, a
//     DVA exists on Paystack with no ACTIVE local row; the lock releases and
//     a later request may provision ANOTHER Paystack account. Reconciling such
//     orphaned Paystack DVAs is out of scope for this phase — this is the one
//     remaining race.
export async function getOrCreateVirtualAccount(user) {
  if (!canProvideDva()) {
    throw new AppError('Wallet funding by bank transfer is not enabled yet.', 403, 'DVA_DISABLED');
  }

  try {
    return await prisma.$transaction(
      async (tx) => {
        // Block other instances/requests from provisioning this user until we
        // commit. The lock key is per-user; different users never contend.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${dvaProvisionLockKey(user.id)}))`;

        const existing = await tx.virtualAccount.findFirst({
          where: { userId: user.id, status: 'ACTIVE' },
          orderBy: { createdAt: 'desc' },
        });
        if (existing) return existing;

        const customerCode = await ensureCustomerCode(user, tx);
        const dva = await createDedicatedAccount({
          customer: customerCode,
          preferredBank: env.paystackDvaPreferredBank,
        });

        return persistVirtualAccount(tx, { userId: user.id, customerCode, dva });
      },
      { maxWait: 15000, timeout: 60000 },
    );
  } catch (err) {
    if (isUniqueViolation(err)) {
      // Another path provisioned the same account moments ago — return it.
      // (Outside the rolled-back transaction, so the outer prisma client is
      // used here.)
      const row = await prisma.virtualAccount.findFirst({
        where: { userId: user.id, status: 'ACTIVE' },
        orderBy: { createdAt: 'desc' },
      });
      if (row) return row;
    }
    // Maps Paystack rejections (validation, eligibility, auth, preferred-bank)
    // and missing-migration Prisma errors to typed codes/statuses; rethrows
    // unknown errors for the global handler.
    throw mapProvisionError(err);
  }
}

// Ensures the user has a Paystack customer_code. `db` is the interactive
// transaction client, so the whole path stays inside the per-user lock.
async function ensureCustomerCode(user, db) {
  if (user.paystackCustomerCode) return user.paystackCustomerCode;

  const existing = await db.user.findUnique({
    where: { id: user.id },
    select: { paystackCustomerCode: true },
  });
  if (existing?.paystackCustomerCode) return existing.paystackCustomerCode;

  const { firstName, lastName } = splitFullName(user.fullName);
  const customer = await createCustomer({
    email: user.email,
    firstName,
    lastName,
    phone: user.phone ?? '',
  });

  try {
    await db.user.update({
      where: { id: user.id },
      data: { paystackCustomerCode: customer?.customer_code ?? null },
    });
  } catch (err) {
    // Defensive backstop: another path stored the same customer_code. Re-read
    // with the outer client because this transaction is already aborted.
    if (isUniqueViolation(err)) {
      const row = await prisma.user.findUnique({
        where: { id: user.id },
        select: { paystackCustomerCode: true },
      });
      if (row?.paystackCustomerCode) return row.paystackCustomerCode;
    }
    throw err;
  }

  return customer?.customer_code ?? null;
}

// Persists the freshly provisioned DVA inside the caller's transaction (both
// the ACTIVE->INACTIVE demotion and the create must commit atomically with the
// Paystack call above; a separate nested transaction would release the lock).
async function persistVirtualAccount(db, { userId, customerCode, dva }) {
  const data = dva ?? {};
  const bank = data.bank ?? {};

  // Enforce a single ACTIVE DVA per user even if a legacy race slipped through.
  await db.virtualAccount.updateMany({
    where: { userId, status: 'ACTIVE' },
    data: { status: 'INACTIVE' },
  });

  return db.virtualAccount.create({
    data: {
      userId,
      paystackDvaId: data.id != null ? String(data.id) : null,
      customerCode,
      accountNumber: data.account_number ?? null,
      accountName: data.account_name ?? null,
      bankName: bank.name ?? null,
      bankSlug: bank.slug ?? null,
      currency: data.currency ?? 'NGN',
      status: 'ACTIVE',
      assignedAt: data.created_at ? new Date(data.created_at) : new Date(),
    },
  });
}

// ---------------------------------------------------------------------------
// Deposit crediting (webhook path)
// ---------------------------------------------------------------------------

// Credit a user's wallet for an incoming DVA bank transfer, idempotently.
// `event` is the parsed `charge.success` webhook payload (already HMAC-verified
// by the webhook route). Attributes the deposit to the user whose Paystack
// customer_code matches `data.customer.customer_code`.
//
// Returns:
//   { credited: true }                    — deposit recorded + wallet credited
//   { alreadyProcessed: true }            — duplicate webhook (no-op)
//   { ignored: true, reason }             — not an attributable DVA deposit
export async function creditWalletDeposit(reference, event) {
  const data = event?.data ?? {};
  const classified = classifyDeposit(data);
  if (!classified.ok) {
    return { ignored: true, reason: classified.reason };
  }

  const { amountKobo, customerCode, transactionId, channel } = classified;

  const user = await prisma.user.findUnique({ where: { paystackCustomerCode: customerCode } });
  if (!user) {
    return { ignored: true, reason: 'unknown_customer' };
  }

  try {
    await prisma.$transaction(async (tx) => {
      const virtualAccount = await tx.virtualAccount.findFirst({
        where: { userId: user.id, status: 'ACTIVE' },
        select: { id: true },
      });

      await tx.walletDeposit.create({
        data: {
          userId: user.id,
          reference,
          transactionId,
          customerCode,
          virtualAccountId: virtualAccount?.id ?? null,
          amountKobo,
          currency: 'NGN',
          status: 'verified',
        },
      });

      const wallet = await tx.wallet.update({
        where: { userId: user.id },
        data: { balance: { increment: amountKobo } },
      });

      await tx.walletTransaction.create({
        data: {
          userId: user.id,
          type: 'DVA_DEPOSIT',
          amount: amountKobo,
          balanceAfter: wallet.balance,
          status: 'completed',
          reference,
          description: 'DVA funding — bank transfer deposit',
          metadata: {
            transactionId,
            customerCode,
            currency: 'NGN',
            channel,
          },
        },
      });

      await tx.auditLog.create({
        data: {
          userId: user.id,
          action: 'DVA_DEPOSIT_CREDITED',
          metadata: { reference, amountKobo, transactionId },
        },
      });
    });
    return { credited: true };
  } catch (err) {
    if (isUniqueViolation(err)) {
      return { alreadyProcessed: true };
    }
    throw err;
  }
}