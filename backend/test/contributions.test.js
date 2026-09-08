import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addContributionPeriod,
  planAmount,
  subscriptionAmount,
} from '../src/lib/contributions.js';

test('planAmount selects the amount matching the plan frequency', () => {
  const monthly = { frequency: 'MONTHLY', monthlyAmount: 1000000, weeklyAmount: 300000 };
  const weekly = { frequency: 'WEEKLY', monthlyAmount: 1000000, weeklyAmount: 100000 };
  assert.equal(planAmount(monthly), 1000000);
  assert.equal(planAmount(weekly), 100000);
});

test('subscriptionAmount prefers the frozen amountKobo snapshot', () => {
  const sub = { amountKobo: 500000, plan: { frequency: 'MONTHLY', monthlyAmount: 1000000 } };
  assert.equal(subscriptionAmount(sub), 500000);
});

test('subscriptionAmount falls back to the live plan amount without a snapshot', () => {
  const sub = { amountKobo: null, plan: { frequency: 'MONTHLY', monthlyAmount: 1000000 } };
  assert.equal(subscriptionAmount(sub), 1000000);
  const weekly = { plan: { frequency: 'WEEKLY', weeklyAmount: 300000 } };
  assert.equal(subscriptionAmount(weekly), 300000);
});

test('monthly period always advances +1 month with month-end clamping', () => {
  const monthly = { frequency: 'MONTHLY' };
  assert.equal(
    addContributionPeriod(new Date('2025-01-31T12:00:00Z'), monthly).toISOString().slice(0, 10),
    '2025-02-28',
  );
  assert.equal(
    addContributionPeriod(new Date('2024-01-31T12:00:00Z'), monthly).toISOString().slice(0, 10),
    '2024-02-29',
  );
  assert.equal(
    addContributionPeriod(new Date('2025-02-28T12:00:00Z'), monthly).toISOString().slice(0, 10),
    '2025-03-28',
  );
});

test('weekly period always advances +1 week across month/year boundaries', () => {
  const weekly = { frequency: 'WEEKLY' };
  assert.equal(
    addContributionPeriod(new Date('2026-09-08T12:00:00Z'), weekly).toISOString().slice(0, 10),
    '2026-09-15',
  );
  assert.equal(
    addContributionPeriod(new Date('2026-12-25T12:00:00Z'), weekly).toISOString().slice(0, 10),
    '2027-01-01',
  );
});