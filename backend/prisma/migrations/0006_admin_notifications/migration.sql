-- Admin notification / messaging system
-- Evolves the existing `notifications` table into a message-level model that
-- supports admin broadcasts (recipient targeting, scheduling, status) while
-- preserving direct per-user (system/service-charge) notifications, plus a new
-- NotificationReceipt table for per-recipient read/dismiss state.

-- Direct notifications already carry a user_id; broadcast rows leave it NULL.
ALTER TABLE "notifications" ALTER COLUMN "user_id" DROP NOT NULL;

ALTER TABLE "notifications" ADD COLUMN "category" TEXT;
ALTER TABLE "notifications" ADD COLUMN "sender_id" TEXT;
ALTER TABLE "notifications" ADD COLUMN "recipient_type" TEXT;
ALTER TABLE "notifications" ADD COLUMN "recipient_ids" JSONB;
ALTER TABLE "notifications" ADD COLUMN "recipient_role" TEXT;
ALTER TABLE "notifications" ADD COLUMN "recipient_count" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "notifications" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'sent';
ALTER TABLE "notifications" ADD COLUMN "scheduled_at" TIMESTAMP(3);
ALTER TABLE "notifications" ADD COLUMN "sent_at" TIMESTAMP(3);
ALTER TABLE "notifications" ADD COLUMN "push_status" TEXT;
ALTER TABLE "notifications" ADD COLUMN "dismissed_at" TIMESTAMP(3);

CREATE INDEX "notifications_sender_id_idx" ON "notifications"("sender_id");
CREATE INDEX "notifications_status_idx" ON "notifications"("status");
CREATE INDEX "notifications_scheduled_at_idx" ON "notifications"("scheduled_at");

ALTER TABLE "notifications" ADD CONSTRAINT "notifications_sender_id_fkey"
    FOREIGN KEY ("sender_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Per-recipient read / dismiss / delivery state for broadcast notifications.
CREATE TABLE "notification_receipts" (
    "id" TEXT NOT NULL,
    "notification_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "read_at" TIMESTAMP(3),
    "dismissed_at" TIMESTAMP(3),
    "delivered_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_receipts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "notification_receipts_notification_id_user_id_key" ON "notification_receipts"("notification_id", "user_id");
CREATE INDEX "notification_receipts_user_id_idx" ON "notification_receipts"("user_id");
CREATE INDEX "notification_receipts_notification_id_idx" ON "notification_receipts"("notification_id");

ALTER TABLE "notification_receipts" ADD CONSTRAINT "notification_receipts_notification_id_fkey"
    FOREIGN KEY ("notification_id") REFERENCES "notifications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "notification_receipts" ADD CONSTRAINT "notification_receipts_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;