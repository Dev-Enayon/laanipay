import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { env } from './config/env.js';
import { prisma } from './lib/prisma.js';
import authRoutes from './routes/auth.routes.js';
import paymentRoutes from './routes/payment.routes.js';
import mlmRoutes from './routes/mlm.routes.js';
import contributionRoutes from './routes/contribution.routes.js';
import walletRoutes from './routes/wallet.routes.js';
import auditRoutes from './routes/audit.routes.js';
import adminRoutes from './routes/admin.routes.js';
import serviceChargeRoutes from './routes/serviceCharge.routes.js';
import { notFoundHandler, errorHandler } from './middleware/error.js';

export function createApp() {
  const app = express();

  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(helmet());
  app.use(
    cors({
      origin: env.clientOrigins,
      credentials: true,
    }),
  );

  app.use(morgan(env.nodeEnv === 'production' ? 'combined' : 'dev'));

  // Capture the raw request body for Paystack webhook signature verification.
  app.use(
    express.json({
      limit: '1mb',
      verify: (req, _res, buf) => {
        req.rawBody = buf;
      },
    }),
  );

  app.get('/health', (req, res) => {
    res.json({ status: 'ok', service: 'laanipay-api', uptime: process.uptime() });
  });

  app.get('/api/config', (req, res) => {
    res.json({
      emailVerificationEnabled: env.emailVerificationEnabled,
      activationFeeKobo: env.activationFeeKobo,
    });
  });

  app.get('/health/ready', async (req, res) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      res.json({ status: 'ready', database: 'connected' });
    } catch (err) {
      res.status(503).json({ status: 'not_ready', database: 'unreachable' });
    }
  });

  app.use('/api/auth', authRoutes);
  app.use('/api/payments', paymentRoutes);
  app.use('/api/mlm', mlmRoutes);
  app.use('/api/contributions', contributionRoutes);
  app.use('/api/wallet', walletRoutes);
  app.use('/api/audit', auditRoutes);
  app.use('/api/admin', adminRoutes);
  app.use('/api/service-charges', serviceChargeRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
