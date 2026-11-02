import path from 'node:path';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(import.meta.dirname, '../../..', '.env') });

export const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgres://localhost:5432/hiring_intelligence';
