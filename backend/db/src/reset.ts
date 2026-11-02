import { pool } from './pool';
import { migrate } from './migrate';
import { seed } from './seed';

async function reset(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('DROP SCHEMA public CASCADE');
    await client.query('CREATE SCHEMA public');
  } finally {
    client.release();
  }
  await migrate();
  await seed(true);
}

reset()
  .then(() => pool.end())
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
