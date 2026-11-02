import { pool } from '@hi/db';
import { buildApp } from './app';
import { PORT } from './env';
import { startWorker } from './worker';

const app = await buildApp();
const worker = startWorker();

await app.listen({ port: PORT, host: '0.0.0.0' });
console.log(`API listening on http://localhost:${PORT}/v1`);

async function shutdown(signal: string): Promise<void> {
  console.log(`${signal} received, shutting down`);
  clearInterval(worker);
  await app.close();
  await pool.end();
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
