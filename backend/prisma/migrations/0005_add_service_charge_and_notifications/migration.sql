-- Add Monthly ₦500 Service Charge table
CREATE TABLE "service_charges" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "amount_kobo" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'NGN',
    "billing_month" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'collected',
    "failure_reason" TEXT,
    "wallet_transaction_id" TEXT,
    "credited_to" TEXT,
    "company_ledger_id" TEXT,
    "paystack_reference" TEXT,
    "paystack_status" TEXT,
    "collected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "service_charges_pkey" PRIMARY KEY ("id")
);

-- Add In-app Notification table
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'info',
    "read_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- Unique constraint: a user can only be charged once per billing month
CREATE UNIQUE INDEX "service_charges_user_id_billing_month_key" ON "service_charges"("user_id", "billing_month");
CREATE INDEX "service_charges_billing_month_status_idx" ON "service_charges"("billing_month", "status");
CREATE INDEX "service_charges_status_idx" ON "service_charges"("status");
CREATE INDEX "service_charges_user_id_idx" ON "service_charges"("user_id");

CREATE INDEX "notifications_user_id_idx" ON "notifications"("user_id");
CREATE INDEX "notifications_created_at_idx" ON "notifications"("created_at");

-- Foreign keys
ALTER TABLE "service_charges" ADD CONSTRAINT "service_charges_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
