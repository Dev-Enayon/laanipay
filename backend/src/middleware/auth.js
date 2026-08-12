import { verifyAccessToken } from '../lib/jwt.js';
import { prisma } from '../lib/prisma.js';

export async function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  let payload;
  try {
    payload = verifyAccessToken(header.slice(7));
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  const user = await prisma.user.findUnique({
    where: { id: payload.sub },
    select: {
      id: true,
      fullName: true,
      email: true,
      phone: true,
      role: true,
      status: true,
      activationStatus: true,
      referralCode: true,
      emailVerifiedAt: true,
    },
  });

  if (!user) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  if (user.status === 'suspended') {
    return res.status(403).json({ error: 'Account suspended' });
  }

  req.user = user;
  req.userId = user.id;

  // Best-effort last-activity tracking; never fails the request.
  if (!req.path.startsWith('/api/admin/')) {
    prisma.user
      .update({ where: { id: user.id }, data: { lastActivityAt: new Date() } })
      .catch(() => {});
  }

  next();
}

export function requireActivated(req, res, next) {
  if (!req.user?.activationStatus) {
    return res.status(403).json({ error: 'Account not activated' });
  }
  next();
}

export function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}
