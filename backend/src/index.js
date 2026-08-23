import { execSync } from 'node:child_process';
import { createApp } from './app.js';
import { env } from './config/env.js';
import { prisma } from './lib/prisma.js';
import seed from './seed-runner.js';

if (env.nodeEnv === 'production' && env.databaseUrl) {
  try {
    console.log('[db] Generating Prisma client…');
    execSync('npx prisma generate', { stdio: 'inherit', timeout: 60_000 });
    console.log('[db] Pushing schema to database…');
    execSync('npx prisma db push --accept-data-loss', { stdio: 'inherit', timeout: 120_000 });
    console.log('[db] Schema synced');
  } catch (err) {
    console.error('[db] Schema sync failed:', err.message);
  }
}

const app = createApp();

const server = app.listen(env.port, () => {
  console.log(`LaaniPay API listening on http://localhost:${env.port}`);
});

seed()
  .then(() => console.log('[seed] Done'))
  .catch((err) => console.error('[seed] Failed:', err.message ?? err));

// The Neon serverless driver can emit unhandled WebSocket 'error' events on
// transient network hiccups. Node treats those as fatal by default and kills
// the process. Log them instead and keep serving — Prisma reconnects lazily.
// Anything that is NOT a recognized connection hiccup is genuinely fatal:
// log it and exit(1) so the platform restarts a corrupted process.
function logFatal(name, err) {
  console.error(`[${name}]`, err?.message ?? err);
}

const TRANSIENT_DB_ERROR = /websocket|econnreset|econnrefused|etimedout|epipe|connection (closed|terminated|reset)|network error|fetch failed/i;

function isTransientDbError(err) {
  return TRANSIENT_DB_ERROR.test(`${err?.message ?? err} ${err?.code ?? ''}`);
}

process.on('uncaughtException', (err) => {
  if (isTransientDbError(err)) return logFatal('uncaughtException (transient, ignored)', err);
  logFatal('uncaughtException (fatal) — exiting', err);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  if (isTransientDbError(reason)) return logFatal('unhandledRejection (transient, ignored)', reason);
  logFatal('unhandledRejection (fatal) — exiting', reason);
  process.exit(1);
});

async function shutdown() {
  console.log('\nShutting down...');
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
