// Wallet withdrawal state machine.
//
// Lifecycle: PENDING -> PROCESSING -> SUCCESS | FAILED | REVERSED
//            PENDING -> CANCELLED
//
// Money rules enforced here:
//   - Funds are RESERVED atomically at request time: balance decreases,
//     heldBalance increases, and a PENDING record is created in the same
//     transaction. A wallet's available balance can therefore never go
//     negative because of withdrawals.
//   - SUCCESS removes funds from the held pool (paid out on- or off-platform).
//   - FAILED / REVERSED / CANCELLED return the reserved funds to the balance.
//   - At most one active (PENDING/PROCESSING) withdrawal per user thanks to the
//     unique activeLock column — enforced by the database, not by in-memory flags.
//   - Every state transition is a guarded updateMany on the current status, so
//     concurrent or duplicated calls are idempotent.
//   - Bank transfers (Paystack) only happen through withdrawalProvider.js and
//     only when it reports canDisburseExternally(); SUCCESS is never auto-set
//     for an external transfer without a provider confirmation.

import { prisma } from './prisma.js';
import {
  canDisburseExternally,
  resolveBankAccount,
  createTransferRecipient,
  initiateTransfer,
} from './withdrawalProvider.js';
import { AppError } from '../middleware/error.js';

function naira(kobo) {
  return `₦${(kobo / 100).toLocaleString('en-NG')}`;
}

function isUniqueViolation(err) {
  return err?.code === 'P2002' || /duplicate key|unique constraint/i.test(`${err?.message ?? ''}`);
}

// ---------------------------------------------------------------------------
// User side
// ---------------------------------------------------------------------------

