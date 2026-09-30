-- Default, grace, buffer drawdown, catch-up, fine, recovery and death workflow.
--
-- Purpose (continues 0013_buffer_fund):
--   1. cohort_members.default_status/closed_at/closed_reason — the
--      missed-contribution state machine (ACTIVE → PAYMENT_MISSED → GRACE →
--      CAUGHT_UP | DEFAULTED) plus participation closure, carried on the
--      EXISTING CohortMember row. No parallel status system is created.
--   2. missed_contributions — one durable row per detected miss. Unique
--      (cohort_id, member_id, week_index) so a week can only be recorded as
--      missed once (idempotent detection sweep).
--   3. contribution_defaults — the recovery case. Tracks outstanding, missed,
--      buffer used, fine, shortfall, contact attempts, guarantor ref, notes.
--   4. contribution_fines — the fine as its OWN financial event. Unique
--      `reference` so a retry can never charge a fine twice. Amount is
--      configured, never hard-coded; zero while fines are disabled.
--   5. death_cases — death as a SEPARATE workflow with its own state machine
--      and evidence references. Never auto-charges the family, never debits a
--      guarantor, never promises buffer coverage. `estate_determination`
--      defaults to 'UNRESOLVED' and is set by a human.
--   6. guarantors — a recorded REFERENCE for a documented recovery workflow.
--      Carries no automatic financial liability; `liability_acknowledged`
--      defaults false. Nothing in this codebase debits a guarantor.
--   7. contribution_payments.missed_kobo/current_kobo/fine_kobo/kind — how a
--      catch-up payment was actually split, verified against the real payment
--      amount. Nullable: ordinary payments leave them NULL.
--
-- This migration is purely ADDITIVE and IDEMPOTENT:
--   * Four new nullable columns on cohort_members, four on
--     contribution_payments (existing rows untouched; default_status defaults
--     to 'ACTIVE' which matches today's behavior for every current member).
--   * Five new tables (CREATE TABLE IF NOT EXISTS).
--   * No DROP, TRUNCATE, DELETE, or modification of existing financial rows.
--   * Every feature stays gated OFF in application code by default
--     (defaultPolicy.enabled / finePolicy.enabled / bufferPolicy.enabled all
--     default false). Applying this migration alone changes no behavior.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Missed-contribution state machine on the existing member row
-- ---------------------------------------------------------------------------

ALTER TABLE "cohort_members" ADD COLUMN IF NOT EXISTS "default_status" TEXT NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE "cohort_members" ADD COLUMN IF NOT EXISTS "closed_at" TIMESTAMP(3);
ALTER TABLE "cohort_members" ADD COLUMN IF NOT EXISTS "closed_reason" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE tablename = 'cohort_members' AND indexname = 'cohort_members_cohort_id_default_status_idx'
  ) THEN
    CREATE INDEX "cohort_members_cohort_id_default_status_idx"
      ON "cohort_members"("cohort_id", "default_status");
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2. Catch-up payment split (nullable; ordinary payments stay NULL)
-- ---------------------------------------------------------------------------

ALTER TABLE "contribution_payments" ADD COLUMN IF NOT EXISTS "missed_kobo" INTEGER;
ALTER TABLE "contribution_payments" ADD COLUMN IF NOT EXISTS "current_kobo" INTEGER;
ALTER TABLE "contribution_payments" ADD COLUMN IF NOT EXISTS "fine_kobo" INTEGER;
ALTER TABLE "contribution_payments" ADD COLUMN IF NOT EXISTS "kind" TEXT;

-- Buffer protection figures for a week's payout. gross_amount/net_amount are
-- NOT changed: the pot and the platform fee stay exactly what was really
-- collected. The advance is recorded separately so it can never inflate the
-- pot. A non-zero protection_shortfall_kobo is an UNRESOLVED obligation.
ALTER TABLE "payouts" ADD COLUMN IF NOT EXISTS "protected_from_buffer_kobo" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "payouts" ADD COLUMN IF NOT EXISTS "protection_shortfall_kobo" INTEGER NOT NULL DEFAULT 0;

