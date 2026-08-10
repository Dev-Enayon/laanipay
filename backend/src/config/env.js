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
  clientOrigins: (process.env.CLIENT_ORIGIN ?? 'http://localhost:5173')
    .split(',')
    .map((origin) => origin.trim()),
  activationFeeKobo: 150000,
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
