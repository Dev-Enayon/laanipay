-- Paystack Dedicated Virtual Account (DVA) wallet funding + transfer recipients.
--
-- Purpose (see PHASE 2 plan):
--   1. users.paystack_customer_code          — link a user to their Paystack
--      customer so incoming bank-transfer deposits can be attributed to them.
--   2. virtual_accounts                      — the DVA provisioned for a user
--      (bank account number they can transfer money to for wallet funding).
--   3. wallet_deposits                       — idempotency record per successful
--      bank-transfer deposit. `reference` is the Paystack transaction reference
--      and is UNIQUE, so a replayed charge.success webhook can never credit the
--      wallet twice.
--   4. paystack_transfer_recipients          — persisted NUBAN transfer
--      recipients so withdrawals reuse an existing recipient instead of creating
--      duplicates on the Paystack account.
--
-- This migration is purely ADDITIVE and IDEMPOTENT:
--   * One new nullable column on users (no rewrite of existing values).
--   * Three new tables (CREATE TABLE IF NOT EXISTS). No DROP, TRUNCATE,
--     DELETE, or any modification of existing rows/columns.
--   * DVA funding and external withdrawals stay gated off in application code
--     (PAYSTACK_DVA_ENABLED / WITHDRAWAL_BANK_TRANSFER_ENABLED default false)
--     until explicitly enabled by operations.

BEGIN;

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "paystack_customer_code" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "users_paystack_customer_code_key"
  ON "users"("paystack_customer_code");

CREATE TABLE IF NOT EXISTS "virtual_accounts" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "paystack_dva_id" TEXT,
  "customer_code" TEXT NOT NULL,
  "account_number" TEXT,
  "account_name" TEXT,
  "bank_name" TEXT,
  "bank_slug" TEXT,
  "currency" TEXT NOT NULL DEFAULT 'NGN',
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "assigned_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "virtual_accounts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "virtual_accounts_paystack_dva_id_key"
  ON "virtual_accounts"("paystack_dva_id");
CREATE UNIQUE INDEX IF NOT EXISTS "virtual_accounts_account_number_key"
  ON "virtual_accounts"("account_number");
CREATE INDEX IF NOT EXISTS "virtual_accounts_user_id_status_idx"
  ON "virtual_accounts"("user_id", "status");

CREATE TABLE IF NOT EXISTS "wallet_deposits" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "reference" TEXT NOT NULL,
  "transaction_id" TEXT,
  "customer_code" TEXT,
  "virtual_account_id" TEXT,
  "amount_kobo" INTEGER NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'NGN',
  "status" TEXT NOT NULL DEFAULT 'verified',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "wallet_deposits_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "wallet_deposits_reference_key"
  ON "wallet_deposits"("reference");
CREATE UNIQUE INDEX IF NOT EXISTS "wallet_deposits_transaction_id_key"
  ON "wallet_deposits"("transaction_id");
CREATE INDEX IF NOT EXISTS "wallet_deposits_user_id_created_at_idx"
  ON "wallet_deposits"("user_id", "created_at");

CREATE TABLE IF NOT EXISTS "paystack_transfer_recipients" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "recipient_code" TEXT NOT NULL,
  "bank_code" TEXT NOT NULL,
  "account_number" TEXT NOT NULL,
  "account_name" TEXT NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'NGN',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "paystack_transfer_recipients_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "paystack_transfer_recipients_recipient_code_key"
  ON "paystack_transfer_recipients"("recipient_code");
CREATE INDEX IF NOT EXISTS "paystack_transfer_recipients_user_id_idx"
  ON "paystack_transfer_recipients"("user_id");

COMMIT;