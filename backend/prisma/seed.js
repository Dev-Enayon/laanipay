import 'dotenv/config';

// ---------------------------------------------------------------------------
// Dedicated seed command: `npm run seed`.
//
// This file is the CLI entry point ONLY. The seed implementation lives in
// src/seed-runner.js so there is exactly ONE seed implementation (the previous
// setup had two near-identical copies that had to be kept in sync manually).
//
// The seed is a deliberate, operator-initiated write. It is gated by the same
// safety rules as any other seed entry point:
//
//   RUN_SEED=true                       required, otherwise the seed is skipped
//   ALLOW_PRODUCTION_SEED=true          additionally required when DATABASE_URL
//                                       is detected as the production database
//
// The safety gate is evaluated BEFORE anything is imported that could open a
// database connection, so a blocked or unrequested seed is completely inert.
//
// SAFETY: the seed never generates, logs or prints a password. An admin
// account is created ONLY when ADMIN_PASSWORD is an explicit env var of >= 8
// characters. Existing accounts are NEVER modified: password, role, status and
// email verification are left exactly as they are.
// ---------------------------------------------------------------------------

import { evaluateSeedGate, describeError } from '../src/lib/seedSafety.js';

const decision = evaluateSeedGate();

if (!decision.run) {
  if (decision.message) {
    // Blocked is an ERROR, not a no-op: the operator asked for a seed and it
    // was refused. Exit non-zero so a script or deploy step cannot mistake this
    // for a successful seed.
    console.error(`Seed blocked: ${decision.message}`);
    console.error(`Reason: ${decision.reason}`);
    process.exit(1);
  }
  // Not requested at all — a normal no-op.
  console.log(`Seed skipped: ${decision.reason}`);
  console.log('To seed explicitly, re-run with RUN_SEED=true.');
  process.exit(0);
}

console.log(`Seed starting: ${decision.reason}`);

// The imports are inside the try so a module-load failure is reported through
// the same redacted path as a seed failure, instead of an unhandled rejection
// that would print a raw stack trace.
let prisma = null;
try {
  const [{ default: seed }, prismaModule] = await Promise.all([
    import('../src/seed-runner.js'),
    import('../src/lib/prisma.js'),
  ]);
  prisma = prismaModule.prisma;

  await seed();
  console.log('Seed complete');
  await prisma.$disconnect();
  process.exit(0);
} catch (err) {
  // Redacted: a driver failure can embed the connection string it failed on, so
  // only name/code/message are surfaced, and those are scrubbed.
  console.error('Seed failed:', describeError(err));
  if (prisma) {
    try {
      await prisma.$disconnect();
    } catch {
      // Already failing; the original error is the one that matters.
    }
  }
  process.exit(1);
}
