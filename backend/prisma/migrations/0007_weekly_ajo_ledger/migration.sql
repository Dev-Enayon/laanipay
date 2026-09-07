-- Weekly AJO cohorts + referral-reward ledger + platform config + webhook log
-- Adds:
--   - ContributionPlan.weekly_amount / cycle_weeks  (weekly contribution model)
--   - ContributionSubscription.cohort_id            (subscription belongs to a cohort)
--   - ContributionPayment.week_index / cohort_id    (which week a payment covers)
--   - Cohort / CohortMember / Payout                (52-position rotating cohort)
--   - ReferralReward                                (3-level rewards ledger)
--   - PlatformSetting                               (runtime-editable config)
--   - WebhookEvent                                  (idempotency + audit)

-- Weekly contribution model -------------------------------------------------
ALTER TABLE "contribution_plans" ADD COLUMN "weekly_amount" INTEGER;
ALTER TABLE "contribution_plans" ADD COLUMN "cycle_weeks" INTEGER NOT NULL DEFAULT 52;

ALTER TABLE "contribution_subscriptions" ADD COLUMN "cohort_id" TEXT;

ALTER TABLE "contribution_payments" ADD COLUMN "week_index" INTEGER;
ALTER TABLE "contribution_payments" ADD COLUMN "cohort_id" TEXT;

-- Platform settings ---------------------------------------------------------
CREATE TABLE "platform_settings" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB,
    "description" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "platform_settings_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "platform_settings_key_key" ON "platform_settings"("key");

-- Cohorts -------------------------------------------------------------------
CREATE TABLE "cohorts" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "plan_id" TEXT NOT NULL,
    "size" INTEGER NOT NULL DEFAULT 52,
    "status" TEXT NOT NULL DEFAULT 'RECRUITING',
    "current_week" INTEGER NOT NULL DEFAULT 1,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "cohorts_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "cohorts_plan_id_status_idx" ON "cohorts"("plan_id", "status");

ALTER TABLE "cohorts" ADD CONSTRAINT "cohorts_plan_id_fkey"
    FOREIGN KEY ("plan_id") REFERENCES "contribution_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "cohort_members" (
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
CREATE UNIQUE INDEX "cohort_members_cohort_id_position_key" ON "cohort_members"("cohort_id", "position");
CREATE UNIQUE INDEX "cohort_members_cohort_id_user_id_key" ON "cohort_members"("cohort_id", "user_id");
CREATE INDEX "cohort_members_user_id_idx" ON "cohort_members"("user_id");

ALTER TABLE "cohort_members" ADD CONSTRAINT "cohort_members_cohort_id_fkey"
    FOREIGN KEY ("cohort_id") REFERENCES "cohorts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "cohort_members" ADD CONSTRAINT "cohort_members_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Payouts -------------------------------------------------------------------
CREATE TABLE "payouts" (
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
CREATE UNIQUE INDEX "payouts_cohort_id_week_index_key" ON "payouts"("cohort_id", "week_index");
CREATE INDEX "payouts_user_id_idx" ON "payouts"("user_id");
CREATE INDEX "payouts_status_idx" ON "payouts"("status");

ALTER TABLE "payouts" ADD CONSTRAINT "payouts_cohort_id_fkey"
    FOREIGN KEY ("cohort_id") REFERENCES "cohorts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_cohort_member_id_fkey"
    FOREIGN KEY ("cohort_member_id") REFERENCES "cohort_members"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_plan_id_fkey"
    FOREIGN KEY ("plan_id") REFERENCES "contribution_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Referral rewards ledger ---------------------------------------------------
CREATE TABLE "referral_rewards" (
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
CREATE UNIQUE INDEX "referral_rewards_reference_key" ON "referral_rewards"("reference");
CREATE INDEX "referral_rewards_user_id_idx" ON "referral_rewards"("user_id");
CREATE INDEX "referral_rewards_source_user_id_type_idx" ON "referral_rewards"("source_user_id", "type");

ALTER TABLE "referral_rewards" ADD CONSTRAINT "referral_rewards_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "referral_rewards" ADD CONSTRAINT "referral_rewards_source_user_id_fkey"
    FOREIGN KEY ("source_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Webhook event log ---------------------------------------------------------
CREATE TABLE "webhook_events" (
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
CREATE UNIQUE INDEX "webhook_events_provider_event_reference_key" ON "webhook_events"("provider", "event", "reference");
CREATE INDEX "webhook_events_reference_idx" ON "webhook_events"("reference");
CREATE INDEX "webhook_events_created_at_idx" ON "webhook_events"("created_at");

-- Subscription cohort FK ----------------------------------------------------
ALTER TABLE "contribution_subscriptions" ADD CONSTRAINT "contribution_subscriptions_cohort_id_fkey"
    FOREIGN KEY ("cohort_id") REFERENCES "cohorts"("id") ON DELETE SET NULL ON UPDATE CASCADE;