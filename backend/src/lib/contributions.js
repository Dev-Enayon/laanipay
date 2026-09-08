// Contribution frequency helpers shared by routes and settlement.
//
// The contribution system supports two coexisting frequencies:
//   MONTHLY — the original product model. Plans carry a monthly_amount and are
//             billed once per month. No cohort.
//   WEEKLY  — the added AJO model. Plans carry a weekly_amount and cycleWeeks
//             and route through cohorts.
// A plan uses exactly one frequency; the other amount column is NULL. No column
// is ever repurposed (monthly_amount is always monthly for a given plan).
// All monetary values are in kobo.

export const FREQUENCIES = ['MONTHLY', 'WEEKLY'];
export const CYCLE_WEEKS = 52;

export function planFrequency(plan) {
  return plan?.frequency === 'WEEKLY' ? 'WEEKLY' : 'MONTHLY';
}

// The amount a user pays for a single contribution period of this plan.
export function planAmount(plan) {
  if (planFrequency(plan) === 'WEEKLY') return plan.weeklyAmount ?? 0;
  return plan.monthlyAmount ?? 0;
}

// The amount a user actually pays for a single contribution period of their
// subscription. A subscription carries an amountKobo snapshot (captured at
// subscribe time and backfilled for existing subscriptions when tiers change),
// so their financial terms are frozen; falls back to the live plan amount for
// rows created before the snapshot column existed.
export function subscriptionAmount(subscription) {
  return subscription?.amountKobo ?? planAmount(subscription?.plan);
}

export function frequencyLabel(frequency) {
  return frequency === 'WEEKLY' ? 'Weekly' : 'Monthly';
}

export function periodSuffix(frequency) {
  return frequency === 'WEEKLY' ? '/week' : '/month';
}

// Adds one contribution period to a date based on the plan frequency.
// Monthly additions clamp to the last day of the target month (a payment on
// Jan 31 advances to Feb 28/29, not to Mar 3).
export function addContributionPeriod(date, plan) {
  const d = new Date(date);
  if (planFrequency(plan) === 'WEEKLY') {
    d.setDate(d.getDate() + 7);
    return d;
  }
  const day = d.getDate();
  d.setMonth(d.getMonth() + 1);
  if (d.getDate() < day) d.setDate(0); // clamp to last day of the target month
  return d;
}

export function cycleLabel(plan) {
  if (planFrequency(plan) === 'WEEKLY') {
    const weeks = plan.cycleWeeks ?? CYCLE_WEEKS;
    return `${weeks}-week cycle`;
  }
  return 'Monthly recurring plan';
}