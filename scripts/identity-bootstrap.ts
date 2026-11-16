import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { hash } from 'bcryptjs';
import { prisma } from '@tuheng/database';
import {
  temporaryPassword,
  invalidateCredentials,
} from '../packages/infrastructure/src/identity-security';
const reset = process.argv.includes('--reset-root');
const outputIndex = process.argv.indexOf('--output');
if (outputIndex < 0 || !process.argv[outputIndex + 1])
  throw new Error('Specify --output to a private local file; never use a public directory.');
const file = path.resolve(process.argv[outputIndex + 1]);
if (!file.startsWith(path.resolve('.runtime') + path.sep))
  throw new Error('Bootstrap delivery must be in the git-ignored .runtime directory.');
const password = temporaryPassword();
await mkdir(path.dirname(file), { recursive: true });
try {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(72651321)`;
    const prior = await tx.user.findFirst({ where: { kind: 'SITE_ADMIN' } });
    if (prior && !reset)
      throw new Error('ROOT_ALREADY_EXISTS: installation is idempotent; no credentials changed.');
    if (!prior && reset) throw new Error('ROOT_NOT_FOUND');
    const data = {
      name: '站点管理员',
      email: '',
      kind: 'SITE_ADMIN',
      realm: 'STAFF',
      loginId: 'admin',
      roles: ['ADMIN'],
      passwordHash: await hash(password, 12),
      mustChangePassword: true,
      passwordExpiresAt: new Date(Date.now() + 7 * 86400000),
      active: true,
    };
    const user = prior
      ? await tx.user.update({
          where: { id: prior.id },
          data: {
            passwordHash: data.passwordHash,
            mustChangePassword: true,
            passwordExpiresAt: data.passwordExpiresAt,
            active: true,
            tokenVersion: { increment: 1 },
            credentialVersion: { increment: 1 },
          },
        })
      : await tx.user.create({ data: { ...data, id: randomUUID() } });
    if (prior) await invalidateCredentials(tx, prior.id);
    await tx.auditLog.create({
      data: {
        actorId: user.id,
        action: reset ? 'ROOT_CLI_RECOVERY' : 'ROOT_INSTALLED',
        resourceId: user.id,
        details: { temporaryPasswordDays: 7 },
      },
    });
    // Exclusive creation prevents replacing a previous delivery file. Transaction rolls back on failure.
    await writeFile(
      file,
      `图衡管理员安装凭据（敏感信息，请安全交付）\n登录 ID：admin\n临时密码：${password}\n7 天内有效；首次登录必须改密并验证邮箱。\n`,
      { encoding: 'utf8', flag: 'wx', mode: 0o600 },
    );
  });
  console.log(
    `Administrator credential delivery written to ${file}. No password printed. Delete the file after secure handoff.`,
  );
} finally {
  await prisma.$disconnect();
}
