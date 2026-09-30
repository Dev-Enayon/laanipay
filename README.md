# laanipay

Monorepo: `backend/` (Express + Prisma + Neon Postgres + Paystack) and
`frontend/` (React + Vite).

## Database & seeding safety

### Seeding is never automatic

The application does **not** seed on boot. `npm start` only starts the API, and
importing the application modules (tests, route imports, syntax checks, tooling)
performs no database writes at all.

```
npm start                  # boots the API, no seed
npm run seed               # skipped unless RUN_SEED=true
RUN_SEED=true npm run seed # seeds (still subject to the production guard)
```

There is a single seed implementation (`backend/src/seed-runner.js`);
`backend/prisma/seed.js` is only the CLI entry point for it.

### Production guard

Seeding is refused when `DATABASE_URL` is detected as the production database,
unless it is explicitly acknowledged:

```
RUN_SEED=true                        npm run seed   # runs
RUN_SEED=true                        npm run seed   # BLOCKED: looks like production
RUN_SEED=true ALLOW_PRODUCTION_SEED=true npm run seed   # runs
```

`RUN_SEED` and `ALLOW_PRODUCTION_SEED` must be exactly `true` — `1`, `yes` and
`on` are deliberately rejected. The guard fails closed: a missing or unparseable
`DATABASE_URL` refuses to run rather than assuming safety.

Detection does **not** assume every cloud Postgres URL is production (staging and
dev branches usually share a provider). The known production host is built in;
extend it with `PRODUCTION_DB_HOSTS` (comma-separated hostnames, a leading `.`
matches a suffix, e.g. `.neon.tech`). Unlisted hosts are treated as
non-production, so list your real production hosts explicitly.

Credentials are never logged. Error output is redacted so a connection string
embedded in a driver error cannot leak a password.

### Schema migrations

Schema changes are applied explicitly at deploy time, never from application
code:

```
npx prisma migrate deploy --schema prisma/schema.prisma
```

The application never runs `prisma db push`, `--force-reset` or
`--accept-data-loss`, and never modifies the schema at runtime.
