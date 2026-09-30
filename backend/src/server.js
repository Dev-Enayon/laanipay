import { createApp } from './app.js';
import { env } from './config/env.js';
import { prisma } from './lib/prisma.js';
import seed from './seed-runner.js';
import { evaluateSeedGate, describeError } from './lib/seedSafety.js';
import { startServiceChargeScheduler, startCohortScheduler, startDefaultScheduler } from './lib/scheduler.js';
import { startNotificationScheduler } from './lib/notifications.js';

// ---------------------------------------------------------------------------
// Real process startup lives here and ONLY here.
//
// SAFETY: importing this module has NO side effects. It does not listen on a
// port, does not start schedulers, and does not write to the database. Only an
// explicit call to `startServer()` performs startup, which keeps `import`,
// `require`, test collection, route imports and syntax checks write-safe.
//
// SAFETY: application startup NEVER touches the database schema. No
// `prisma db push`, `--force-reset` or `--accept-data-loss` is ever run from
// this process. Schema changes are applied explicitly during deployment (see
// README "Database deployment"). If the schema is out of sync the app still
// boots and reports database errors on individual requests.
//
// SAFETY: the seed does NOT run on boot. It requires RUN_SEED=true, and even
// then a database detected as production additionally requires
// ALLOW_PRODUCTION_SEED=true. This is deliberate: `startCommand: npm start`
// (see render.yaml) otherwise wrote reference data to production on every
// deploy and restart.
// ---------------------------------------------------------------------------

// The Neon serverless driver can emit unhandled WebSocket 'error' events on
// transient network hiccups. Node treats those as fatal by default and kills
// the process. Log them instead and keep serving — Prisma reconnects lazily.
// Anything that is NOT a recognized connection hiccup is genuinely fatal:
// log it and exit(1) so the platform restarts a corrupted process.
const TRANSIENT_DB_ERROR = /websocket|econnreset|econnrefused|etimedout|epipe|connection (closed|terminated|reset)|network error|fetch failed/i;

function isTransientDbError(err) {
  return TRANSIENT_DB_ERROR.test(`${err?.message ?? err} ${err?.code ?? ''}`);
}

function logFatal(name, err) {
  // Every fatal path is redacted: a driver error can embed the connection
  // string it failed on, and a password must never reach the logs.
  console.error(`[${name}]`, describeError(err));
}

// Fatal failures exit so Render restarts the process; transient DB errors are
// logged and the process keeps running (Prisma reconnects lazily).
export function handleFatal(name, err) {
  if (isTransientDbError(err)) {
    logFatal(`${name} (transient, ignored)`, err);
    return;
  }
  logFatal(`${name} (fatal) — exiting`, err);
  process.exit(1);
}

/**
 * Runs the seed ONLY when the safety gate permits it.
 *
 * Never throws: a blocked or failed seed must not take the API down, because
 * the API is a production service whose availability does not depend on
 * reference data. A blocked seed is reported loudly and skipped.
 *
 * @param {object} [options]
 * @param {Record<string, string|undefined>} [options.env]
 * @param {() => Promise<unknown>} [options.runSeed] injectable for tests
 * @returns {Promise<{executed: boolean, code: string, reason: string, message: string|null}>}
 */
export async function maybeRunSeed({ env: envSource = process.env, runSeed = seed } = {}) {
  const decision = evaluateSeedGate({ env: envSource });

  if (!decision.run) {
    if (decision.message) {
      // Blocked, or not requested with a message worth surfacing.
      console.error(`[seed] BLOCKED — ${decision.message}`);
      console.error(`[seed] reason: ${decision.reason}`);
    } else {
      // Not requested. One line so it is obvious the seed is opt-in rather
      // than broken, without adding noise on every request.
      console.log('[seed] skipped — set RUN_SEED=true to seed explicitly (see README)');
    }
    return { executed: false, code: decision.code, reason: decision.reason, message: decision.message };
  }

  console.log(`[seed] running — ${decision.reason}`);
  try {
    await runSeed();
    console.log('[seed] Done');
    return { executed: true, code: decision.code, reason: decision.reason, message: null };
  } catch (err) {
    // Redacted: a failed connection can carry the connection string.
    console.error('[seed] failed:', describeError(err, envSource));
    return { executed: false, code: 'SEED_FAILED', reason: 'seed threw', message: null };
  }
}

/**
 * Boots the API: HTTP listener, schedulers, process handlers and — only when
 * explicitly permitted — the seed. Calling this is the ONLY way startup
 * side effects happen.
 *
 * @param {object} [options]
 * @param {Record<string, string|undefined>} [options.env]
 * @returns {Promise<{server: import('node:http').Server, seedResult: object}>}
 */
export async function startServer({ env: envSource = process.env } = {}) {
  const app = createApp();

  const server = app.listen(env.port, () => {
    console.log(`LaaniPay API listening on http://localhost:${env.port}`);
  });

  // Seeding is opt-in and guarded; it never blocks the listener.
  const seedResult = await maybeRunSeed({ env: envSource });

  startServiceChargeScheduler();
  startCohortScheduler();
  startDefaultScheduler();
  startNotificationScheduler();

  process.on('uncaughtException', (err) => handleFatal('uncaughtException', err));
  process.on('unhandledRejection', (reason) => handleFatal('unhandledRejection', reason));

  async function shutdown() {
    console.log('\nShutting down...');
    server.close(async () => {
      await prisma.$disconnect();
      process.exit(0);
    });
  }

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  return { server, seedResult };
}
