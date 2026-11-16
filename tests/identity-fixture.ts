import { prisma } from '@tuheng/database';
import { securityDigest } from '../packages/infrastructure/src/security-throttle';

// Reset automation fixture counters between runs; never alter application throttling.
export async function resetIdentityFixtureThrottle(who = 'admin') {
  if (
    process.env.SEED_TEST_ACCOUNTS !== '1' ||
    !new URL(process.env.DATABASE_URL!).pathname.endsWith('_test') ||
    !['admin', 'teacher', 'student', 'student2'].includes(who)
  ) {
    throw new Error('ISOLATED_IDENTITY_FIXTURE_REQUIRED');
  }
  const realm = who.startsWith('student') ? 'STUDENT' : 'STAFF';
  await prisma.securityThrottle.deleteMany({
    where: {
      id: {
        in: [
          securityDigest(`reauth:${who}`),
          securityDigest(`login:${realm}::${who}@tuheng.local`),
        ],
      },
    },
  });
}
