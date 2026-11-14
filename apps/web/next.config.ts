import type { NextConfig } from 'next';
const config: NextConfig = {
  transpilePackages: ['@tuheng/ui', '@tuheng/geometry-core', '@tuheng/geometry-editor'],
  serverExternalPackages: ['@prisma/client', 'sharp', 'bullmq', 'ioredis'],
  poweredByHeader: false,
};
export default config;
