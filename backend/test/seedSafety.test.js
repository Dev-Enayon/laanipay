// Regression tests for the production-write footgun.
//
// INCIDENT: a verification step did `import('./src/index.js')` while
// DATABASE_URL pointed at the production Neon database. Because src/index.js
// ran `seed()` as an import side effect, merely LOADING the module created
// platform_setting rows in production. These tests lock in the fix.
//
// Nothing here touches a database or the network. The gate is a pure function
// so it can be tested exhaustively; the import-safety test spawns real child
// processes to prove the module graph is write-free.
//
// SAFETY: no test in this file may ever connect to a database. Seed execution
// is proved via an injected stub, never a real run.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  isExplicitTrue,
  parseDatabaseHost,
  redactDatabaseUrl,
  redactSecrets,
  describeError,
  isLocalDatabaseHost,
  isProductionDatabaseHost,
  parseProductionHostList,
  evaluateSeedGate,
  assertSeedAllowed,
  SEED_BLOCKED_MESSAGES,
} from '../src/lib/seedSafety.js';
import { maybeRunSeed } from '../src/server.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(here, '..');

const PRODUCTION_HOST = 'ep-morning-heart-ahqd13p4-pooler.c-3.us-east-1.aws.neon.tech';
// Distinctive marker used to prove credentials are never leaked into output.
const SECRET_MARKER = 'sup3rs3cret-do-not-log';

const prodUrl = (password = SECRET_MARKER) =>
  `postgresql://neondb_owner:${password}@${PRODUCTION_HOST}/neondb?sslmode=require`;

const localUrl = 'postgresql://postgres:postgres@localhost:5432/laanipay_test';

// ===========================================================================
// A + B + C + D + E + F — the gate decision matrix
// ===========================================================================

describe('seed gate: explicit opt-in', () => {
  // B. RUN_SEED absent -> no seed.
  test('B: RUN_SEED absent does not run the seed', () => {
    const decision = evaluateSeedGate({ env: { DATABASE_URL: localUrl } });
    assert.equal(decision.run, false);
    assert.equal(decision.code, 'NOT_REQUESTED');
    assert.equal(decision.message, null, 'not being requested is not an error condition');
  });

  // C. RUN_SEED=false (and other non-"true" spellings) -> no seed.
  for (const value of ['false', 'FALSE', '0', '', 'yes', '1', 'on', 'truthy', 'tru', undefined]) {
    test(`C: RUN_SEED=${JSON.stringify(value)} does not run the seed`, () => {
      const decision = evaluateSeedGate({ env: { RUN_SEED: value, DATABASE_URL: localUrl } });
      assert.equal(decision.run, false, `RUN_SEED=${JSON.stringify(value)} must not enable the seed`);
      assert.equal(decision.code, 'NOT_REQUESTED');
    });
  }

  // D. RUN_SEED=true against an allowed database -> seed runs.
  test('D: RUN_SEED=true runs the seed against a non-production database', () => {
    const decision = evaluateSeedGate({ env: { RUN_SEED: 'true', DATABASE_URL: localUrl } });
    assert.equal(decision.run, true);
    assert.equal(decision.code, 'ALLOWED');
    assert.equal(decision.isProduction, false);
    assert.equal(decision.message, null);
  });

  test('D: RUN_SEED=TRUE is accepted (case/whitespace insensitive)', () => {
    for (const value of ['true', 'TRUE', 'True', ' true ', '\ttrue\n']) {
      assert.equal(evaluateSeedGate({ env: { RUN_SEED: value, DATABASE_URL: localUrl } }).run, true, `RUN_SEED=${JSON.stringify(value)}`);
    }
    assert.equal(isExplicitTrue('true'), true);
    assert.equal(isExplicitTrue('yes'), false);
    assert.equal(isExplicitTrue(undefined), false);
    assert.equal(isExplicitTrue(1), false, 'non-strings are never true');
  });
});