-- ---------------------------------------------------------------------------
-- 3. Missed contributions
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "missed_contributions" (
  "id" TEXT NOT NULL,
  "cohort_id" TEXT NOT NULL,
  "member_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "week_index" INTEGER NOT NULL,
  "amount_kobo" INTEGER NOT NULL,
  "buffer_amount_kobo" INTEGER NOT NULL DEFAULT 0,
  "due_at" TIMESTAMP(3) NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'MISSED',
  "grace_ends_at" TIMESTAMP(3),
  "resolved_at" TIMESTAMP(3),
  "reference" TEXT NOT NULL,
  "metadata" JSONB,
  "caught_up_payment_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "missed_contributions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "missed_contributions_reference_key"
  ON "missed_contributions"("reference");
CREATE UNIQUE INDEX IF NOT EXISTS "missed_contributions_cohort_id_member_id_week_index_key"
  ON "missed_contributions"("cohort_id", "member_id", "week_index");
CREATE INDEX IF NOT EXISTS "missed_contributions_user_id_status_idx"
  ON "missed_contributions"("user_id", "status");
CREATE INDEX IF NOT EXISTS "missed_contributions_cohort_id_status_idx"
  ON "missed_contributions"("cohort_id", "status");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'missed_contributions_cohort_id_fkey') THEN
    ALTER TABLE "missed_contributions" ADD CONSTRAINT "missed_contributions_cohort_id_fkey"
      FOREIGN KEY ("cohort_id") REFERENCES "cohorts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'missed_contributions_member_id_fkey') THEN
    ALTER TABLE "missed_contributions" ADD CONSTRAINT "missed_contributions_member_id_fkey"
      FOREIGN KEY ("member_id") REFERENCES "cohort_members"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'missed_contributions_user_id_fkey') THEN
    ALTER TABLE "missed_contributions" ADD CONSTRAINT "missed_contributions_user_id_fkey"
      FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'missed_contributions_caught_up_payment_id_fkey') THEN
    ALTER TABLE "missed_contributions" ADD CONSTRAINT "missed_contributions_caught_up_payment_id_fkey"
      FOREIGN KEY ("caught_up_payment_id") REFERENCES "contribution_payments"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 4. Recovery cases (contribution defaults)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "contribution_defaults" (
  "id" TEXT NOT NULL,
  "cohort_id" TEXT NOT NULL,
  "member_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "week_index" INTEGER,
  "reference" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'OPEN',
  "missed_kobo" INTEGER NOT NULL DEFAULT 0,
  "fine_kobo" INTEGER NOT NULL DEFAULT 0,
  "buffer_used_kobo" INTEGER NOT NULL DEFAULT 0,
  "shortfall_kobo" INTEGER NOT NULL DEFAULT 0,
  "recovered_kobo" INTEGER NOT NULL DEFAULT 0,
  "outstanding_kobo" INTEGER NOT NULL DEFAULT 0,
  "contact_attempts" INTEGER NOT NULL DEFAULT 0,
  "last_contact_at" TIMESTAMP(3),
  "promised_at" TIMESTAMP(3),
  "promised_kobo" INTEGER,
  "guarantor_id" TEXT,
  "missed_contribution_id" TEXT,
  "admin_notes" TEXT,
  "closed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "contribution_defaults_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "contribution_defaults_reference_key"
  ON "contribution_defaults"("reference");
CREATE UNIQUE INDEX IF NOT EXISTS "contribution_defaults_missed_contribution_id_key"
  ON "contribution_defaults"("missed_contribution_id");
CREATE INDEX IF NOT EXISTS "contribution_defaults_user_id_status_idx"
  ON "contribution_defaults"("user_id", "status");
CREATE INDEX IF NOT EXISTS "contribution_defaults_cohort_id_status_idx"
  ON "contribution_defaults"("cohort_id", "status");
CREATE INDEX IF NOT EXISTS "contribution_defaults_status_idx"
  ON "contribution_defaults"("status");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contribution_defaults_cohort_id_fkey') THEN
    ALTER TABLE "contribution_defaults" ADD CONSTRAINT "contribution_defaults_cohort_id_fkey"
      FOREIGN KEY ("cohort_id") REFERENCES "cohorts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contribution_defaults_member_id_fkey') THEN
    ALTER TABLE "contribution_defaults" ADD CONSTRAINT "contribution_defaults_member_id_fkey"
      FOREIGN KEY ("member_id") REFERENCES "cohort_members"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contribution_defaults_user_id_fkey') THEN
    ALTER TABLE "contribution_defaults" ADD CONSTRAINT "contribution_defaults_user_id_fkey"
      FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contribution_defaults_missed_contribution_id_fkey') THEN
    ALTER TABLE "contribution_defaults" ADD CONSTRAINT "contribution_defaults_missed_contribution_id_fkey"
      FOREIGN KEY ("missed_contribution_id") REFERENCES "missed_contributions"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  -- NOTE: the guarantor FK is added in section 6, after the guarantors table
  -- exists. Adding it here would fail on a fresh database.
END $$;

-- ---------------------------------------------------------------------------
-- 5. Fines — own financial event, idempotent, configurable amount
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "contribution_fines" (
  "id" TEXT NOT NULL,
  "default_id" TEXT NOT NULL,
  "cohort_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "amount_kobo" INTEGER NOT NULL,
  "reason" TEXT,
  "reference" TEXT NOT NULL,
  "destination" TEXT NOT NULL DEFAULT 'unassigned',
  "status" TEXT NOT NULL DEFAULT 'ASSESSED',
  "collected_payment_id" TEXT,
  "collected_at" TIMESTAMP(3),
  "waived_reason" TEXT,
  "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "contribution_fines_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "contribution_fines_reference_key"
  ON "contribution_fines"("reference");
CREATE INDEX IF NOT EXISTS "contribution_fines_user_id_status_idx"
  ON "contribution_fines"("user_id", "status");
CREATE INDEX IF NOT EXISTS "contribution_fines_cohort_id_idx"
  ON "contribution_fines"("cohort_id");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contribution_fines_default_id_fkey') THEN
    ALTER TABLE "contribution_fines" ADD CONSTRAINT "contribution_fines_default_id_fkey"
      FOREIGN KEY ("default_id") REFERENCES "contribution_defaults"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contribution_fines_cohort_id_fkey') THEN
    ALTER TABLE "contribution_fines" ADD CONSTRAINT "contribution_fines_cohort_id_fkey"
      FOREIGN KEY ("cohort_id") REFERENCES "cohorts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contribution_fines_user_id_fkey') THEN
    ALTER TABLE "contribution_fines" ADD CONSTRAINT "contribution_fines_user_id_fkey"
      FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 6. Guarantors — recorded reference only, no automatic liability
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "guarantors" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "linked_user_id" TEXT,
  "full_name" TEXT NOT NULL,
  "phone" TEXT,
  "relationship" TEXT,
  "reference" TEXT,
  "liability_acknowledged" BOOLEAN NOT NULL DEFAULT false,
  "acknowledged_at" TIMESTAMP(3),
  "notes" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "guarantors_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "guarantors_user_id_idx" ON "guarantors"("user_id");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'guarantors_user_id_fkey') THEN
    ALTER TABLE "guarantors" ADD CONSTRAINT "guarantors_user_id_fkey"
      FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'guarantors_linked_user_id_fkey') THEN
    ALTER TABLE "guarantors" ADD CONSTRAINT "guarantors_linked_user_id_fkey"
      FOREIGN KEY ("linked_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  -- Added here (not with contribution_defaults) so the referenced table exists.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contribution_defaults_guarantor_id_fkey') THEN
    ALTER TABLE "contribution_defaults" ADD CONSTRAINT "contribution_defaults_guarantor_id_fkey"
      FOREIGN KEY ("guarantor_id") REFERENCES "guarantors"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 7. Death cases — separate workflow, no automatic charges
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "death_cases" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "cohort_id" TEXT,
  "default_id" TEXT,
  "reference" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'DEATH_REPORTED',
  "reported_by" TEXT,
  "reported_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "verification_reference" TEXT,
  "verified_at" TIMESTAMP(3),
  "verification_evidence" TEXT,
  "participation_closed_at" TIMESTAMP(3),
  "financial_reviewed_at" TIMESTAMP(3),
  "paid_contributions_kobo" INTEGER NOT NULL DEFAULT 0,
  "payout_status" TEXT,
  "outstanding_kobo" INTEGER NOT NULL DEFAULT 0,
  "buffer_used_kobo" INTEGER NOT NULL DEFAULT 0,
  "estate_due_kobo" INTEGER,
  "estate_determination" TEXT NOT NULL DEFAULT 'UNRESOLVED',
  "admin_notes" TEXT,
  "resolved_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "death_cases_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "death_cases_reference_key" ON "death_cases"("reference");
CREATE UNIQUE INDEX IF NOT EXISTS "death_cases_default_id_key" ON "death_cases"("default_id");
CREATE INDEX IF NOT EXISTS "death_cases_user_id_status_idx" ON "death_cases"("user_id", "status");
CREATE INDEX IF NOT EXISTS "death_cases_status_idx" ON "death_cases"("status");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'death_cases_user_id_fkey') THEN
    ALTER TABLE "death_cases" ADD CONSTRAINT "death_cases_user_id_fkey"
      FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'death_cases_cohort_id_fkey') THEN
    ALTER TABLE "death_cases" ADD CONSTRAINT "death_cases_cohort_id_fkey"
      FOREIGN KEY ("cohort_id") REFERENCES "cohorts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'death_cases_default_id_fkey') THEN
    ALTER TABLE "death_cases" ADD CONSTRAINT "death_cases_default_id_fkey"
      FOREIGN KEY ("default_id") REFERENCES "contribution_defaults"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

COMMIT;
