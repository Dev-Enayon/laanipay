// Frontend helpers for the contribution frequencies (MONTHLY / WEEKLY).
// Plans are frequency-aware: MONTHLY plans use monthlyAmount, WEEKLY plans use
// weeklyAmount + cycleWeeks. The other amount column is unused for that plan.

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