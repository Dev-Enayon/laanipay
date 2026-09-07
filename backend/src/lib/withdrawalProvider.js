// Withdrawal settlement provider — the single place external bank transfers
// would be initiated.
//
// HONEST SCOPE BOUNDARY: external settlement (Paystack Transfers) is gated
// behind WITHDRAWAL_BANK_TRANSFER_ENABLED (default FALSE). While disabled:
//   - canDisburseExternally() returns false,
//   - every payout path throws WithdrawalProviderDisabledError,
//   - the withdrawal state machine still records, reserves and administers
//     requests, but SUCCESS is only ever set by an admin-verified settlement
//     action — never by faked provider calls.
// Enabling "real" transfers additionally requires the Paystack account to be
// approved for Transfers (needs verified NUBAN recipients). Until then, do not
// flip this on.

import { env } from '../config/env.js';
import { AppError } from '../middleware/error.js';

export class WithdrawalProviderDisabledError extends Error {
  constructor() {
    super('Bank-transfer settlement is not configured (WITHDRAWAL_BANK_TRANSFER_ENABLED != true)');
    this.name = 'WithdrawalProviderDisabledError';
    this.code = 'WITHDRAWAL_PROVIDER_DISABLED';
  }
}

export function canDisburseExternally() {
  return env.withdrawalBankTransferEnabled;
}

const PAYSTACK_ENDPOINT = 'https://api.paystack.co';

async function paystackPost(path, body) {
  const res = await fetch(`${PAYSTACK_ENDPOINT}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.paystackSecretKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || data?.status !== true) {
    throw new AppError(`Paystack ${path} failed: ${data?.message ?? 'unknown error'}`, 502);
  }
  return data.data;
}

// Validates that the account number belongs to the bank code (Paystack resolve).
export async function resolveBankAccount({ bankCode, accountNumber }) {
  if (!canDisburseExternally()) throw new WithdrawalProviderDisabledError();
  return paystackPost('/bank/resolve', { bank_code: bankCode, account_number: accountNumber });
}

// Creates a NUBAN transfer recipient for a user's bank account.
export async function createTransferRecipient({ name, bankCode, accountNumber }) {
  if (!canDisburseExternally()) throw new WithdrawalProviderDisabledError();
  return paystackPost('/transferrecipient', {
    type: 'nuban',
    name,
    bank_code: bankCode,
    account_number: accountNumber,
    currency: 'NGN',
  });
}

// Initiates a Paystack transfer. `reference` is the idempotency key: Paystack
// returns the SAME transfer for the same reference, so retries can never
// double-send money.
export async function initiateTransfer({ amountKobo, recipientCode, reference, reason }) {
  if (!canDisburseExternally()) throw new WithdrawalProviderDisabledError();
  return paystackPost('/transfer', {
    source: 'balance',
    amount: amountKobo,
    recipient: recipientCode,
    reference,
    reason: reason ?? 'LaaniPay wallet withdrawal',
  });
}

export async function verifyTransfer(transferCode) {
  const res = await fetch(`${PAYSTACK_ENDPOINT}/transfer/verify/${encodeURIComponent(transferCode)}`, {
    headers: { Authorization: `Bearer ${env.paystackSecretKey}` },
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || data?.status !== true) {
    throw new AppError(`Paystack transfer verify failed: ${data?.message ?? 'unknown error'}`, 502);
  }
  return data.data;
}