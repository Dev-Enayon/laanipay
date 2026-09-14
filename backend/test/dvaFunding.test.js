import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyDeposit, isIdentificationRequiredError } from '../src/lib/dvaFunding.js';
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
  assert.equal(
    isIdentificationRequiredError(new Error('Customer identification is required')),
    false,
  );
  assert.equal(isIdentificationRequiredError(new PaystackError('Invalid amount', 400)), false);
  assert.equal(isIdentificationRequiredError(null), false);
});