describe('seed gate: production protection', () => {
  // E. Production-looking DB without acknowledgement -> refused.
  test('E: RUN_SEED=true against production WITHOUT acknowledgement refuses to seed', () => {
    const decision = evaluateSeedGate({ env: { RUN_SEED: 'true', DATABASE_URL: prodUrl() } });
    assert.equal(decision.run, false, 'the seed must be refused');
    assert.equal(decision.code, 'PRODUCTION');
    assert.equal(decision.isProduction, true);
    assert.equal(decision.message, SEED_BLOCKED_MESSAGES.PRODUCTION);
    assert.match(decision.message, /ALLOW_PRODUCTION_SEED=true/);
  });

  // F. Production-looking DB with acknowledgement -> allowed.
  test('F: RUN_SEED=true + ALLOW_PRODUCTION_SEED=true allows seeding production', () => {
    const decision = evaluateSeedGate({
      env: { RUN_SEED: 'true', ALLOW_PRODUCTION_SEED: 'true', DATABASE_URL: prodUrl() },
    });
    assert.equal(decision.run, true);
    assert.equal(decision.code, 'ALLOWED_PRODUCTION_ACKNOWLEDGED');
    assert.equal(decision.isProduction, true);
  });

  test('ALLOW_PRODUCTION_SEED is ignored unless it is exactly "true"', () => {
    for (const value of ['false', '1', 'yes', 'allow', '', undefined]) {
      const decision = evaluateSeedGate({
        env: { RUN_SEED: 'true', ALLOW_PRODUCTION_SEED: value, DATABASE_URL: prodUrl() },
      });
      assert.equal(decision.run, false, `ALLOW_PRODUCTION_SEED=${JSON.stringify(value)} must not permit production seeding`);
      assert.equal(decision.code, 'PRODUCTION');
    }
  });

  test('acknowledgement alone does not enable the seed (RUN_SEED still required)', () => {
    const decision = evaluateSeedGate({ env: { ALLOW_PRODUCTION_SEED: 'true', DATABASE_URL: prodUrl() } });
    assert.equal(decision.run, false, 'ALLOW_PRODUCTION_SEED must never imply RUN_SEED');
    assert.equal(decision.code, 'NOT_REQUESTED');
  });

  test('does not assume every cloud URL is production (staging branch is allowed)', () => {
    const staging = 'postgresql://u:p@ep-cool-branch-123456.c-3.us-east-1.aws.neon.tech/neondb';
    const decision = evaluateSeedGate({ env: { RUN_SEED: 'true', DATABASE_URL: staging } });
    assert.equal(decision.run, true, 'an unlisted Neon branch must not be treated as production');
    assert.equal(decision.isProduction, false);
  });

  test('PRODUCTION_DB_HOSTS extends detection with exact hosts and .suffix patterns', () => {
    const custom = 'postgresql://u:p@db.internal.example.com:5432/app';
    assert.equal(evaluateSeedGate({ env: { RUN_SEED: 'true', DATABASE_URL: custom } }).run, true, 'unlisted by default');

    const exact = evaluateSeedGate({
      env: { RUN_SEED: 'true', DATABASE_URL: custom, PRODUCTION_DB_HOSTS: 'db.internal.example.com' },
    });
    assert.equal(exact.run, false, 'exact host match blocks');
    assert.equal(exact.code, 'PRODUCTION');

    const suffix = evaluateSeedGate({
      env: { RUN_SEED: 'true', DATABASE_URL: 'postgresql://u:p@x.eu.neon.tech/app', PRODUCTION_DB_HOSTS: '.neon.tech' },
    });
    assert.equal(suffix.run, false, 'suffix pattern blocks');
    assert.equal(suffix.code, 'PRODUCTION');

    assert.deepEqual(parseProductionHostList(' A.com , .b.com ,, '), ['a.com', '.b.com']);
    assert.deepEqual(parseProductionHostList(undefined), []);
  });
});

