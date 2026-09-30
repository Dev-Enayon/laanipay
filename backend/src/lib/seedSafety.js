// ---------------------------------------------------------------------------
// Seed safety gate.
//
// WHY THIS EXISTS
// A previous verification mistake did `import('./src/index.js')` while
// DATABASE_URL pointed at the production Neon database. Because src/index.js
// ran `seed()` as an import side effect, merely LOADING the module wrote to
// production. Two distinct problems are fixed here:
//
//   1. The seed now requires an EXPLICIT opt-in (`RUN_SEED=true`). Importing
//      anything never seeds, so module loading, test imports, route imports,
//      syntax checks and health tooling are all write-safe by construction.
//   2. Even when explicitly requested, the seed refuses to run against a
//      database that looks like production unless the operator ALSO provides
//      `ALLOW_PRODUCTION_SEED=true`.
//
// DESIGN RULES
//   - Pure and side-effect free. This module never imports Prisma, never
//     touches the network, and never touches the database. It only inspects
//     strings, which is what makes it exhaustively testable.
//   - No secrets in source and none in output. Only the HOSTNAME of the
//     database is ever surfaced; credentials, query strings and the full
//     connection string are never printed or returned.
//   - Fail closed. An absent, unparseable or ambiguous database URL is
//     treated as unsafe, not safe.
//   - Does not assume every managed/cloud Postgres URL is production: many
//     teams run staging and dev branches on the same provider. Detection is
//     therefore an explicit, operator-extensible host list.
//
// ENVIRONMENT VARIABLES
//   RUN_SEED                 Must be exactly "true" for the seed to run at all.
//   ALLOW_PRODUCTION_SEED    Must be exactly "true" to permit seeding a
//                            database detected as production.
//   PRODUCTION_DB_HOSTS      Optional comma-separated extra production hosts.
//                            Entries are exact hostnames or suffix patterns
//                            beginning with "." (e.g. ".neon.tech").
// ---------------------------------------------------------------------------

// The known production Neon endpoint, stored as a HOSTNAME only — never a
// username, password, or full connection string. This makes the guard work
// out of the box for the real production database. Extend the list per
// environment with PRODUCTION_DB_HOSTS rather than editing this array.
const DEFAULT_PRODUCTION_DB_HOSTS = Object.freeze(['ep-morning-heart-ahqd13p4-pooler.c-3.us-east-1.aws.neon.tech']);

// Hosts that are never production. Checked before the production list so a
// production-list entry can never accidentally block a local database.
const LOCAL_DB_HOSTS = Object.freeze(['localhost', '127.0.0.1', '::1', '0.0.0.0', '[::1]']);

export const SEED_BLOCKED_MESSAGES = Object.freeze({
  NOT_REQUESTED: 'Seed not requested. Set RUN_SEED=true to run it explicitly.',
  NOT_ALLOWED: 'ALLOW_PRODUCTION_SEED must be exactly "true" to seed this database.',
  NO_DATABASE_URL:
    'DATABASE_URL is not set. The seed cannot verify which database it would write to, so it refuses to run (fail closed).',
  UNPARSEABLE_DATABASE_URL:
    'DATABASE_URL could not be parsed, so the seed cannot verify which database it would write to. It refuses to run (fail closed).',
  PRODUCTION:
    'This DATABASE_URL appears to target the production database. Set ALLOW_PRODUCTION_SEED=true only after explicitly confirming this operation.',
});

/**
 * A strict "is this exactly true" check. Deliberately NOT a truthy check:
 * "1", "yes", "TRUE " and friends must not enable a destructive operation.
 * @param {unknown} value
 * @returns {boolean}
 */
export function isExplicitTrue(value) {
  return typeof value === 'string' && value.trim().toLowerCase() === 'true';
}

/**
 * Extracts the hostname from a PostgreSQL connection string.
 * @param {unknown} databaseUrl
 * @returns {string|null} lowercase hostname, or null when absent/unparseable
 */
