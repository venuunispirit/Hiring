import path from 'node:path';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(import.meta.dirname, '../../..', '.env') });

export const PORT = Number(process.env.API_PORT ?? 4000);
export const JWT_SECRET = process.env.JWT_SECRET ?? 'dev-only-secret';
export const WEB_ORIGIN = process.env.WEB_ORIGIN ?? 'http://localhost:5173';
export const UPLOAD_DIR = path.resolve(
  import.meta.dirname,
  '..',
  process.env.UPLOAD_DIR ?? 'uploads',
);