describe('seed gate: fails closed', () => {
  test('RUN_SEED=true with no DATABASE_URL refuses to run', () => {
    const decision = evaluateSeedGate({ env: { RUN_SEED: 'true' } });
    assert.equal(decision.run, false);
    assert.equal(decision.code, 'NO_DATABASE_URL');
    assert.equal(decision.message, SEED_BLOCKED_MESSAGES.NO_DATABASE_URL);
  });

  test('RUN_SEED=true with an unparseable DATABASE_URL refuses to run', () => {
    for (const bad of ['', '   ', 'not a url', '://missing-scheme', 'postgres://']) {
      const decision = evaluateSeedGate({ env: { RUN_SEED: 'true', DATABASE_URL: bad } });
      assert.equal(decision.run, false, `DATABASE_URL=${JSON.stringify(bad)} must fail closed`);
      assert.ok(['NO_DATABASE_URL', 'UNPARSEABLE_DATABASE_URL'].includes(decision.code));
    }
  });

  test('assertSeedAllowed throws a coded, secret-free error when blocked', () => {
    assert.throws(
      () => assertSeedAllowed({ env: { RUN_SEED: 'true', DATABASE_URL: prodUrl() } }),
      (err) => {
        assert.equal(err.seedBlocked, true);
        assert.equal(err.code, 'PRODUCTION');
        assert.match(err.message, /production database/);
        return true;
      },
    );
    // Allowed case returns the decision instead of throwing.
    const ok = assertSeedAllowed({ env: { RUN_SEED: 'true', DATABASE_URL: localUrl } });
    assert.equal(ok.run, true);
  });
});

// ===========================================================================
// G — secrets are never printed
// ===========================================================================

