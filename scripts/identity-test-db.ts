import 'dotenv/config';
import { Client } from 'pg';
const url = new URL(process.env.DATABASE_URL!);
url.pathname = '/tuheng_test';
const client = new Client({ connectionString: url.href });
await client.connect();
try {
  await client.query('CREATE SCHEMA IF NOT EXISTS identity_refactor');
  console.log('Isolated identity_refactor schema in tuheng_test ready (existing data preserved).');
} finally {
  await client.end();
}
