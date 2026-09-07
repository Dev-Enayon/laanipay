-- Wallet withdrawals + cohort advance safety
-- Adds (all additive, non-destructive):
--   - Wallet.held_balance        funds reserved for active withdrawal requests
--   - Cohort.last_advanced_at    time guard against accidental double advancement
--   - Withdrawal                 withdrawal request state machine

ALTER TABLE "wallets" ADD COLUMN "held_balance" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "cohorts" ADD COLUMN "last_advanced_at" TIMESTAMP(3);

CREATE TABLE "withdrawals" (
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

CREATE UNIQUE INDEX "withdrawals_provider_reference_key" ON "withdrawals"("provider_reference");
CREATE UNIQUE INDEX "withdrawals_wallet_transaction_id_key" ON "withdrawals"("wallet_transaction_id");
CREATE UNIQUE INDEX "withdrawals_refunded_wallet_transaction_id_key" ON "withdrawals"("refunded_wallet_transaction_id");
CREATE UNIQUE INDEX "withdrawals_active_lock_key" ON "withdrawals"("active_lock");
CREATE INDEX "withdrawals_user_id_idx" ON "withdrawals"("user_id");
CREATE INDEX "withdrawals_status_idx" ON "withdrawals"("status");
CREATE INDEX "withdrawals_created_at_idx" ON "withdrawals"("created_at");

ALTER TABLE "withdrawals" ADD CONSTRAINT "withdrawals_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;