describe('secret redaction', () => {
  test('G: the password never appears in any gate output', () => {
    const url = prodUrl(SECRET_MARKER);
    const decision = evaluateSeedGate({ env: { RUN_SEED: 'true', DATABASE_URL: url } });
    const haystack = [decision.message, decision.reason, decision.code, decision.host, JSON.stringify(decision)].join(' | ');
    assert.ok(!haystack.includes(SECRET_MARKER), `password leaked into: ${haystack}`);
    assert.ok(!haystack.includes('neondb_owner'), 'username must not be surfaced');
    assert.ok(!haystack.includes('sslmode'), 'query string must not be surfaced');
  });

  test('G: the blocked error thrown to the operator contains no credentials', () => {
    let thrown = null;
    try {
      assertSeedAllowed({ env: { RUN_SEED: 'true', DATABASE_URL: prodUrl(SECRET_MARKER) } });
    } catch (err) {
      thrown = err;
    }
    assert.ok(thrown, 'expected the seed to be blocked');
    assert.ok(!thrown.message.includes(SECRET_MARKER), 'password leaked into the error message');
    assert.ok(!thrown.message.includes('postgresql://'), 'full connection string leaked into the error message');
  });

  test('G: the acknowledgement-allowed path also stays secret-free', () => {
    const decision = evaluateSeedGate({
      env: { RUN_SEED: 'true', ALLOW_PRODUCTION_SEED: 'true', DATABASE_URL: prodUrl(SECRET_MARKER) },
    });
    assert.ok(!decision.reason.includes(SECRET_MARKER));
    assert.ok(!decision.reason.includes('neondb_owner'));
  });

  test('G: redactDatabaseUrl returns only the hostname', () => {
    assert.equal(redactDatabaseUrl(prodUrl()), PRODUCTION_HOST);
    assert.equal(redactDatabaseUrl(localUrl), 'localhost');
    assert.equal(redactDatabaseUrl(''), '(unset or unparseable DATABASE_URL)');
    assert.equal(redactDatabaseUrl(undefined), '(unset or unparseable DATABASE_URL)');
    assert.equal(redactDatabaseUrl('garbage'), '(unset or unparseable DATABASE_URL)');
  });

  test('G: redactSecrets scrubs a connection string embedded in a driver error', () => {
    const env = { DATABASE_URL: prodUrl(SECRET_MARKER) };
    // Simulates a driver error that quotes the URL it failed on.
    const driverError = `P1001: Cannot reach database server at ${env.DATABASE_URL}`;
    const out = redactSecrets(driverError, env);
    assert.ok(!out.includes(SECRET_MARKER), 'password leaked');
    assert.ok(!out.includes('neondb_owner'), 'username leaked');
    assert.ok(!out.includes('postgresql://'), 'connection string leaked');
    assert.match(out, /\[redacted DATABASE_URL\]/);
    assert.match(out, /P1001/, 'useful context is preserved');
  });

  test('G: redactSecrets scrubs credential-shaped env values from messages', () => {
    const env = {
      DATABASE_URL: localUrl,
      ADMIN_PASSWORD: 'hunter2-super-secret',
      JWT_ACCESS_SECRET: 'another-secret-value',
    };
    const out = redactSecrets('failed using hunter2-super-secret and another-secret-value', env);
    assert.ok(!out.includes('hunter2-super-secret'));
    assert.ok(!out.includes('another-secret-value'));
    assert.match(out, /\[redacted ADMIN_PASSWORD\]/);
    assert.match(out, /\[redacted JWT_ACCESS_SECRET\]/);
  });

  test('G: redactSecrets leaves non-secret text intact and tolerates empties', () => {
    const env = { DATABASE_URL: localUrl };
    assert.equal(redactSecrets('Seed failed: connection refused', env), 'Seed failed: connection refused');
    assert.equal(redactSecrets('', env), '');
    assert.equal(redactSecrets(undefined, env), '');
    assert.equal(redactSecrets(null, {}), '');
    // A 3-char value is too short to redact safely (would mangle real text).
    assert.equal(redactSecrets('abc', { SOME_PASSWORD: 'abc' }), 'abc');
  });

  test('G: describeError names the type when a driver throws a message-less event', () => {
    const env = { DATABASE_URL: localUrl };
    // The Neon/serverless adapter surfaces a WebSocket Event with no `message`
    // of its own and a "[object X]" stringification. Named class so the
    // constructor name is realistic.
    class ErrorEvent {}
    assert.equal(describeError(new ErrorEvent(), env), 'unknown error (ErrorEvent)');
    assert.equal(describeError({}, env), 'unknown error');
    assert.equal(describeError(undefined, env), 'unknown error');
    assert.equal(describeError({ constructor: { name: 'Object' } }, env), 'unknown error');
    // An object that stringifies to "[object Object]" must not leak through.
    assert.equal(describeError(Object.create(null), env), 'unknown error');
  });

  test('G: describeError prefers a real message and still redacts it', () => {
    const env = { DATABASE_URL: prodUrl(SECRET_MARKER) };
    assert.equal(describeError(new Error('plain failure'), env), 'plain failure');
    // Nested driver error text is picked up...
    assert.equal(describeError({ error: { message: 'socket hang up' } }, env), 'socket hang up');
    assert.equal(describeError({ code: 'ECONNREFUSED' }, env), 'ECONNREFUSED');
    // ...and a nested message containing the password is scrubbed.
    const out = describeError({ error: { message: `connect failed for ${env.DATABASE_URL}` } }, env);
    assert.ok(!out.includes(SECRET_MARKER), 'password leaked through a nested driver message');
    assert.ok(!out.includes('neondb_owner'), 'username leaked through a nested driver message');
  });
});

describe('host helpers', () => {
  test('parseDatabaseHost lowercases and tolerates ports/params', () => {
    assert.equal(parseDatabaseHost(localUrl), 'localhost');
    assert.equal(parseDatabaseHost('postgresql://U:P@DB.Example.COM:5432/app?x=1'), 'db.example.com');
    assert.equal(parseDatabaseHost(null), null);
    assert.equal(parseDatabaseHost(42), null);
  });

  test('isLocalDatabaseHost never treats local hosts as production', () => {
    for (const host of ['localhost', '127.0.0.1', '::1', '0.0.0.0', 'db.local', 'app.localhost', 'svc.internal']) {
      assert.equal(isLocalDatabaseHost(host), true, host);
    }
    assert.equal(isLocalDatabaseHost('db.example.com'), false);
    assert.equal(isLocalDatabaseHost(null), false);
  });

  test('a production-list entry can never block a local database', () => {
    // Even if an operator mistakenly lists localhost, local still wins.
    assert.equal(
      isProductionDatabaseHost('localhost', { productionDbHosts: 'localhost' }),
      false,
    );
    assert.equal(isProductionDatabaseHost('localhost', { productionDbHosts: '.localhost' }), false);
  });
});