// Record a withdrawal request and reserve the funds atomically.
export async function requestWithdrawal({ userId, amountKobo, bank }) {
  const amount = Number(amountKobo);
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new AppError('Withdrawal amount must be a positive whole number in kobo', 400);
  }

  const bankName = (bank?.bankName ?? '').trim();
  const bankCode = (bank?.bankCode ?? '').trim();
  const accountNumber = (bank?.accountNumber ?? '').trim();
  if (!bankName) throw new AppError('Bank name is required', 400);
  if (!/^\d+$/.test(bankCode) || bankCode.length < 3) {
    throw new AppError('A valid bank code is required', 400);
  }
  if (!/^\d{10}$/.test(accountNumber)) {
    throw new AppError('A valid 10-digit account number is required', 400);
  }

  try {
    return await prisma.$transaction(async (tx) => {
      const wallet = await tx.wallet.findUnique({ where: { userId } });
      if (!wallet) throw new AppError('Wallet not found', 404);
      if (wallet.balance < amount) {
        throw new AppError(`Insufficient wallet balance (${naira(wallet.balance)} available)`, 400);
      }

      const updated = await tx.wallet.update({
        where: { userId },
        data: { balance: { decrement: amount }, heldBalance: { increment: amount } },
      });
      if (updated.balance < 0) throw new AppError('Insufficient wallet balance', 400);

      const withdrawal = await tx.withdrawal.create({
        data: {
          userId,
          amountKobo: amount,
          bankName,
          bankCode,
          accountNumber,
          status: 'PENDING',
          reservedAt: new Date(),
          activeLock: `${userId}:active`,
        },
      });

      const wtx = await tx.walletTransaction.create({
        data: {
          userId,
          type: 'withdrawal_hold',
          amount,
          balanceAfter: updated.balance,
          status: 'completed',
          description: `Withdrawal ${withdrawal.id} — funds reserved`,
          metadata: { withdrawalId: withdrawal.id },
        },
      });

      await tx.withdrawal.update({
        where: { id: withdrawal.id },
        data: { walletTransactionId: wtx.id },
      });

      await tx.auditLog.create({
        data: {
          userId,
          action: 'WITHDRAWAL_REQUESTED',
          metadata: { withdrawalId: withdrawal.id, amountKobo: amount, bankName },
        },
      });

      return withdrawal;
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new AppError('You already have an active withdrawal request', 409);
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// State transitions (shared helpers)
// ---------------------------------------------------------------------------

async function claimStatus(tx, withdrawalId, from, to, extra = {}) {
  const claimed = await tx.withdrawal.updateMany({
    where: { id: withdrawalId, status: from },
    data: { status: to, ...extra },
  });
  return claimed.count === 1;
}

// Refund reserved funds back to the wallet. Only valid for PENDING/PROCESSING
// (funds still held).
async function refundHeldFunds({ tx, withdrawal, status, reason, action, adminId }) {
  const wallet = await tx.wallet.update({
    where: { userId: withdrawal.userId },
    data: { balance: { increment: withdrawal.amountKobo }, heldBalance: { decrement: withdrawal.amountKobo } },
  });
  if (wallet.heldBalance < 0) {
    throw new AppError('Ledger inconsistency: held balance dropped below zero', 500);
  }

  const wtx = await tx.walletTransaction.create({
    data: {
      userId: withdrawal.userId,
      type: 'withdrawal_refund',
      amount: withdrawal.amountKobo,
      balanceAfter: wallet.balance,
      status: 'completed',
      description: `Withdrawal ${withdrawal.id} ${status === 'CANCELLED' ? 'cancelled' : 'returned'} — funds released`,
      metadata: { withdrawalId: withdrawal.id, status },
    },
  });

  await tx.withdrawal.update({
    where: { id: withdrawal.id },
    data: {
      status,
      activeLock: null,
      refundedWalletTransactionId: wtx.id,
      failureReason: reason ?? null,
      [status === 'CANCELLED' ? 'cancelledAt' : 'completedAt']: new Date(),
      notes: reason ?? null,
    },
  });

  await tx.auditLog.create({
    data: {
      userId: withdrawal.userId,
      adminId,
      action,
      metadata: { withdrawalId: withdrawal.id, amountKobo: withdrawal.amountKobo, reason: reason ?? null },
    },
  });

  return wtx;
}

// Remove funds from the held pool on SUCCESS (they are genuinely paid out).
async function releaseHeldFunds({ tx, withdrawal, adminId, notes }) {
  const wallet = await tx.wallet.update({
    where: { userId: withdrawal.userId },
    data: { heldBalance: { decrement: withdrawal.amountKobo } },
  });
  if (wallet.heldBalance < 0) {
    throw new AppError('Ledger inconsistency: held balance dropped below zero', 500);
  }

  await tx.auditLog.create({
    data: {
      userId: withdrawal.userId,
      adminId,
      action: 'WITHDRAWAL_CONFIRMED',
      metadata: { withdrawalId: withdrawal.id, amountKobo: withdrawal.amountKobo, notes: notes ?? null },
    },
  });
}

// ---------------------------------------------------------------------------
// Admin / provider side
// ---------------------------------------------------------------------------

// Begin settling a PENDING withdrawal. Marks it PROCESSING (funds stay held).
// When the external provider is enabled, a Paystack transfer is initiated;
// the transfer reference becomes the idempotency key stored on the row.
export async function processWithdrawal({ withdrawalId, adminId }) {
  let withdrawal = await prisma.withdrawal.findUnique({ where: { id: withdrawalId } });
  if (!withdrawal) throw new AppError('Withdrawal not found', 404);

  if (withdrawal.status === 'PROCESSING') {
    return { withdrawal, idempotent: true, reason: 'already_processing' };
  }
  if (withdrawal.status !== 'PENDING') {
    throw new AppError(`Cannot process a ${withdrawal.status} withdrawal`, 400);
  }

  const claimed = await prisma.withdrawal.updateMany({
    where: { id: withdrawalId, status: 'PENDING' },
    data: { status: 'PROCESSING', processedAt: new Date(), processedByAdminId: adminId },
  });
  if (claimed.count === 0) {
    return { withdrawal, idempotent: true, reason: 'already_processing' };
  }

  withdrawal = await prisma.withdrawal.findUnique({ where: { id: withdrawalId } });

  let providerReference = null;
  let notes = null;

  if (canDisburseExternally()) {
    try {
      const resolved = await resolveBankAccount({
        bankCode: withdrawal.bankCode,
        accountNumber: withdrawal.accountNumber,
      });
      const recipient = await createTransferRecipient({
        name: resolved?.account_name ?? 'LaaniPay Wallet User',
        bankCode: withdrawal.bankCode,
        accountNumber: withdrawal.accountNumber,
      });
      const reference = `laaniwd-${withdrawal.id}`;
      const transfer = await initiateTransfer({
        amountKobo: withdrawal.amountKobo,
        recipientCode: recipient?.recipient_code,
        reference,
        reason: 'LaaniPay wallet withdrawal',
      });
      providerReference = transfer?.reference ?? reference;
    } catch (err) {
      notes = `Transfer setup failed: ${err?.message ?? 'unknown'}`;
    }
  } else {
    notes = 'Bank-transfer provider not configured — awaiting admin-verified settlement.';
  }

  await prisma.$transaction(async (tx) => {
    await tx.withdrawal.update({
      where: { id: withdrawalId },
      data: {
        provider: providerReference ? 'paystack_transfer' : 'internal',
        ...(providerReference ? { providerReference } : {}),
        failureReason: notes,
        notes,
      },
    });
    await tx.auditLog.create({
      data: {
        userId: withdrawal.userId,
        adminId,
        action: 'WITHDRAWAL_PROCESSED',
        metadata: { withdrawalId, amountKobo: withdrawal.amountKobo, providerReference, notes },
      },
    });
  });

  return { withdrawal: { ...withdrawal, status: 'PROCESSING', providerReference, failureReason: notes } };
}

// Admin-verified settlement: PROCESSING -> SUCCESS.
export async function confirmWithdrawal({ withdrawalId, adminId = null, notes = null }) {
  return prisma.$transaction(async (tx) => {
    const withdrawal = await tx.withdrawal.findUnique({ where: { id: withdrawalId } });
    if (!withdrawal) throw new AppError('Withdrawal not found', 404);
    if (withdrawal.status === 'SUCCESS' || withdrawal.status === 'REVERSED') {
      return { withdrawal, idempotent: true };
    }
    if (withdrawal.status !== 'PROCESSING') {
      throw new AppError(`Only PROCESSING withdrawals can be confirmed (current: ${withdrawal.status})`, 400);
    }

    const claimed = await claimStatus(tx, withdrawalId, 'PROCESSING', 'SUCCESS', {
      activeLock: null,
      completedAt: new Date(),
      notes: notes ?? null,
    });
    if (!claimed) return { withdrawal, idempotent: true };

    await releaseHeldFunds({ tx, withdrawal, adminId, notes });

    return { withdrawal: { ...withdrawal, status: 'SUCCESS' } };
  });
}

// A settlement attempt failed: PROCESSING -> FAILED (funds refunded).
export async function failWithdrawal({ withdrawalId, adminId = null, reason = null }) {
  return prisma.$transaction(async (tx) => {
    const withdrawal = await tx.withdrawal.findUnique({ where: { id: withdrawalId } });
    if (!withdrawal) throw new AppError('Withdrawal not found', 404);
    if (['FAILED', 'REVERSED', 'CANCELLED', 'SUCCESS'].includes(withdrawal.status)) {
      return { withdrawal, idempotent: true };
    }

    const claimed = await claimStatus(tx, withdrawalId, 'PROCESSING', 'FAILED', { activeLock: null });
    if (!claimed) return { withdrawal, idempotent: true };

    await refundHeldFunds({
      tx,
      withdrawal,
      status: 'FAILED',
      reason: reason ?? withdrawal.failureReason ?? 'Withdrawal processing failed',
      action: 'WITHDRAWAL_FAILED',
      adminId,
    });

    return { withdrawal: { ...withdrawal, status: 'FAILED' } };
  });
}

// A completed settlement was reversed (returned by the bank/provider):
// SUCCESS -> REVERSED (funds credited back to the wallet).
export async function reverseWithdrawal({ withdrawalId, adminId = null, reason = null }) {
  return prisma.$transaction(async (tx) => {
    const withdrawal = await tx.withdrawal.findUnique({ where: { id: withdrawalId } });
    if (!withdrawal) throw new AppError('Withdrawal not found', 404);
    if (withdrawal.status === 'REVERSED') return { withdrawal, idempotent: true };
    if (withdrawal.status !== 'SUCCESS') {
      throw new AppError(`Only SUCCESS withdrawals can be reversed (current: ${withdrawal.status})`, 400);
    }

    const claimed = await claimStatus(tx, withdrawalId, 'SUCCESS', 'REVERSED', { activeLock: null });
    if (!claimed) return { withdrawal, idempotent: true };

    // Funds were already released on SUCCESS; returning them credits balance.
    const wallet = await tx.wallet.update({
      where: { userId: withdrawal.userId },
      data: { balance: { increment: withdrawal.amountKobo } },
    });
    const wtx = await tx.walletTransaction.create({
      data: {
        userId: withdrawal.userId,
        type: 'withdrawal_refund',
        amount: withdrawal.amountKobo,
        balanceAfter: wallet.balance,
        status: 'completed',
        description: `Withdrawal ${withdrawal.id} reversed — funds credited back`,
        metadata: { withdrawalId: withdrawal.id, status: 'REVERSED' },
      },
    });
    await tx.withdrawal.update({
      where: { id: withdrawal.id },
      data: { refundedWalletTransactionId: wtx.id, failureReason: reason ?? 'Reversed by administrator' },
    });
    await tx.auditLog.create({
      data: {
        userId: withdrawal.userId,
        adminId,
        action: 'WITHDRAWAL_REVERSED',
        metadata: { withdrawalId, amountKobo: withdrawal.amountKobo, reason: reason ?? null },
      },
    });

    return { withdrawal: { ...withdrawal, status: 'REVERSED' } };
  });
}

// Cancel an unprocessed request: PENDING -> CANCELLED (funds refunded).
export async function cancelWithdrawal({ withdrawalId, adminId = null, reason = null }) {
  return prisma.$transaction(async (tx) => {
    const withdrawal = await tx.withdrawal.findUnique({ where: { id: withdrawalId } });
    if (!withdrawal) throw new AppError('Withdrawal not found', 404);
    if (withdrawal.status === 'CANCELLED') return { withdrawal, idempotent: true };
    if (withdrawal.status !== 'PENDING') {
      throw new AppError(`Only PENDING withdrawals can be cancelled (current: ${withdrawal.status})`, 400);
    }

    const claimed = await claimStatus(tx, withdrawalId, 'PENDING', 'CANCELLED', { activeLock: null, cancelledAt: new Date() });
    if (!claimed) return { withdrawal, idempotent: true };

    await refundHeldFunds({
      tx,
      withdrawal,
      status: 'CANCELLED',
      reason: reason ?? 'Cancelled by administrator',
      action: 'WITHDRAWAL_CANCELLED',
      adminId,
    });

    return { withdrawal: { ...withdrawal, status: 'CANCELLED' } };
  });
}

// Apply a provider result (transfer.success / transfer.failed webhook). The
// reference is the idempotency key; unknown references are ignored gracefully.
export async function applyProviderResult({ reference, ok, message }) {
  return prisma.$transaction(async (tx) => {
    const withdrawal = await tx.withdrawal.findUnique({ where: { providerReference: reference } });
    if (!withdrawal) return { ignored: true, reason: 'unknown_reference' };

    if (ok) {
      if (withdrawal.status === 'SUCCESS' || withdrawal.status === 'REVERSED') {
        return { withdrawal, idempotent: true };
      }
      const claimed = await claimStatus(tx, withdrawal.id, 'PROCESSING', 'SUCCESS', {
        activeLock: null,
        completedAt: new Date(),
      });
      if (!claimed) return { withdrawal, idempotent: true };
      await releaseHeldFunds({ tx, withdrawal, adminId: null, notes: 'Provider confirmed transfer.success' });
      return { withdrawal: { ...withdrawal, status: 'SUCCESS' } };
    }

    if (['FAILED', 'REVERSED', 'CANCELLED', 'SUCCESS'].includes(withdrawal.status)) {
      return { withdrawal, idempotent: true };
    }
    const claimed = await claimStatus(tx, withdrawal.id, 'PROCESSING', 'FAILED', { activeLock: null });
    if (!claimed) return { withdrawal, idempotent: true };
    await refundHeldFunds({
      tx,
      withdrawal,
      status: 'FAILED',
      reason: message ?? 'Provider reported transfer.failed',
      action: 'WITHDRAWAL_FAILED',
      adminId: null,
    });
    return { withdrawal: { ...withdrawal, status: 'FAILED' } };
  });
}