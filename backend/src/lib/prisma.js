import { PrismaClient } from '@prisma/client';
import { PrismaNeon } from '@prisma/adapter-neon';
import { env } from '../config/env.js';

const options = env.databaseUrl
  ? { adapter: new PrismaNeon({ connectionString: env.databaseUrl }) }
  : {};

export const prisma = new PrismaClient(options);