// ===========================================================================
// maybeRunSeed — the actual guard used by startup
// ===========================================================================

describe('maybeRunSeed executes the real guard, not a copy', () => {
  test('RUN_SEED absent -> the injected seed stub is never called', async () => {
    let calls = 0;
    const result = await maybeRunSeed({ env: { DATABASE_URL: localUrl }, runSeed: async () => { calls += 1; } });
    assert.equal(calls, 0);
    assert.equal(result.executed, false);
    assert.equal(result.code, 'NOT_REQUESTED');
  });

  test('RUN_SEED=false -> the seed stub is never called', async () => {
    let calls = 0;
    const result = await maybeRunSeed({ env: { RUN_SEED: 'false', DATABASE_URL: localUrl }, runSeed: async () => { calls += 1; } });
    assert.equal(calls, 0);
    assert.equal(result.executed, false);
  });

  test('RUN_SEED=true on an allowed database -> the seed stub is called exactly once', async () => {
    let calls = 0;
    const result = await maybeRunSeed({ env: { RUN_SEED: 'true', DATABASE_URL: localUrl }, runSeed: async () => { calls += 1; } });
    assert.equal(calls, 1, 'the seed must run exactly once');
    assert.equal(result.executed, true);
    assert.equal(result.code, 'ALLOWED');
  });

  test('production without acknowledgement -> the seed stub is never called', async () => {
    let calls = 0;
    const result = await maybeRunSeed({ env: { RUN_SEED: 'true', DATABASE_URL: prodUrl() }, runSeed: async () => { calls += 1; } });
    assert.equal(calls, 0, 'the seed must not run against production');
    assert.equal(result.executed, false);
    assert.equal(result.code, 'PRODUCTION');
    assert.equal(result.message, SEED_BLOCKED_MESSAGES.PRODUCTION);
  });

  test('production WITH acknowledgement -> the seed stub is called exactly once', async () => {
    let calls = 0;
    const result = await maybeRunSeed({
      env: { RUN_SEED: 'true', ALLOW_PRODUCTION_SEED: 'true', DATABASE_URL: prodUrl() },
      runSeed: async () => { calls += 1; },
    });
    assert.equal(calls, 1);
    assert.equal(result.executed, true);
    assert.equal(result.code, 'ALLOWED_PRODUCTION_ACKNOWLEDGED');
  });

  test('a failing seed is reported, never thrown, and never claimed as executed', async () => {
    const result = await maybeRunSeed({
      env: { RUN_SEED: 'true', DATABASE_URL: localUrl },
      runSeed: async () => { throw new Error('simulated failure'); },
    });
    assert.equal(result.executed, false);
    assert.equal(result.code, 'SEED_FAILED');
  });
});

// ===========================================================================
// A — importing startup code performs no seed and starts no server
// ===========================================================================

