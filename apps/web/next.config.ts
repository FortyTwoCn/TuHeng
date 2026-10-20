import type { NextConfig } from 'next';
const config: NextConfig = {
  transpilePackages: ['@tuheng/ui'],
  serverExternalPackages: ['@prisma/client', 'sharp', 'bullmq', 'ioredis'],
  poweredByHeader: false,
};
export default config;
