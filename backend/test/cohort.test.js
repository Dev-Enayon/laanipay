import { test } from 'node:test';
import assert from 'node:assert/strict';

import { weeklyPotSplit } from '../src/lib/rewards.js';
import { platformFeePercent } from '../src/lib/config.js';

// A pure simulation of a 52-position cohort week that mirrors the arithmetic in
// lib/cohort.js processCohortWeek. Guards the invariants the engine relies on
// without needing a database.

function simulateCohortWeek({ size, currentWeek, weeklyAmount, paidCount, feePercent }) {
  const collectorPosition = currentWeek;
  const collectorCollected = collectorPosition >= 1 && collectorPosition <= size;
  const { gross, platformFee, net } = weeklyPotSplit(weeklyAmount, paidCount, feePercent);
  const collectorGetsPaid = net > 0 && collectorCollected && paidCount > 0;
  return {
    collectorPosition,
    gross,
    platformFee,
    net,
    collectorGetsPaid,
    advancement: currentWeek === size ? 'COMPLETED' : currentWeek + 1,
  };
}

test('position N collects the week-N pool (full attendance)', () => {
  const week = simulateCohortWeek({ size: 52, currentWeek: 1, weeklyAmount: 100000, paidCount: 52, feePercent: 2 });
  assert.equal(week.gross, 5200000);
  assert.equal(week.net, 5096000);
  assert.equal(week.collectorGetsPaid, true);
});

test('a partially-paid week pays the collector the paid proportion', () => {
  const week = simulateCohortWeek({ size: 52, currentWeek: 7, weeklyAmount: 300000, paidCount: 40, feePercent: 2 });
  const { gross, net } = weeklyPotSplit(300000, 40, 2);
  assert.equal(week.gross, gross);
  assert.equal(week.net, net);
  assert.ok(net === gross - Math.round((gross * 2) / 100));
  assert.equal(week.collectorGetsPaid, true);
});

test('an unserved week yields no payout and advances anyway', () => {
  const week = simulateCohortWeek({ size: 52, currentWeek: 52, weeklyAmount: 100000, paidCount: 0, feePercent: 2 });
  assert.equal(week.gross, 0);
  assert.equal(week.net, 0);
  assert.equal(week.collectorGetsPaid, false);
  assert.equal(week.advancement, 'COMPLETED', 'the last week completes the cohort');
});

test('cohort always advances one week per processed week', () => {
  for (let currentWeek = 1; currentWeek <= 52; currentWeek += 1) {
    const week = simulateCohortWeek({ size: 52, currentWeek, weeklyAmount: 100000, paidCount: 45, feePercent: 2 });
    assert.equal(week.collectorPosition, currentWeek);
    assert.equal(week.advancement, currentWeek === 52 ? 'COMPLETED' : currentWeek + 1);
  }
});

test('platform fee percent honours the environment variable', () => {
  const before = process.env.WEEKLY_PLATFORM_FEE_PERCENTAGE;
  try {
    delete process.env.WEEKLY_PLATFORM_FEE_PERCENTAGE;
    assert.equal(platformFeePercent(), 2);

    process.env.WEEKLY_PLATFORM_FEE_PERCENTAGE = '5';
    assert.equal(platformFeePercent(), 5);

    process.env.WEEKLY_PLATFORM_FEE_PERCENTAGE = '-3';
    assert.equal(platformFeePercent(), 0, 'negative clamps to 0');

    process.env.WEEKLY_PLATFORM_FEE_PERCENTAGE = '101';
    assert.equal(platformFeePercent(), 100, 'over 100 clamps to 100');

    process.env.WEEKLY_PLATFORM_FEE_PERCENTAGE = 'banana';
    assert.equal(platformFeePercent(), 2, 'non-numeric falls back to default');
  } finally {
    if (before === undefined) delete process.env.WEEKLY_PLATFORM_FEE_PERCENTAGE;
    else process.env.WEEKLY_PLATFORM_FEE_PERCENTAGE = before;
  }
});