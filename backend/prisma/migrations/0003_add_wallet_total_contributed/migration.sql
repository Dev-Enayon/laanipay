-- Track the total amount (kobo) a user has contributed via verified
-- contribution payments, surfaced on the user's wallet.

ALTER TABLE "wallets" ADD COLUMN "total_contributed" INTEGER NOT NULL DEFAULT 0;
