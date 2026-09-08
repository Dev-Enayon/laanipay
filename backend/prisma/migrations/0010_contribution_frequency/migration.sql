-- Monthly + Weekly contribution coexistence migration.
--
-- Context: the original product was MONTHLY contributions (migrations 0001-0006
-- and the live production contribution_plans rows, whose monthly_amount values
-- are the real monthly rates: Starter 100000, Growth 500000, Premium 1000000,
-- Diamond 2000000). The weekly AJO model (0007-0009) treated every plan as
-- weekly and repurposed monthly_amount in the seed. This migration restores the
-- monthly model AND lets weekly co-exist as an additional frequency, without
-- converting or deleting anything.
--
-- This migration is purely ADDITIVE / IDEMPOTENT:
--   * It never drops, recreates, truncates or resets data. Every statement is
--     either ADD COLUMN, CREATE INDEX, DROP NOT NULL (a relaxation), or a
--     constraint swap between two unique indexes (no row data changes).
--   * No existing row is modified: contribution_plans values (monthly_amount
--     and any weekly_amount backfilled by 0009) are preserved exactly.
--   * Existing plans are defaulted to MONTHLY via the column default, so the
--     live production plans (and their subscriptions) remain monthly plans.
--   * Diamond Saver is preserved untouched.
--
-- What changes:
--   1. contribution_plans.frequency (TEXT, default 'MONTHLY'): the plan's
--      contribution frequency. MONTHLY plans use monthly_amount; WEEKLY plans
--      use weekly_amount. Existing rows become MONTHLY by default.
--   2. contribution_plans.monthly_amount becomes nullable so a WEEKLY plan can
--      exist with a NULL monthly_amount instead of "borrowing" the monthly
--      column for a weekly value (the 0007-era repurposing we are removing
--      going forward).
--   3. The unique constraint moves from name-only to (name, frequency), so the
--      same plan name can exist once per frequency (e.g. "Starter Saver"
--      MONTHLY 100000 + "Starter Saver" WEEKLY 100000). Dropping a unique
--      index is non-destructive and no FK references the plan name.
--
-- Both unique/index DDL statements are guarded so re-running is a no-op.

BEGIN;

-- 1) Frequency field. Existing plans (Starter/Growth/Premium/Diamond with their
--    real production monthly amounts) become MONTHLY automatically.
ALTER TABLE "contribution_plans" ADD COLUMN IF NOT EXISTS "frequency" TEXT NOT NULL DEFAULT 'MONTHLY';

CREATE INDEX IF NOT EXISTS "contribution_plans_frequency_idx" ON "contribution_plans"("frequency");

-- 2) Allow weekly-only plan rows to leave monthly_amount NULL. Dropping NOT
--    NULL on an already-nullable column is a safe no-op.
ALTER TABLE "contribution_plans" ALTER COLUMN "monthly_amount" DROP NOT NULL;

-- 3) Compound unique (name, frequency) replaces the name-only unique.
--    Prisma creates @unique / @@unique as plain unique indexes (not
--    constraints) in this project, so the old index is dropped by name.
--    DROP INDEX IF EXISTS keeps re-runs a no-op.
DROP INDEX IF EXISTS "contribution_plans_name_key";

CREATE UNIQUE INDEX IF NOT EXISTS "contribution_plans_name_frequency_key" ON "contribution_plans"("name", "frequency");

COMMIT;