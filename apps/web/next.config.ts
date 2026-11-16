import type { NextConfig } from 'next';
const config: NextConfig = {
  // Next's dev resource/HMR guard takes hostnames; API/auth checks use exact origins.
  allowedDevOrigins: [
    process.env.NEXTAUTH_URL,
    ...(process.env.APP_ALLOWED_ORIGINS ?? '').split(','),
  ]
    .filter((origin): origin is string => Boolean(origin?.trim()))
    .map((origin) => new URL(origin.trim()).hostname),
  transpilePackages: ['@tuheng/ui', '@tuheng/geometry-core', '@tuheng/geometry-editor'],
  serverExternalPackages: ['@prisma/client', 'sharp', 'bullmq', 'ioredis'],
  poweredByHeader: false,
};
export default config;
