import 'dotenv/config';
import { defineConfig } from 'prisma/config';
import { PrismaPg } from '@prisma/adapter-pg';
export default defineConfig({
  schema: 'packages/database/prisma/schema.prisma',
  experimental: { adapter: true },
  engine: 'js',
  adapter: async () => new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
  migrations: { path: 'packages/database/prisma/migrations' },
});
