-- Reconciliation migration for the live production schema.
--
-- Context: migrations 0007_weekly_ajo_ledger and 0008_withdrawals_and_cohort_advance_guard
-- ARE recorded in _prisma_migrations as applied (checksums match the local files) and are
-- therefore skipped by `prisma migrate deploy`, but their DDL was never actually executed
-- against this database. As a result the following objects are missing:
--
--   Tables : platform_settings, cohorts, cohort_members, payouts,
--            referral_rewards, webhook_events, withdrawals
--   Columns: contribution_plans.weekly_amount / cycle_weeks
--            contribution_subscriptions.cohort_id
--            contribution_payments.week_index / cohort_id
--            wallets.held_balance
--            cohorts.last_advanced_at
--
-- This migration is purely ADDITIVE and IDEMPOTENT:
--   * It never drops, recreates, truncates, or resets any table; every DDL
--     statement only ADDS missing columns/tables/indexes/foreign keys.
--   * No financial data is modified. wallet balances, wallet_transactions,
--     company_ledger, contribution_payments, activation_payments, users, and
--     contribution_subscriptions rows are all left untouched, and existing
--     contribution_payments / contribution_subscriptions rows are not rewritten
--     (the new columns are nullable with no rewrite).
--   * The ONLY existing rows this migration writes to are three
--     contribution_plans rows whose weekly_amount is deliberately backfilled to
--     the app's defined weekly rates (below). All other rows in every table are
--     preserved unchanged.
--   * contribution_plans.weekly_amount is backfilled ONLY for the plans whose
--     weekly rate is explicitly defined by the current app (Starter 100000,
--     Growth 300000, Premium 500000); Diamond Saver gets NO invented amount.
--
-- Every statement is guarded so re-running it is a no-op:
--   * ADD COLUMN IF NOT EXISTS
--   * CREATE TABLE IF NOT EXISTS / CREATE [UNIQUE] INDEX IF NOT EXISTS
--   * Foreign keys via DO-block existence checks (Postgres lacks ADD CONSTRAINT IF NOT EXISTS)

BEGIN;

-- =====================================================================
-- 1) Missing columns on EXISTING tables (additive only, no drops)
-- =====================================================================

-- Weekly contribution model (from 0007) -----------------------------------
-- Safe, data-preserving: the column is added nullable first, then ONLY the
-- plans whose weekly amount is explicitly defined by the current application
-- are backfilled (matched by name, guarded with IS NULL so re-runs are no-ops).
-- The legacy `monthly_amount` values must NOT be copied — the app's new weekly
-- tiers differ from the old monthly amounts (e.g. Growth Saver was ₦500/month,
-- now ₦300/week), so a blanket copy would charge the wrong weekly rate.
ALTER TABLE "contribution_plans" ADD COLUMN IF NOT EXISTS "weekly_amount" INTEGER;

-- Starter Saver = ₦1,000/week (100000 kobo)
UPDATE "contribution_plans"
SET "weekly_amount" = 100000
WHERE "name" = 'Starter Saver' AND "weekly_amount" IS NULL;

-- Growth Saver = ₦3,000/week (300000 kobo)
UPDATE "contribution_plans"
SET "weekly_amount" = 300000
WHERE "name" = 'Growth Saver' AND "weekly_amount" IS NULL;

-- Premium Saver = ₦5,000/week (500000 kobo)
UPDATE "contribution_plans"
SET "weekly_amount" = 500000
WHERE "name" = 'Premium Saver' AND "weekly_amount" IS NULL;

-- Diamond Saver is intentionally NOT backfilled: the application defines no
-- weekly amount for it, so we neither invent one nor delete the plan. Its
-- weekly_amount stays NULL after reconciliation (see the NOT NULL note at the
-- end of this file).

ALTER TABLE "contribution_plans" ADD COLUMN IF NOT EXISTS "cycle_weeks" INTEGER NOT NULL DEFAULT 52;

ALTER TABLE "contribution_subscriptions" ADD COLUMN IF NOT EXISTS "cohort_id" TEXT;

ALTER TABLE "contribution_payments" ADD COLUMN IF NOT EXISTS "week_index" INTEGER;
ALTER TABLE "contribution_payments" ADD COLUMN IF NOT EXISTS "cohort_id" TEXT;

-- Withdrawal reserve column (from 0008) -----------------------------------
ALTER TABLE "wallets" ADD COLUMN IF NOT EXISTS "held_balance" INTEGER NOT NULL DEFAULT 0;

-- =====================================================================
-- 2) New tables (in dependency order; all IF NOT EXISTS)
-- =====================================================================

-- Platform settings (runtime-editable key/value store)
CREATE TABLE IF NOT EXISTS "platform_settings" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB,
    "description" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "platform_settings_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "platform_settings_key_key" ON "platform_settings"("key");

