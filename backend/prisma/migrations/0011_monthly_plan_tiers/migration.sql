-- Monthly plan tiers + subscription amount snapshot.
--
-- Context: the monthly contribution tiers are being updated to:
--   Starter Saver  ₦10,000/month
--   Growth Saver   ₦15,000/month
--   Premium Saver  ₦20,000/month
--   Diamond Saver  ₦25,000/month
--   Elite Saver    ₦30,000/month (new)
-- The plan rows themselves are reference data and are maintained by the
-- boot-time seed (frequency-aware upsert, monthly-only, weekly untouched).
--
-- This migration ONLY adds the mechanism that keeps EXISTING subscriptions on
-- their current financial terms when those tiers change:
--
--   contribution_subscriptions.amount_kobo  (new, nullable)
--     A snapshot of the amount owed per contribution period, captured for every
--     existing subscription BEFORE the seed applies the new tiers. Pay path and
--     overview read `amount_kobo ?? plan amount`, so a pre-existing subscriber
--     keeps paying the amount they agreed to; new subscribers get the new tier.
--
-- This migration is purely ADDITIVE and IDEMPOTENT:
--   * One new nullable column (no rewrite of existing values).
--   * One guarded backfill (WHERE amount_kobo IS NULL) that only writes the new
--     column; it never touches contribution_payments, wallets, users, MLM,
--     transactions, or any existing column value.
--   * No DROP TABLE, TRUNCATE, DELETE or destructive operation.
--   * Snapshot amount is derived from the target plan's OWN frequency column,
--     so a monthly subscription is frozen at its monthly_amount and a weekly
--     subscription at its weekly_amount (weekly amounts are not changing, so
--     weekly subscriptions keep an identical value).

BEGIN;

ALTER TABLE "contribution_subscriptions" ADD COLUMN IF NOT EXISTS "amount_kobo" INTEGER;

-- Capture the current amount for every subscription that does not yet have a
-- snapshot. Runs BEFORE the seed updates the monthly plan tiers, so existing
-- subscriptions are frozen at their pre-change amount.
UPDATE "contribution_subscriptions" cs
SET "amount_kobo" = CASE
  WHEN p."frequency" = 'WEEKLY' THEN p."weekly_amount"
  ELSE p."monthly_amount"
END
FROM "contribution_plans" p
WHERE cs."plan_id" = p."id"
  AND cs."amount_kobo" IS NULL;

COMMIT;