describe('import safety of the startup module graph', () => {
  // Runs a child process so a module-level `import` genuinely happens, with
  // DATABASE_URL pointed at a production-LOOKING host. If any import ran the
  // seed, it would attempt a real production write.
  // Uses `spawn` rather than `execFile` because we need the real exit code,
  // and because a process that never exits is itself the failure signal: a
  // listening server or a node-cron interval keeps the event loop alive, so an
  // import that started either would hang here instead of passing.
  function runChildProcess(args, { env }) {
    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, args, { cwd: backendRoot, env });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (chunk) => { stdout += chunk; });
      child.stderr.on('data', (chunk) => { stderr += chunk; });
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        reject(new Error('importing process did not exit: a listener or scheduler probably kept it alive'));
      }, 20000);
      child.on('error', (err) => { clearTimeout(timer); reject(err); });
      child.on('close', (code, signal) => {
        clearTimeout(timer);
        resolve({ stdout, stderr, code, signal });
      });
    });
  }

  async function importStartupModule({ env = {}, entry = './src/index.js' } = {}) {
    const script = `await import(${JSON.stringify(entry)}); console.log('IMPORT_OK');`;
    const { stdout, stderr, code } = await runChildProcess(['--input-type=module', '-e', script], {
      env: {
        ...process.env,
        // Neutralise any real production URL from the ambient environment and
        // substitute a production-LOOKING one. The seed must still not run.
        DATABASE_URL: 'postgresql://neondb_owner:placeholder@ep-morning-heart-ahqd13p4-pooler.c-3.us-east-1.aws.neon.tech/neondb?sslmode=require',
        RUN_SEED: undefined,
        NODE_ENV: 'test',
        ...env,
      },
    });
    return { stdout, stderr, code, output: `${stdout}\n${stderr}` };
  }

  // K (no listener) + L (no scheduler) + A/G (no seed). Every banner the
  // startup path can emit is listed so a regression fails loudly.
  function assertImportInert({ output }) {
    assert.ok(!/listening on/i.test(output), 'importing must not start the HTTP listener');
    assert.ok(!/\[seed\] running/i.test(output), 'importing must not run the seed');
    assert.ok(!/\[seed\] Done/i.test(output), 'importing must not run the seed');
    assert.ok(!/Seed starting/i.test(output), 'importing must not run the seed');
    // L: none of the four startup schedulers may register. These tags are
    // only ever logged from inside the scheduler start functions and their
    // scheduled jobs, so any hit here proves a scheduler was initialised.
    assert.ok(
      !/\[(serviceCharge|cohort|notifications|default)\]/i.test(output),
      'importing must not start any scheduler (serviceCharge/cohort/notifications/default)',
    );
  }

  test('A: importing src/index.js does not seed and does not start a server', async () => {
    const result = await importStartupModule();
    assert.match(result.stdout, /IMPORT_OK/);
    assertImportInert(result);
  });

  test('A: importing src/server.js is also side-effect free', async () => {
    const result = await importStartupModule({ entry: './src/server.js' });
    assert.match(result.stdout, /IMPORT_OK/);
    assertImportInert(result);
  });

  test('A: importing src/seed-runner.js does not execute the seed', async () => {
    const result = await importStartupModule({ entry: './src/seed-runner.js' });
    assert.match(result.stdout, /IMPORT_OK/);
    assertImportInert(result);
  });

  test('A: importing src/lib/seedSafety.js opens no database connection', async () => {
    const result = await importStartupModule({ entry: './src/lib/seedSafety.js' });
    assert.match(result.stdout, /IMPORT_OK/);
    assertImportInert(result);
  });

  test('K: an importing process exits immediately (no listener/scheduler keeps it alive)', async () => {
    const result = await importStartupModule();
    assert.equal(result.code, 0, 'the importing process must exit cleanly on its own');
  });

  test('L: importing the entrypoint does not initialise any of the four schedulers', async () => {
    // Guards the regression that matters most: `startServiceChargeScheduler()`
    // and friends must stay inside startServer(). The cohort scheduler is
    // enabled by default, so an import-time start would be loud.
    const result = await importStartupModule();
    assert.ok(!/scheduler started/i.test(result.output));
    assert.ok(!/scheduler disabled/i.test(result.output));
  });

  test('A: the entrypoint guard does not seed even when RUN_SEED=true is set in the environment', async () => {
    // Import must still be inert: the opt-in only takes effect on real start.
    const result = await importStartupModule({
      env: { RUN_SEED: 'true', ALLOW_PRODUCTION_SEED: 'true' },
    });
    assert.match(result.stdout, /IMPORT_OK/);
    assertImportInert(result);
  });
});
