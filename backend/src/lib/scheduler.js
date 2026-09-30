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

// --- Default / grace sweep ---
// Detects unpaid weeks and expires grace periods. Both operations are
// idempotent (a week is recorded once, a case is opened once) and both are
// gated behind `defaultPolicy.enabled`, so with the policy off this is a
// no-op. It runs BEFORE the payout run so a member's miss is recorded before
// the week's pot is computed.

let defaultSweepRunning = false;

export async function runDefaultSweepOnce() {
  if (defaultSweepRunning) {
    console.warn('[default] sweep already running — skipping concurrent run');
    return { skipped: 'already_running' };
  }
  defaultSweepRunning = true;
  try {
    const { getPlatformConfig } = await import('./config.js');
    const { detectMissedContributions, expireGracePeriods } = await import('./defaultRecovery.js');
    const { prisma } = await import('./prisma.js');

    const config = await getPlatformConfig();
    if (config.defaultPolicy?.enabled !== true) {
      return { skipped: 'default_policy_disabled' };
    }

    const cohorts = await prisma.cohort.findMany({ where: { status: 'ACTIVE' }, select: { id: true } });
    const detected = [];
    for (const c of cohorts) {
      const res = await detectMissedContributions({ cohortId: c.id });
      detected.push({ cohortId: c.id, detected: res.detected?.length ?? 0 });
    }

    const expired = await expireGracePeriods();
    console.log('[default] sweep complete:', JSON.stringify({ detected, expired: expired.length }));
    return { detected, expired };
  } catch (err) {
    console.error('[default] sweep failed:', err?.message ?? err);
    return { failed: true, reason: err?.message ?? 'unknown' };
  } finally {
    defaultSweepRunning = false;
  }
}

export function startDefaultScheduler() {
  const enabled = (process.env.DEFAULT_SWEEP_ENABLED ?? 'false').toLowerCase() === 'true';
  if (!enabled) {
    console.log('[default] sweep scheduler disabled (DEFAULT_SWEEP_ENABLED != true)');
    return;
  }
  const expr = process.env.DEFAULT_SWEEP_CRON ?? '0 5 * * 1'; // Monday 05:00, after payouts
  if (!cron.validate(expr)) {
    console.error(`[default] invalid cron expression "${expr}" — scheduler not started`);
    return;
  }
  cron.schedule(expr, () => {
    runDefaultSweepOnce().catch((err) => console.error('[default] sweep tick failed:', err?.message ?? err));
  });
  console.log(`[default] sweep scheduler started with cron "${expr}"`);
}

export function startCohortScheduler() {  const enabled = (process.env.COHORT_PAYOUT_ENABLED ?? 'true').toLowerCase() === 'true';
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
