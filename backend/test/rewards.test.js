import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  levelRewards,
  splitReferralFee,
  weeklyPotSplit,
  expectedPayout,
  rewardLadder,
} from '../src/lib/rewards.js';

test('levelRewards falls back to defaults for missing levels', () => {
  const ladder = levelRewards('REGISTRATION', {});
  assert.deepEqual(ladder, { 1: 20000, 2: 10000, 3: 5000 });

  const custom = levelRewards('REGISTRATION', { REGISTRATION: { 1: 500, 2: 250 } });
  assert.equal(custom[1], 500);
  assert.equal(custom[2], 250);
  assert.equal(custom[3], 5000, 'missing level 3 uses default');

  const monthly = levelRewards('MONTHLY_SUBSCRIPTION', {});
  assert.deepEqual(monthly, { 1: 5000, 2: 3000, 3: 2000 });
});

test('rewardLadder aliases levelRewards', () => {
  assert.deepEqual(rewardLadder('REGISTRATION'), { 1: 20000, 2: 10000, 3: 5000 });
});

test('registration split: rewards never exceed the fee, remainder is company share', () => {
  const fee = 150000;
  const split = splitReferralFee({ feeKobo: fee, type: 'REGISTRATION' });
  assert.equal(split.totalRewards, 35000);
  assert.equal(split.byLevel[1], 20000);
  assert.equal(split.byLevel[2], 10000);
  assert.equal(split.byLevel[3], 5000);
  assert.equal(split.companyShare, 115000);
  assert.ok(split.totalRewards <= fee, 'rewards must not exceed the fee');
  assert.equal(split.totalRewards + split.companyShare, fee);
});

test('monthly split: ₦300 fee → ₦50/₦30/₦20 rewards, ₦200 company', () => {
  const split = splitReferralFee({ feeKobo: 30000, type: 'MONTHLY_SUBSCRIPTION' });
  assert.equal(split.byLevel[1], 5000);
  assert.equal(split.byLevel[2], 3000);
  assert.equal(split.byLevel[3], 2000);
  assert.equal(split.totalRewards, 10000);
  assert.equal(split.companyShare, 20000);
});

test('split caps rewards when fee is smaller than configured rewards', () => {
  const split = splitReferralFee({
    feeKobo: 9000,
    type: 'MONTHLY_SUBSCRIPTION',
    rewards: { MONTHLY_SUBSCRIPTION: { 1: 5000, 2: 3000, 3: 2000 } },
  });
  assert.equal(split.totalRewards, 9000, 'total is capped at the fee');
  assert.equal(split.companyShare, 0);
  // No level exceeds the fee and no negative reward is produced.
  for (const v of Object.values(split.byLevel)) {
    assert.ok(Number.isInteger(v) && v >= 0);
  }
});

test('weeklyPotSplit is linear and never negative', () => {
  const r = weeklyPotSplit(100000, 52, 2);
  assert.equal(r.gross, 5200000); // ₦1,000 × 52
  assert.equal(r.platformFee, 104000); // 2%
  assert.equal(r.net, 5096000);
  assert.equal(r.platformFee + r.net, r.gross);
});

test('weeklyPotSplit handles zero payers and zero fee', () => {
  const none = weeklyPotSplit(100000, 0, 2);
  assert.equal(none.gross, 0);
  assert.equal(none.platformFee, 0);
  assert.equal(none.net, 0);

  const noFee = weeklyPotSplit(100000, 52, 0);
  assert.equal(noFee.platformFee, 0);
  assert.equal(noFee.net, noFee.gross);
});

test('weeklyPotSplit rounding keeps net = gross - fee', () => {
  const values = [5000, 3141, 999999, 1234567];
  const counts = [1, 7, 52];
  const fees = [0, 1, 2, 2.5, 5, 10];
  for (const v of values) {
    for (const c of counts) {
      for (const f of fees) {
        const r = weeklyPotSplit(v, c, f);
        assert.equal(r.net, r.gross - r.platformFee, `v=${v} c=${c} f=${f}`);
        assert.ok(r.platformFee >= 0);
        assert.ok(r.net >= 0);
        assert.ok(Number.isInteger(r.gross) && Number.isInteger(r.platformFee) && Number.isInteger(r.net));
      }
    }
  }
});

test('expectedPayout for a full 52-week ₦5,000 cohort', () => {
  const r = expectedPayout(500000, 52, 2);
  assert.equal(r.gross, 26000000); // ₦5,000 × 52
  assert.equal(r.platformFee, 520000); // 2%
  assert.equal(r.net, 25480000);
});