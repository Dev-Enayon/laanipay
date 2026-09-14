import { env } from '../config/env.js';

const PAYSTACK_BASE_URL = 'https://api.paystack.co';

export class PaystackError extends Error {
  constructor(message, statusCode = 502) {
    super(message);
    this.name = 'PaystackError';
    this.statusCode = statusCode;
  }
}

function requireSecretKey() {
  if (!env.paystackSecretKey) {
    throw new PaystackError('Paystack secret key is not configured on the server', 503);
  }
}

// Generic Paystack API helpers. Paystack envelopes every success with
// `{ status: true, data: ... }`; a non-ok HTTP status or `status: false` is an
// upstream error. (Not used by verifyTransaction, which has its own semantics —
// a verified-but-failed transaction is still a valid HTTP 200 response.)
async function paystackRequest(path, { method = 'GET', body } = {}) {
  requireSecretKey();

  const res = await fetch(`${PAYSTACK_BASE_URL}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${env.paystackSecretKey}`,
      'Content-Type': 'application/json',
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const json = await res.json().catch(() => null);
  if (!res.ok || json?.status !== true) {
    throw new PaystackError(
      json?.message ?? `Paystack ${method} ${path} failed (HTTP ${res.status})`,
      res.status >= 500 ? res.status : 502,
    );
  }
  return json;
}

// Creates a Paystack customer. customer_code (CUS_...) links a user to their
// DVA and to incoming deposits. Official shape (POST /customer):
//   body  { email, first_name, last_name, phone }
//   data  { id, customer_code, email, first_name, last_name, phone, ... }
export async function createCustomer({ email, firstName, lastName, phone }) {
  const json = await paystackRequest('/customer', {
    method: 'POST',
    body: {
      email,
      first_name: firstName,
      last_name: lastName,
      phone,
    },
  });
  return json.data;
}

// Provisions a Dedicated Virtual Account for an existing customer. Official
// shape (POST /dedicated_account):
//   body  { customer, preferred_bank }
//   data  { id, bank: {name, id, slug}, account_name, account_number, currency,
//           active, assigned, customer: {customer_code, ...}, created_at }
export async function createDedicatedAccount({ customer, preferredBank }) {
  const json = await paystackRequest('/dedicated_account', {
    method: 'POST',
    body: { customer, preferred_bank: preferredBank },
  });
  return json.data;
}

// Fetches a Paystack customer (GET /customer/:customer_code). The response
// data includes the customer's `dedicated_account` object when one exists.
export async function fetchCustomer(customerCode) {
  const json = await paystackRequest(`/customer/${encodeURIComponent(customerCode)}`);
  return json.data;
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
