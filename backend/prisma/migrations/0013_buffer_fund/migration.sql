-- Contribution security-buffer fund — FOUNDATION ONLY.
--
-- Purpose:
--   1. contribution_payments.main_amount / buffer_amount — the split of the
--      ACTUAL paid amount into the member's main contribution and the security
--      buffer contribution. NULL for rows created before the fund existed
--      (treated as 100% main). The accounting invariant
--      main_amount + buffer_amount === amount is enforced by lib/bufferFund.js.
--   2. buffer_ledger — auditable per-(cohort, member) ledger of every buffer
--      movement (BUFFER_CREDIT / BUFFER_DEBIT / BUFFER_REFUND /
--      BUFFER_ADJUSTMENT). `amount_kobo` is always positive; `sign` (+1/−1)
--      carries direction. A balance is DERIVED as the signed sum of entries;
--      no stored balance column exists, so there is no second book that can
--      drift. `reference` is UNIQUE so a replayed webhook or scheduler retry
--      can never credit (or debit) the buffer twice.
--
-- This migration is purely ADDITIVE and IDEMPOTENT:
--   * Two new nullable columns on contribution_payments (old rows untouched).
--   * One new table (CREATE TABLE IF NOT EXISTS). No DROP, TRUNCATE, DELETE,
--     or modification of existing rows/columns.
--   * Default/death/fine/recovery flows are NOT part of this migration.

BEGIN;

ALTER TABLE "contribution_payments" ADD COLUMN IF NOT EXISTS "main_amount" INTEGER;
ALTER TABLE "contribution_payments" ADD COLUMN IF NOT EXISTS "buffer_amount" INTEGER;

CREATE TABLE IF NOT EXISTS "buffer_ledger" (
  "id" TEXT NOT NULL,
  "cohort_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "event_type" TEXT NOT NULL,
  "amount_kobo" INTEGER NOT NULL,
  "sign" INTEGER NOT NULL DEFAULT 1,
  "reference" TEXT NOT NULL,
  "reason" TEXT,
  "actor" TEXT NOT NULL DEFAULT 'system',
  "payment_id" TEXT,
  "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "buffer_ledger_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "buffer_ledger_reference_key"
  ON "buffer_ledger"("reference");
CREATE INDEX IF NOT EXISTS "buffer_ledger_cohort_id_user_id_idx"
  ON "buffer_ledger"("cohort_id", "user_id");
CREATE INDEX IF NOT EXISTS "buffer_ledger_cohort_id_created_at_idx"
  ON "buffer_ledger"("cohort_id", "created_at");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'buffer_ledger_cohort_id_fkey') THEN
    ALTER TABLE "buffer_ledger"
      ADD CONSTRAINT "buffer_ledger_cohort_id_fkey" FOREIGN KEY ("cohort_id")
      REFERENCES "cohorts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'buffer_ledger_user_id_fkey') THEN
    ALTER TABLE "buffer_ledger"
      ADD CONSTRAINT "buffer_ledger_user_id_fkey" FOREIGN KEY ("user_id")
      REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'buffer_ledger_payment_id_fkey') THEN
    ALTER TABLE "buffer_ledger"
      ADD CONSTRAINT "buffer_ledger_payment_id_fkey" FOREIGN KEY ("payment_id")
      REFERENCES "contribution_payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

COMMIT;