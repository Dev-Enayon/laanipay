import { env } from '../config/env.js';

const PAYSTACK_BASE_URL = 'https://api.paystack.co';

export class PaystackError extends Error {
  constructor(message, statusCode = 502) {
    super(message);
    this.name = 'PaystackError';
    this.statusCode = statusCode;
  }
}

export async function verifyTransaction(reference) {
  if (!env.paystackSecretKey) {
    throw new PaystackError('Paystack secret key is not configured on the server', 503);
  }

  const res = await fetch(
    `${PAYSTACK_BASE_URL}/transaction/verify/${encodeURIComponent(reference)}`,
    {
      headers: { Authorization: `Bearer ${env.paystackSecretKey}` },
    },
  );

  const json = await res.json().catch(() => null);

  if (!res.ok) {
    throw new PaystackError(json?.message ?? 'Paystack verification request failed', res.status);
  }

  return json;
}
