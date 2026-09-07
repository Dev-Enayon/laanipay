// Monthly service-charge scheduler. Uses node-cron.
//
// IMPORTANT (Render free tier): the single web service sleeps when idle and
// there is no guarantee it stays awake to fire a midnight cron. The cron is
// still configured here (as chosen), AND an admin can trigger the same
// idempotent routine manually at any time, so a missed month can be recovered
// by running the job when the service happens to be awake.
import cron from 'node-cron';
import { env } from '../config/env.js';
import { collectMonthlyServiceCharge, billingMonthFor } from './serviceCharge.js';
import { runDueCohortPayouts } from './cohort.js';

let running = false;
let cohortRunning = false;

export async function runMonthlyChargeOnce(billingMonth, { force = false } = {}) {
  if (!env.serviceChargeEnabled && !force) {
    return {
      skipped: 'service_charge_disabled',
      reason: 'SERVICE_CHARGE_ENABLED is not true — collection is not active.',
    };
  }
  if (running) {
    console.warn('[serviceCharge] job already running — skipping concurrent run');
    return { skipped: 'already_running' };
  }
  running = true;
  const month = billingMonth ?? billingMonthFor();
  try {
    console.log(`[serviceCharge] starting monthly collection for ${month}`);
    const summary = await collectMonthlyServiceCharge(month);
    console.log(`[serviceCharge] done for ${month}:`, summary);
    return summary;
  } catch (err) {
    console.error('[serviceCharge] monthly collection failed:', err?.message ?? err);
    return { failed: true, reason: err?.message ?? 'unknown' };
  } finally {
    running = false;
  }
}

export function startServiceChargeScheduler() {
  if (!env.serviceChargeEnabled) {
    console.log('[serviceCharge] scheduler disabled (SERVICE_CHARGE_ENABLED != true)');
    return;
  }
  const expr = env.serviceChargeCron;
  if (!cron.validate(expr)) {
    console.error(`[serviceCharge] invalid cron expression "${expr}" — scheduler not started`);
    return;
  }
  cron.schedule(expr, () => {
    runMonthlyChargeOnce().catch((err) =>
      console.error('[serviceCharge] scheduler tick failed:', err?.message ?? err),
    );
  });
  console.log(`[serviceCharge] scheduler started with cron "${expr}"`);
}

// --- Weekly AJO payout scheduler ---
// Idempotent: each cohort week settles at most once (unique cohort+week). Run
// weekly, after the week's contributions have landed. Like the monthly job,
// Render free tier may sleep through the cron — an admin can trigger the same
// routine manually at any time.

export async function runCohortPayoutsOnce() {
  if (cohortRunning) {
    console.warn('[cohort] payout job already running — skipping concurrent run');
    return { skipped: 'already_running' };
  }
  cohortRunning = true;
  try {
    const results = await runDueCohortPayouts();
    console.log('[cohort] weekly payout run complete:', JSON.stringify(results));
    return results;
  } catch (err) {
    console.error('[cohort] weekly payout run failed:', err?.message ?? err);
    return { failed: true, reason: err?.message ?? 'unknown' };
  } finally {
    cohortRunning = false;
  }
}

export function startCohortScheduler() {
  const enabled = (process.env.COHORT_PAYOUT_ENABLED ?? 'true').toLowerCase() === 'true';
  if (!enabled) {
    console.log('[cohort] scheduler disabled (COHORT_PAYOUT_ENABLED != true)');
    return;
  }
  const expr = process.env.COHORT_PAYOUT_CRON ?? '0 4 * * 1'; // Monday 04:00
  if (!cron.validate(expr)) {
    console.error(`[cohort] invalid cron expression "${expr}" — scheduler not started`);
    return;
  }
  cron.schedule(expr, () => {
    runCohortPayoutsOnce().catch((err) =>
      console.error('[cohort] scheduler tick failed:', err?.message ?? err),
    );
  });
  console.log(`[cohort] scheduler started with cron "${expr}"`);
}
