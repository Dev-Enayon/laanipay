import { createApp } from './app.js';
import { env } from './config/env.js';
import { prisma } from './lib/prisma.js';

const app = createApp();

const server = app.listen(env.port, () => {
  console.log(`LaaniPay API listening on http://localhost:${env.port}`);
});

// The Neon serverless driver can emit unhandled WebSocket 'error' events on
// transient network hiccups. Node treats those as fatal by default and kills
// the process. Log them instead and keep serving — Prisma reconnects lazily.
function logFatal(name, err) {
  console.error(`[${name}]`, err?.message ?? err);
}

process.on('uncaughtException', (err) => logFatal('uncaughtException', err));
process.on('unhandledRejection', (reason) => logFatal('unhandledRejection', reason));

async function shutdown() {
  console.log('\nShutting down...');
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