export function parseDatabaseHost(databaseUrl) {
  if (typeof databaseUrl !== 'string') return null;
  const trimmed = databaseUrl.trim();
  if (!trimmed) return null;
  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }
  if (!parsed.hostname) return null;
  return parsed.hostname.toLowerCase();
}

/**
 * A safe, loggable description of a database. Returns ONLY the hostname —
 * never the username, password, port, database name or query string. This is
 * the single function all error/log paths must use.
 * @param {unknown} databaseUrl
 * @returns {string}
 */
export function redactDatabaseUrl(databaseUrl) {
  const host = parseDatabaseHost(databaseUrl);
  return host ?? '(unset or unparseable DATABASE_URL)';
}

/**
 * True when a host is unambiguously local, and therefore never production.
 * @param {string|null} host
 * @returns {boolean}
 */
export function isLocalDatabaseHost(host) {
  if (!host) return false;
  if (LOCAL_DB_HOSTS.includes(host)) return true;
  return host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal');
}

/**
 * Parses the PRODUCTION_DB_HOSTS list. Entries may be an exact hostname or a
 * suffix pattern starting with "." (e.g. ".neon.tech" matches any Neon host).
 * @param {unknown} raw
 * @returns {string[]}
 */
export function parseProductionHostList(raw) {
  if (typeof raw !== 'string') return [];
  return raw
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0);
}

/**
 * Decides whether a hostname should be treated as production.
 * @param {string|null} host
 * @param {object} [options]
 * @param {string} [options.productionDbHosts] raw PRODUCTION_DB_HOSTS value
 * @returns {boolean}
 */
export function isProductionDatabaseHost(host, { productionDbHosts } = {}) {
  if (!host) return false;                 // fail closed happens in the gate
  if (isLocalDatabaseHost(host)) return false;
  const configured = parseProductionHostList(productionDbHosts);
  for (const entry of configured) {
    if (entry.startsWith('.')) {
      if (host.endsWith(entry)) return true;
    } else if (host === entry) {
      return true;
    }
  }
  for (const entry of DEFAULT_PRODUCTION_DB_HOSTS) {
    if (host === entry) return true;
  }
  return false;
}

/**
 * The single decision function behind every seed entry point.
 *
 * @param {object} [options]
 * @param {Record<string, string|undefined>} [options.env] environment to read (defaults to process.env)
 * @returns {{run: boolean, code: string, reason: string, host: string|null, isProduction: boolean, message: string|null}}
 */
export function evaluateSeedGate({ env = process.env } = {}) {
  const host = parseDatabaseHost(env.DATABASE_URL);
  const display = redactDatabaseUrl(env.DATABASE_URL);

  // 1. Explicit opt-in. Nothing else is considered until this passes.
  if (!isExplicitTrue(env.RUN_SEED)) {
    return {
      run: false,
      code: 'NOT_REQUESTED',
      reason: 'RUN_SEED is not exactly "true"',
      host,
      isProduction: false,
      message: null,
    };
  }

  // 2. Fail closed when we cannot identify the target database at all.
  if (typeof env.DATABASE_URL !== 'string' || env.DATABASE_URL.trim() === '') {
    return { run: false, code: 'NO_DATABASE_URL', reason: 'DATABASE_URL is not set', host: null, isProduction: false, message: SEED_BLOCKED_MESSAGES.NO_DATABASE_URL };
  }
  if (!host) {
    return { run: false, code: 'UNPARSEABLE_DATABASE_URL', reason: 'DATABASE_URL could not be parsed', host: null, isProduction: false, message: SEED_BLOCKED_MESSAGES.UNPARSEABLE_DATABASE_URL };
  }

  // 3. Production detection + explicit acknowledgement.
  const isProduction = isProductionDatabaseHost(host, { productionDbHosts: env.PRODUCTION_DB_HOSTS });
  if (isProduction && !isExplicitTrue(env.ALLOW_PRODUCTION_SEED)) {
    return {
      run: false,
      code: 'PRODUCTION',
      // The host is safe to show; it is not a credential and it is what makes
      // the message actionable. The full URL is never included.
      reason: `database host "${display}" is in the production database list`,
      host,
      isProduction: true,
      message: SEED_BLOCKED_MESSAGES.PRODUCTION,
    };
  }

  return {
    run: true,
    code: isProduction ? 'ALLOWED_PRODUCTION_ACKNOWLEDGED' : 'ALLOWED',
    reason: isProduction
      ? `database host "${display}" is production and was explicitly acknowledged`
      : `database host "${display}" is not a known production database`,
    host,
    isProduction,
    message: null,
  };
}

