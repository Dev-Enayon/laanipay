-- Add email-verification columns to users.

ALTER TABLE "users"
  ADD COLUMN "email_verified_at" TIMESTAMP(3),
  ADD COLUMN "verification_token" TEXT,
  ADD COLUMN "verification_token_expiry" TIMESTAMP(3);

CREATE UNIQUE INDEX "users_verification_token_key" ON "users"("verification_token");
