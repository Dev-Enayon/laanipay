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

let running = false;

export async function runMonthlyChargeOnce(billingMonth) {
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