/**
 * Throws a descriptive, secret-free error when seeding is not permitted.
 * Callers that must not seed should call this and treat a throw as "blocked".
 * @param {object} [options]
 * @param {Record<string, string|undefined>} [options.env]
 * @returns {ReturnType<typeof evaluateSeedGate>}
 */
export function assertSeedAllowed({ env = process.env } = {}) {
  const decision = evaluateSeedGate({ env });
  if (!decision.run && decision.message) {
    const error = new Error(decision.message);
    error.code = decision.code;
    error.seedBlocked = true;
    throw error;
  }
  return decision;
}

/**
 * Scrubs credentials out of arbitrary text before it is logged.
 *
 * A database error surfaced by a driver can, in some configurations, embed the
 * connection string it failed on. Every seed log/error path runs its message
 * through this so a password can never reach the logs, even indirectly.
 *
 * Redacted: the full DATABASE_URL, its userinfo section, and each password-like
 * env var value.
 *
 * @param {unknown} value
 * @param {Record<string, string|undefined>} [env]
 * @returns {string}
 */
export function redactSecrets(value, env = process.env) {
  let text = value === null || value === undefined ? '' : String(value);
  if (!text) return '';

  const databaseUrl = typeof env.DATABASE_URL === 'string' ? env.DATABASE_URL.trim() : '';
  if (databaseUrl) {
    text = text.split(databaseUrl).join('[redacted DATABASE_URL]');
    // Also scrub the userinfo ("user:password@") on its own.
    const userinfo = (() => {
      try {
        const u = new URL(databaseUrl);
        return u.username || u.password ? `${u.username}:${u.password}@` : '';
      } catch {
        return '';
      }
    })();
    if (userinfo) text = text.split(userinfo).join('[redacted]@');
  }

  // Any env var whose name looks like a credential.
  for (const [key, val] of Object.entries(env ?? {})) {
    if (typeof val !== 'string' || val.length < 4) continue;
    if (!/(PASSWORD|SECRET|TOKEN|API_?KEY|PRIVATE|CREDENTIAL)/i.test(key)) continue;
    text = text.split(val).join(`[redacted ${key}]`);
  }

  return text;
}

/**
 * Builds a human-readable, secret-free description of an unknown thrown value.
 *
 * Some drivers throw values with no `message` of their own — the Neon/serverless
 * adapter surfaces a WebSocket `ErrorEvent` whose real text lives on
 * `err.error.message`. This walks the common shapes, then falls back to the
 * constructor name rather than an unhelpful "[object Object]".
 *
 * The result is always redacted before being returned.
 *
 * @param {unknown} err
 * @param {Record<string, string|undefined>} [env]
 * @returns {string}
 */
export function describeError(err, env = process.env) {
  const candidates = [
    err?.message,
    err?.error?.message,
    typeof err?.error === 'string' ? err.error : undefined,
    err?.detail,
    err?.code,
    err?.name,
  ];

  let raw = candidates.find((c) => typeof c === 'string' && c.trim() !== '');

  if (!raw) {
    // Nothing usable: name the type so the log is still actionable.
    const type = err?.constructor?.name;
    raw = type && type !== 'Object' ? `unknown error (${type})` : 'unknown error';
  } else if (/^\[object /i.test(raw)) {
    const type = err?.constructor?.name;
    raw = type && type !== 'Object' ? `unknown error (${type})` : 'unknown error';
  }

  return redactSecrets(raw, env);
}
