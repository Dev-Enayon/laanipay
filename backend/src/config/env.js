import dotenv from 'dotenv';

dotenv.config();

const REQUIRED = ['DATABASE_URL', 'JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET', 'PAYSTACK_SECRET_KEY'];

export const env = {
  port: parseInt(process.env.PORT ?? '5000', 10),
  nodeEnv: process.env.NODE_ENV ?? 'development',
  databaseUrl: process.env.DATABASE_URL,
  jwtAccessSecret: process.env.JWT_ACCESS_SECRET,
  jwtRefreshSecret: process.env.JWT_REFRESH_SECRET,
  jwtAccessExpiry: '15m',
  jwtRefreshExpiry: '7d',
  paystackSecretKey: process.env.PAYSTACK_SECRET_KEY,
  resendApiKey: process.env.RESEND_API_KEY,
  mailFrom: process.env.MAIL_FROM ?? 'LaaniPay <onboarding@resend.dev>',
  mailReplyTo: process.env.MAIL_REPLY_TO,
  frontendUrl:
    process.env.FRONTEND_URL ??
    (process.env.CLIENT_ORIGIN ?? 'http://localhost:5173').split(',')[0].trim(),
  clientOrigins: [
    'https://laanipay.vercel.app',
    ...(process.env.CLIENT_ORIGIN ?? 'http://localhost:5173')
      .split(',')
      .map((origin) => origin.trim()),
  ],
  emailVerificationEnabled:
    (process.env.EMAIL_VERIFICATION_ENABLED ?? 'true').toLowerCase() === 'true',
  activationFeeKobo: 150000,
  serviceChargeKobo: 30000, // ₦300 monthly subscription (admin settings are authoritative; env is the fallback)
  serviceChargeCurrency: 'NGN',
  serviceChargeCron: process.env.SERVICE_CHARGE_CRON ?? '0 0 1 * *', // 1st of month, midnight
  serviceChargeEnabled: (process.env.SERVICE_CHARGE_ENABLED ?? 'false').toLowerCase() === 'true',
  // Withdrawals: external bank transfers via Paystack are disabled by default.
  // When disabled, withdrawal requests are recorded and reserved, and settled
  // through the admin-verified payout flow (no faked bank payouts).
  withdrawalBankTransferEnabled:
    (process.env.WITHDRAWAL_BANK_TRANSFER_ENABLED ?? 'false').toLowerCase() === 'true',
  // Minimum hours that must elapse between two cohort-week advances. Guards
  // against accidental double advancement (cron + manual run, overlapping
  // instances). 0 disables the guard. Parse fail-safe: an unset or INVALID
  // value falls back to the safe default (6) so a typo can never silently turn
  // this financial guard off.
  cohortMinAdvanceHours: (() => {
    const raw = process.env.COHORT_MIN_ADVANCE_HOURS;
    if (raw === undefined || raw === null || raw.trim() === '') return 6;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) return 6;
    return Math.floor(n);
  })(),
  adminEmail: (process.env.ADMIN_EMAIL ?? 'admin@laanipay.ng').trim().toLowerCase(),
  bcryptRounds: 10,
};

for (const key of REQUIRED) {
  if (!process.env[key]) {
    if (env.nodeEnv === 'production') {
      throw new Error(`[env] Missing required environment variable: ${key}`);
    }
    console.warn(`[env] ${key} is not set — using dev placeholder. Set values in backend/.env`);
  }
}
