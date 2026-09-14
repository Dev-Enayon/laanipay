import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyDeposit,
  isIdentificationRequiredError,
  mapProvisionError,
} from '../src/lib/dvaFunding.js';
import { PaystackError } from '../src/lib/paystack.js';

test('classifyDeposit accepts a valid NGN bank-transfer deposit', () => {
  const result = classifyDeposit({
    id: 1234567890,
    amount: 250000,
    currency: 'NGN',
    channel: 'bank_transfer',
    customer: { customer_code: 'CUS_x123' },
  });
  assert.equal(result.ok, true);
  assert.equal(result.amountKobo, 250000);
  assert.equal(result.customerCode, 'CUS_x123');
  assert.equal(result.transactionId, '1234567890');
});

test('classifyDeposit rejects non-bank channels before any lookup', () => {
  const result = classifyDeposit({
    amount: 250000,
    currency: 'NGN',
    channel: 'card',
    customer: { customer_code: 'CUS_x123' },
  });
  assert.deepEqual(result, { ok: false, reason: 'not_a_bank_transfer' });
});

test('classifyDeposit rejects non-NGN currency', () => {
  const result = classifyDeposit({
    amount: 250000,
    currency: 'USD',
    channel: 'bank',
    customer: { customer_code: 'CUS_x123' },
  });
  assert.deepEqual(result, { ok: false, reason: 'non_ngn_currency' });
});

test('classifyDeposit defaults a missing currency to NGN', () => {
  const result = classifyDeposit({
    amount: 50000,
    channel: 'bank',
    customer: { customer_code: 'CUS_x123' },
  });
  assert.equal(result.ok, true);
});

test('classifyDeposit rejects zero and non-integer amounts', () => {
  assert.deepEqual(
    classifyDeposit({ amount: 0, channel: 'bank', customer: { customer_code: 'C' } }),
    { ok: false, reason: 'non_positive_amount' },
  );
  assert.deepEqual(
    classifyDeposit({ amount: '12.50', channel: 'bank', customer: { customer_code: 'C' } }),
    { ok: false, reason: 'non_positive_amount' },
  );
  assert.deepEqual(
    classifyDeposit({ amount: NaN, channel: 'bank', customer: { customer_code: 'C' } }),
    { ok: false, reason: 'non_positive_amount' },
  );
});

test('classifyDeposit requires a customer_code to attribute the deposit', () => {
  assert.deepEqual(
    classifyDeposit({ amount: 1000, channel: 'bank', customer: {} }),
    { ok: false, reason: 'missing_customer_code' },
  );
});

test('isIdentificationRequiredError only matches Paystack identification errors', () => {
  assert.equal(
    isIdentificationRequiredError(new PaystackError('Customer identification is required', 400)),
    true,
  );
  // Financial-Services merchants also see the *validation* variant.
  assert.equal(
    isIdentificationRequiredError(
      new PaystackError('Kindly ensure that your customer is validated.', 400),
    ),
    true,
  );
  assert.equal(
    isIdentificationRequiredError(new Error('Customer identification is required')),
    false,
  );
  assert.equal(isIdentificationRequiredError(new PaystackError('Invalid amount', 400)), false);
  assert.equal(isIdentificationRequiredError(null), false);
});

test('mapProvisionError maps customer validation to DVA_REQUIRES_VALIDATION (400)', () => {
  const err = new PaystackError(
    'Customer validation is required to perform this transaction',
    400,
    'PAYSTACK_BAD_REQUEST',
  );
  const appError = mapProvisionError(err);
  assert.equal(appError.name, 'AppError');
  assert.equal(appError.statusCode, 400);
  assert.equal(appError.code, 'DVA_REQUIRES_VALIDATION');
});

test('mapProvisionError maps missing collection bank to DVA_NOT_AVAILABLE (400)', () => {
  const err = new PaystackError(
    'You need to add a bank account for Dedicated Virtual Account.',
    400,
    'PAYSTACK_BAD_REQUEST',
  );
  const appError = mapProvisionError(err);
  assert.equal(appError.statusCode, 400);
  assert.equal(appError.code, 'DVA_NOT_AVAILABLE');
});

test('mapProvisionError maps invalid preferred bank to DVA_CONFIGURATION_ERROR (500)', () => {
  const err = new PaystackError('Invalid preferred bank', 400, 'PAYSTACK_BAD_REQUEST');
  const appError = mapProvisionError(err);
  assert.equal(appError.statusCode, 500);
  assert.equal(appError.code, 'DVA_CONFIGURATION_ERROR');
});

test('mapProvisionError maps missing migration tables/columns to DVA_CONFIGURATION_ERROR', () => {
  for (const raw of [
    { code: 'P2021', message: 'PrismaClientKnownRequestError: table does not exist' },
    { code: 'P2022', message: 'Column paystack_customer_code does not exist' },
    { code: undefined, message: 'ERROR: relation "virtual_accounts" does not exist' },
  ]) {
    const appError = mapProvisionError(raw);
    assert.equal(appError.name, 'AppError', `code ${raw.code}`);
    assert.equal(appError.statusCode, 500, `code ${raw.code}`);
    assert.equal(appError.code, 'DVA_CONFIGURATION_ERROR', `code ${raw.code}`);
  }
});

test('mapProvisionError maps upstream HTTP status to codes/statuses conservatively', () => {
  // 400 stays a 400 and keeps its safe message.
  const bad = mapProvisionError(new PaystackError('Some business error', 400, 'PAYSTACK_BAD_REQUEST'));
  assert.equal(bad.statusCode, 400);
  assert.equal(bad.code, 'PAYSTACK_BAD_REQUEST');
  assert.equal(bad.message, 'Some business error');

  // 404 keeps the not-found status/code.
  const missing = mapProvisionError(new PaystackError('Not found', 404, 'PAYSTACK_NOT_FOUND'));
  assert.equal(missing.statusCode, 404);
  assert.equal(missing.code, 'PAYSTACK_NOT_FOUND');

  // Auth/forbidden/service error details are masked and never surface as
  // client 401/403 (which would trip the frontend refresh flow).
  for (const raw of [
    new PaystackError('Authentication failed', 401, 'PAYSTACK_AUTH_ERROR'),
    new PaystackError('Forbidden', 403, 'PAYSTACK_FORBIDDEN'),
    new PaystackError('Upstream exploded', 500, 'PAYSTACK_SERVICE_ERROR'),
  ]) {
    const appError = mapProvisionError(raw);
    assert.equal(appError.statusCode, 502);
    assert.equal(appError.code, raw.code);
  }
});

test('mapProvisionError rethrows unknown errors for the global handler', () => {
  const err = new Error('random transient failure');
  assert.equal(mapProvisionError(err), err);
});