-- Cohorts (includes last_advanced_at from 0008)
CREATE TABLE IF NOT EXISTS "cohorts" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "plan_id" TEXT NOT NULL,
    "size" INTEGER NOT NULL DEFAULT 52,
    "status" TEXT NOT NULL DEFAULT 'RECRUITING',
    "current_week" INTEGER NOT NULL DEFAULT 1,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "last_advanced_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "cohorts_pkey" PRIMARY KEY ("id")
);
-- Defensive: in case cohorts already existed without the 0008 column.
ALTER TABLE "cohorts" ADD COLUMN IF NOT EXISTS "last_advanced_at" TIMESTAMP(3);
CREATE INDEX IF NOT EXISTS "cohorts_plan_id_status_idx" ON "cohorts"("plan_id", "status");

-- Cohort members
CREATE TABLE IF NOT EXISTS "cohort_members" (
    "id" TEXT NOT NULL,
    "cohort_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "total_paid" INTEGER NOT NULL DEFAULT 0,
    "last_paid_week" INTEGER,
    "collected_week" INTEGER,
    "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "cohort_members_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "cohort_members_cohort_id_position_key" ON "cohort_members"("cohort_id", "position");
CREATE UNIQUE INDEX IF NOT EXISTS "cohort_members_cohort_id_user_id_key" ON "cohort_members"("cohort_id", "user_id");
CREATE INDEX IF NOT EXISTS "cohort_members_user_id_idx" ON "cohort_members"("user_id");

-- Weekly payouts
CREATE TABLE IF NOT EXISTS "payouts" (
    "id" TEXT NOT NULL,
    "cohort_id" TEXT NOT NULL,
    "cohort_member_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "plan_id" TEXT NOT NULL,
    "week_index" INTEGER NOT NULL,
    "gross_amount" INTEGER NOT NULL,
    "platform_fee" INTEGER NOT NULL DEFAULT 0,
    "net_amount" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'PROCESSING',
    "provider" TEXT NOT NULL DEFAULT 'internal',
    "provider_reference" TEXT,
    "processed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "payouts_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "payouts_cohort_id_week_index_key" ON "payouts"("cohort_id", "week_index");
CREATE INDEX IF NOT EXISTS "payouts_user_id_idx" ON "payouts"("user_id");
CREATE INDEX IF NOT EXISTS "payouts_status_idx" ON "payouts"("status");

-- 3-level referral reward ledger
CREATE TABLE IF NOT EXISTS "referral_rewards" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "source_user_id" TEXT NOT NULL,
    "level" INTEGER NOT NULL,
    "amount_kobo" INTEGER NOT NULL,
    "reference" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'earned',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paid_at" TIMESTAMP(3),
    CONSTRAINT "referral_rewards_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "referral_rewards_reference_key" ON "referral_rewards"("reference");
CREATE INDEX IF NOT EXISTS "referral_rewards_user_id_idx" ON "referral_rewards"("user_id");
CREATE INDEX IF NOT EXISTS "referral_rewards_source_user_id_type_idx" ON "referral_rewards"("source_user_id", "type");

-- Webhook idempotency/audit log
CREATE TABLE IF NOT EXISTS "webhook_events" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'paystack',
    "event" TEXT NOT NULL,
    "reference" TEXT,
    "status" TEXT NOT NULL DEFAULT 'RECEIVED',
    "message" TEXT,
    "body" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "webhook_events_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "webhook_events_provider_event_reference_key" ON "webhook_events"("provider", "event", "reference");
CREATE INDEX IF NOT EXISTS "webhook_events_reference_idx" ON "webhook_events"("reference");
CREATE INDEX IF NOT EXISTS "webhook_events_created_at_idx" ON "webhook_events"("created_at");

-- Withdrawal requests
CREATE TABLE IF NOT EXISTS "withdrawals" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "amount_kobo" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "provider" TEXT NOT NULL DEFAULT 'internal',
    "provider_reference" TEXT,
    "bank_name" TEXT,
    "bank_code" TEXT,
    "account_number" TEXT,
    "account_name" TEXT,
    "failure_reason" TEXT,
    "notes" TEXT,
    "reserved_at" TIMESTAMP(3),
    "processed_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "wallet_transaction_id" TEXT,
    "refunded_wallet_transaction_id" TEXT,
    "processed_by_admin_id" TEXT,
    "active_lock" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "withdrawals_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "withdrawals_provider_reference_key" ON "withdrawals"("provider_reference");
CREATE UNIQUE INDEX IF NOT EXISTS "withdrawals_wallet_transaction_id_key" ON "withdrawals"("wallet_transaction_id");
CREATE UNIQUE INDEX IF NOT EXISTS "withdrawals_refunded_wallet_transaction_id_key" ON "withdrawals"("refunded_wallet_transaction_id");
CREATE UNIQUE INDEX IF NOT EXISTS "withdrawals_active_lock_key" ON "withdrawals"("active_lock");
CREATE INDEX IF NOT EXISTS "withdrawals_user_id_idx" ON "withdrawals"("user_id");
CREATE INDEX IF NOT EXISTS "withdrawals_status_idx" ON "withdrawals"("status");
CREATE INDEX IF NOT EXISTS "withdrawals_created_at_idx" ON "withdrawals"("created_at");

-- =====================================================================
-- 3) Foreign keys (guarded; PG has no ADD CONSTRAINT IF NOT EXISTS)
-- =====================================================================

-- cohorts.plan_id -> contribution_plans.id (RESTRICT/CASCADE)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cohorts_plan_id_fkey') THEN
        ALTER TABLE "cohorts" ADD CONSTRAINT "cohorts_plan_id_fkey"
            FOREIGN KEY ("plan_id") REFERENCES "contribution_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;

-- cohort_members.cohort_id -> cohorts.id (CASCADE)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cohort_members_cohort_id_fkey') THEN
        ALTER TABLE "cohort_members" ADD CONSTRAINT "cohort_members_cohort_id_fkey"
            FOREIGN KEY ("cohort_id") REFERENCES "cohorts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- cohort_members.user_id -> users.id (CASCADE)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cohort_members_user_id_fkey') THEN
        ALTER TABLE "cohort_members" ADD CONSTRAINT "cohort_members_user_id_fkey"
            FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- payouts.cohort_id -> cohorts.id (CASCADE)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payouts_cohort_id_fkey') THEN
        ALTER TABLE "payouts" ADD CONSTRAINT "payouts_cohort_id_fkey"
            FOREIGN KEY ("cohort_id") REFERENCES "cohorts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- payouts.cohort_member_id -> cohort_members.id (CASCADE)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payouts_cohort_member_id_fkey') THEN
        ALTER TABLE "payouts" ADD CONSTRAINT "payouts_cohort_member_id_fkey"
            FOREIGN KEY ("cohort_member_id") REFERENCES "cohort_members"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- payouts.user_id -> users.id (CASCADE)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payouts_user_id_fkey') THEN
        ALTER TABLE "payouts" ADD CONSTRAINT "payouts_user_id_fkey"
            FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- payouts.plan_id -> contribution_plans.id (RESTRICT/CASCADE)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payouts_plan_id_fkey') THEN
        ALTER TABLE "payouts" ADD CONSTRAINT "payouts_plan_id_fkey"
            FOREIGN KEY ("plan_id") REFERENCES "contribution_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;

-- referral_rewards.user_id -> users.id (CASCADE)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'referral_rewards_user_id_fkey') THEN
        ALTER TABLE "referral_rewards" ADD CONSTRAINT "referral_rewards_user_id_fkey"
            FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- referral_rewards.source_user_id -> users.id (CASCADE)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'referral_rewards_source_user_id_fkey') THEN
        ALTER TABLE "referral_rewards" ADD CONSTRAINT "referral_rewards_source_user_id_fkey"
            FOREIGN KEY ("source_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- contribution_subscriptions.cohort_id -> cohorts.id (SET NULL)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contribution_subscriptions_cohort_id_fkey') THEN
        ALTER TABLE "contribution_subscriptions" ADD CONSTRAINT "contribution_subscriptions_cohort_id_fkey"
            FOREIGN KEY ("cohort_id") REFERENCES "cohorts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

-- withdrawals.user_id -> users.id (CASCADE)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'withdrawals_user_id_fkey') THEN
        ALTER TABLE "withdrawals" ADD CONSTRAINT "withdrawals_user_id_fkey"
            FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- contribution_payments.cohort_id intentionally has NO foreign key — the
-- schema defines no relation for it (it is a plain nullable String column).

-- =====================================================================
-- NOTE on contribution_plans.weekly_amount NULLability and Diamond Saver
-- =====================================================================
-- The Prisma schema declares weeklyAmount as a REQUIRED (NOT NULL) Int with no
-- default, so the fully-synced database would enforce NOT NULL. This migration
-- deliberately does NOT add that NOT NULL, because Diamond Saver has no defined
-- weekly amount and must not be deleted or assigned an invented rate — it is
-- preserved as-is with weekly_amount = NULL (matching the original 0007 column
-- which was also nullable).
--
-- Safe explicit decision required BEFORE an eventual NOT NULL migration:
--   1. Confirm Diamond Saver is no longer referenced by subscriptions, cohorts,
--      or payouts (the app's seed-runner already deletes it at startup when it
--      has zero subscriptions), OR assign it a deliberate weekly amount.
--   2. Only then run:
--        ALTER TABLE "contribution_plans" ALTER COLUMN "weekly_amount" SET NOT NULL;
-- in a future migration. Nothing in 0009 writes to Diamond Saver.

COMMIT;