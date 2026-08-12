-- Admin dashboard foundation: user roles/status/suspension tracking,
-- structured admin audit fields, wallet transaction ledger and company ledger.

-- User admin & suspension fields.
ALTER TABLE "users"
  ADD COLUMN "role" TEXT NOT NULL DEFAULT 'user',
  ADD COLUMN "status" TEXT NOT NULL DEFAULT 'active',
  ADD COLUMN "suspended_at" TIMESTAMP(3),
  ADD COLUMN "suspended_by" TEXT,
  ADD COLUMN "suspended_reason" TEXT,
  ADD COLUMN "reactivated_at" TIMESTAMP(3),
  ADD COLUMN "reactivated_by" TEXT,
  ADD COLUMN "last_activity_at" TIMESTAMP(3);

CREATE INDEX "users_status_idx" ON "users"("status");

-- Structured admin audit log fields.
ALTER TABLE "audit_logs"
  ADD COLUMN "admin_id" TEXT,
  ADD COLUMN "target_user_id" TEXT,
  ADD COLUMN "reason" TEXT;

ALTER TABLE "audit_logs"
  ADD CONSTRAINT "audit_logs_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "audit_logs"
  ADD CONSTRAINT "audit_logs_target_user_id_fkey" FOREIGN KEY ("target_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "audit_logs_admin_id_idx" ON "audit_logs"("admin_id");
CREATE INDEX "audit_logs_target_user_id_idx" ON "audit_logs"("target_user_id");

-- Wallet transaction ledger.
CREATE TABLE "wallet_transactions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "balance_after" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'completed',
    "reference" TEXT,
    "description" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wallet_transactions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "wallet_transactions_user_id_idx" ON "wallet_transactions"("user_id");
CREATE INDEX "wallet_transactions_created_at_idx" ON "wallet_transactions"("created_at");

ALTER TABLE "wallet_transactions"
  ADD CONSTRAINT "wallet_transactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Company ledger (expenses / revenue adjustments).
CREATE TABLE "company_ledger" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "description" TEXT,
    "admin_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "company_ledger_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "company_ledger_created_at_idx" ON "company_ledger"("created_at");

ALTER TABLE "company_ledger"
  ADD CONSTRAINT "company_ledger_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
