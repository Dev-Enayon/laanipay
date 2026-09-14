import { env } from '../config/env.js';

const PAYSTACK_BASE_URL = 'https://api.paystack.co';

export class PaystackError extends Error {
  constructor(message, statusCode = 502, code = 'PAYSTACK_SERVICE_ERROR') {
    super(message);
    this.name = 'PaystackError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

function requireSecretKey() {
  if (!env.paystackSecretKey) {
    throw new PaystackError('Paystack secret key is not configured on the server', 503);
  }
}

// Maps a Paystack HTTP status + message to a stable, safe error code. Paystack
// surfaces business failures both as HTTP 4xx/5xx and as HTTP 200 +
// `{ status: false }`, so the message is used as a tie-breaker. Codes are the
// only things allowed to reach the frontend for 5xx-style failures.
function paystackErrorCode(httpStatus, message) {
  const msg = `${message ?? ''}`;
  if (httpStatus === 401 || /unauthori[sz]ed|authentication|invalid key/i.test(msg)) {
    return 'PAYSTACK_AUTH_ERROR';
  }
  if (httpStatus === 403 || /forbidden|not allowed|not permitted/i.test(msg)) {
    return 'PAYSTACK_FORBIDDEN';
  }
  if (httpStatus === 404 || /not found/i.test(msg)) {
    return 'PAYSTACK_NOT_FOUND';
  }
  if (httpStatus >= 500) {
    return 'PAYSTACK_SERVICE_ERROR';
  }
  return 'PAYSTACK_BAD_REQUEST';
}

// Generic Paystack API helpers. Paystack envelopes every success with
// `{ status: true, data: ... }`; a non-ok HTTP status or `status: false` is an
// upstream error. (Not used by verifyTransaction, which has its own semantics —
// a verified-but-failed transaction is still a valid HTTP 200 response.)
async function paystackRequest(path, { method = 'GET', body } = {}) {
  requireSecretKey();

  let res;
  try {
    res = await fetch(`${PAYSTACK_BASE_URL}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${env.paystackSecretKey}`,
        'Content-Type': 'application/json',
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    console.error('[paystack] network error', {
      method,
      path,
      error: err?.message ?? 'fetch failed',
    });
    throw new PaystackError('Paystack request failed (network/connection error)', 502);
  }

  const json = await res.json().catch(() => null);
  if (!res.ok || json?.status !== true) {
    // Preserve the real upstream status (4xx vs 5xx) instead of collapsing
    // everything to 502 — that collapse hid the true cause behind a generic
    // "Internal server error" in production. A 200 + {status:false} envelope is
    // a failed business operation and becomes a 400-class PAYSTACK_BAD_REQUEST.
    const httpStatus = res.ok ? 400 : res.status;
    const message = json?.message ?? `Paystack ${method} ${path} failed (HTTP ${res.status})`;
    const code = paystackErrorCode(res.status, message);

    // Full detail goes to server logs only. The message propagated to callers
    // is the short Paystack `message` string — never the raw response body,
    // which can contain account numbers, customers and other sensitive data.
    console.error('[paystack] request failed', {
      method,
      path,
      httpStatus: res.status,
      code,
      message,
    });

    throw new PaystackError(message, httpStatus, code);
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
