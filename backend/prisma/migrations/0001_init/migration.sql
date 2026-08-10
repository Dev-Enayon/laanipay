-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "full_name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "activation_status" BOOLEAN NOT NULL DEFAULT false,
    "referral_code" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wallets" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "balance" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "wallets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activation_payments" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "paystack_reference" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "verified_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "activation_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mlm_referrals" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "referrer_id" TEXT,
    "level" INTEGER NOT NULL,
    "bonus_earned" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mlm_referrals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mlm_ranks" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "rank" TEXT NOT NULL,
    "achieved_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mlm_ranks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contribution_plans" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "monthly_amount" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contribution_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contribution_subscriptions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "plan_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "next_payment_date" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contribution_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contribution_payments" (
    "id" TEXT NOT NULL,
    "subscription_id" TEXT NOT NULL,
    "paystack_reference" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "paid_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contribution_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "user_id" TEXT,
    "action" TEXT NOT NULL,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_referral_code_key" ON "users"("referral_code");

-- CreateIndex
CREATE UNIQUE INDEX "wallets_user_id_key" ON "wallets"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "activation_payments_paystack_reference_key" ON "activation_payments"("paystack_reference");

-- CreateIndex
CREATE INDEX "activation_payments_user_id_idx" ON "activation_payments"("user_id");

-- CreateIndex
CREATE INDEX "mlm_referrals_referrer_id_idx" ON "mlm_referrals"("referrer_id");

-- CreateIndex
CREATE INDEX "mlm_referrals_user_id_idx" ON "mlm_referrals"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "mlm_referrals_user_id_referrer_id_level_key" ON "mlm_referrals"("user_id", "referrer_id", "level");

-- CreateIndex
CREATE INDEX "mlm_ranks_user_id_idx" ON "mlm_ranks"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "contribution_plans_name_key" ON "contribution_plans"("name");

-- CreateIndex
CREATE INDEX "contribution_subscriptions_user_id_idx" ON "contribution_subscriptions"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "contribution_payments_paystack_reference_key" ON "contribution_payments"("paystack_reference");

-- CreateIndex
CREATE INDEX "contribution_payments_subscription_id_idx" ON "contribution_payments"("subscription_id");

-- CreateIndex
CREATE INDEX "audit_logs_user_id_idx" ON "audit_logs"("user_id");

-- AddForeignKey
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activation_payments" ADD CONSTRAINT "activation_payments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mlm_referrals" ADD CONSTRAINT "mlm_referrals_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mlm_referrals" ADD CONSTRAINT "mlm_referrals_referrer_id_fkey" FOREIGN KEY ("referrer_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mlm_ranks" ADD CONSTRAINT "mlm_ranks_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contribution_subscriptions" ADD CONSTRAINT "contribution_subscriptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contribution_subscriptions" ADD CONSTRAINT "contribution_subscriptions_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "contribution_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contribution_payments" ADD CONSTRAINT "contribution_payments_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "contribution_subscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

