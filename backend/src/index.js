import { createApp } from './app.js';
import { env } from './config/env.js';
import { prisma } from './lib/prisma.js';
import seed from './seed-runner.js';
import { startServiceChargeScheduler, startCohortScheduler } from './lib/scheduler.js';
import { startNotificationScheduler } from './lib/notifications.js';

// SAFETY: application startup NEVER touches the database schema.
//
// No `prisma db push`, `--force-reset`, or `--accept-data-loss` is ever run
// from this process. Schema changes are applied explicitly during deployment
// (see README "Database deployment"). If the schema is out of sync the app
// still boots and reports database errors on individual requests; it never
// attempts to modify or reset production data.

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
  console.error(`[${name}]`, err?.message ?? err);
}

// Fatal failures exit so Render restarts the process; transient DB errors are
// logged and the process keeps running (Prisma reconnects lazily).
function handleFatal(name, err) {
  if (isTransientDbError(err)) {
    logFatal(`${name} (transient, ignored)`, err);
    return;
  }
  logFatal(`${name} (fatal) — exiting`, err);
  process.exit(1);
}

const app = createApp();

const server = app.listen(env.port, () => {
  console.log(`LaaniPay API listening on http://localhost:${env.port}`);
});

// Boot-time seed (safely creates reference data + the admin account once). A
// genuine failure must stop the process so it is not left partially configured;
// transient DB errors are allowed to recover.
seed()
  .then(() => console.log('[seed] Done'))
  .catch((err) => handleFatal('seed', err));

startServiceChargeScheduler();
startCohortScheduler();
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
