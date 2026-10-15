// Regression test for the Wallet "Total contributed" caption.
//
// The caption must render each plan as "Name ₦amount/period", joined by " · ".
// A previous bug left a stray `}` in the JSX template interpolation, so the raw
// array was interpolated (comma-joined) and the literal text ".join(' · ')}"
// leaked into the UI. These assertions pin the extracted pure helper.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planCaption } from '../src/lib/plans.js';
import { naira } from '../src/lib/format.js';

test('planCaption joins plan name, amount and period with a middle dot', () => {
  const subscriptions = [
    { plan: { name: 'Starter', frequency: 'WEEKLY', weeklyAmount: 100000 }, amount: 100000 },
    { plan: { name: 'Builder', frequency: 'MONTHLY', monthlyAmount: 200000 }, amount: 200000 },
  ];

  const caption = planCaption(subscriptions);

  assert.equal(caption, `Starter ${naira(100000)}/week · Builder ${naira(200000)}/month`);
  assert.ok(!caption.includes('.join'), 'must not leak the literal ".join(...)" text');
});

test('planCaption falls back to the plan amount and defaults to MONTHLY', () => {
  const caption = planCaption([{ plan: { name: 'Builder', monthlyAmount: 150000 } }]);
  assert.equal(caption, `Builder ${naira(150000)}/month`);
});

test('planCaption is empty when there are no subscriptions', () => {
  assert.equal(planCaption([]), '');
  assert.equal(planCaption(undefined), '');
});
