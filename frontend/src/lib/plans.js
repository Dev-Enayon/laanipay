// Frontend helpers for the contribution frequencies (MONTHLY / WEEKLY).
// Plans are frequency-aware: MONTHLY plans use monthlyAmount, WEEKLY plans use
// weeklyAmount + cycleWeeks. The other amount column is unused for that plan.

import { naira } from './format.js';

export const FREQUENCIES = ['MONTHLY', 'WEEKLY'];

export function planFrequency(plan) {
  return plan?.frequency === 'WEEKLY' ? 'WEEKLY' : 'MONTHLY';
}

// Amount owed for one contribution period of a plan.
export function planAmount(plan) {
  return planFrequency(plan) === 'WEEKLY' ? (plan?.weeklyAmount ?? 0) : (plan?.monthlyAmount ?? 0);
}

export function periodSuffix(frequency) {
  return frequency === 'WEEKLY' ? '/week' : '/month';
}

export function frequencyLabel(frequency) {
  return frequency === 'WEEKLY' ? 'Weekly' : 'Monthly';
}

// Human-readable caption for the plans behind a total, e.g.
// "Starter ₦1,000.00/week · Builder ₦2,000.00/month". Pure so it can be
// unit-tested without a DOM. Falls back to the plan's own amount when the
// subscription carries no explicit amount.
export function planCaption(subscriptions) {
  return (subscriptions ?? [])
    .map((s) => `${s.plan?.name} ${naira(s.amount ?? planAmount(s.plan))}${periodSuffix(s.plan?.frequency)}`)
    .join(' · ');
}