import { Router } from 'express';
import bcrypt from 'bcrypt';
import { prisma } from '../lib/prisma.js';
import { issueTokenPair, verifyRefreshToken } from '../lib/jwt.js';
import { env } from '../config/env.js';
import { AppError, asyncHandler } from '../middleware/error.js';
import { requireAuth } from '../middleware/auth.js';
import { authLimiter, signupLimiter } from '../middleware/rateLimit.js';

const router = Router();

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_REGEX = /^[+\d][\d\s-]{6,17}$/;

function serializeUser(user) {
  return {
    id: user.id,
    fullName: user.fullName,
    email: user.email,
    phone: user.phone,
    activationStatus: user.activationStatus,
    referralCode: user.referralCode,
    createdAt: user.createdAt,
  };
}

router.post(
  '/signup',
  signupLimiter,
  asyncHandler(async (req, res) => {
    const { fullName, email, phone, password, referralCode } = req.body ?? {};

    const name = typeof fullName === 'string' ? fullName.trim() : '';
    const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
    const normalizedPhone = typeof phone === 'string' ? phone.trim() : '';
    const code = typeof referralCode === 'string' ? referralCode.trim() : '';

    if (!name || !normalizedEmail || !normalizedPhone || !password) {
      throw new AppError('All fields are required', 400);
    }
    if (!EMAIL_REGEX.test(normalizedEmail)) {
      throw new AppError('Enter a valid email address', 400);
    }
    if (!PHONE_REGEX.test(normalizedPhone)) {
      throw new AppError('Enter a valid phone number', 400);
    }
    if (typeof password !== 'string' || password.length < 8) {
      throw new AppError('Password must be at least 8 characters', 400);
    }

    const existing = await prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (existing) {
      throw new AppError('An account with this email already exists', 409);
    }

    let referrer = null;
    if (code) {
      referrer = await prisma.user.findUnique({ where: { referralCode: code } });
      if (!referrer) {
        throw new AppError('Invalid referral code', 400);
      }
    }

    const passwordHash = await bcrypt.hash(password, env.bcryptRounds);

    const user = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          fullName: name,
          email: normalizedEmail,
          phone: normalizedPhone,
          passwordHash,
        },
      });
      await tx.wallet.create({ data: { userId: created.id } });
      if (referrer) {
        await tx.mlmReferral.create({
          data: { userId: created.id, referrerId: referrer.id, level: 1 },
        });
      }
      await tx.auditLog.create({
        data: {
          userId: created.id,
          action: 'USER_SIGNUP',
          metadata: { email: normalizedEmail, referredBy: referrer?.email ?? null },
        },
      });
      return created;
    });

    const tokens = issueTokenPair(user.id);
    res.status(201).json({ message: 'Signup successful', user: serializeUser(user), ...tokens });
  }),
);

router.post(
  '/login',
  authLimiter,
  asyncHandler(async (req, res) => {
    const { email, password } = req.body ?? {};
    const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';

    if (!normalizedEmail || !password) {
      throw new AppError('Email and password are required', 400);
    }

    const user = await prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (!user) {
      throw new AppError('Invalid email or password', 401);
    }

    const passwordMatches = await bcrypt.compare(password, user.passwordHash);
    if (!passwordMatches) {
      throw new AppError('Invalid email or password', 401);
    }

    await prisma.auditLog.create({
      data: { userId: user.id, action: 'USER_LOGIN', metadata: { email: user.email } },
    });

    const tokens = issueTokenPair(user.id);
    res.json({ user: serializeUser(user), ...tokens });
  }),
);

router.post(
  '/refresh',
  asyncHandler(async (req, res) => {
    const { refreshToken } = req.body ?? {};
    if (typeof refreshToken !== 'string' || !refreshToken) {
      throw new AppError('Refresh token is required', 400);
    }

    let payload;
    try {
      payload = verifyRefreshToken(refreshToken);
    } catch {
      throw new AppError('Invalid or expired refresh token', 401);
    }

    const user = await prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user) {
      throw new AppError('Invalid or expired refresh token', 401);
    }

    res.json(issueTokenPair(user.id));
  }),
);

router.post('/logout', (req, res) => {
  res.json({ message: 'Logged out' });
});

router.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({
      where: { id: req.userId },
      include: { wallet: { select: { balance: true } } },
    });
    if (!user) {
      throw new AppError('User not found', 404);
    }
    res.json({ user: { ...serializeUser(user), walletBalance: user.wallet?.balance ?? 0 } });
  }),
);

export default router;
