import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';
import { SMTPServer } from 'smtp-server';
import { hash } from 'bcryptjs';
import { prisma } from '@tuheng/database';
import type { Actor } from '@tuheng/domain';
import {
  authenticate,
  bindVerifiedEmail,
  changeOwnPassword,
  loadIdentity,
} from '../../packages/infrastructure/src/identity-auth';
import {
  requestVerification,
  consumeVerification,
} from '../../packages/infrastructure/src/identity-challenges';
import { saveSMTP, manageSMTP } from '../../packages/infrastructure/src/email';
import { reauthenticate } from '../../packages/infrastructure/src/identity-security';
const tag = randomUUID();
const messages: string[] = [];
let server: SMTPServer, root: Actor, studentId: string, teacherId: string, schoolId: string;
const password = 'Integration-Identity-2026!';
beforeAll(async () => {
  process.env.TUHENG_SECRET_KEYS = JSON.stringify({ test: randomBytes(32).toString('base64') });
  process.env.TUHENG_SECRET_ACTIVE_KEY = 'test';
  server = new SMTPServer({
    disabledCommands: ['AUTH', 'STARTTLS'],
    onData(stream, _session, callback) {
      let text = '';
      stream.on('data', (c) => {
        text += c.toString();
      });
      stream.on('end', () => {
        messages.push(text);
        callback();
      });
    },
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.server.address() as { port: number }).port;
  process.env.TUHENG_OUTBOUND_ALLOWLIST = '127.0.0.1:' + port;
  const u = await prisma.user.findUniqueOrThrow({ where: { id: 'admin' } });
  root = await loadIdentity(u.id, 'STAFF', u.tokenVersion, false);
  const { proof } = await reauthenticate(root, process.env.SEED_PASSWORD!);
  const config = await saveSMTP(
    root,
    {
      name: 'Local SMTP integration receiver',
      host: '127.0.0.1',
      port,
      tls: 'LOCAL_TEST',
      username: '',
      fromName: 'TuHeng test',
      fromEmail: 'test@tuheng.invalid',
    },
    '',
    proof,
  );
  await manageSMTP(root, 'VERIFY', config.id, proof);
  await manageSMTP(root, 'ENABLE', config.id, proof);
  const school = await prisma.school.create({
    data: { code: 'TEST-' + tag, name: '自动化测试学校' },
  });
  schoolId = school.id;
  for (const kind of ['STUDENT', 'TEACHER'] as const) {
    const user = await prisma.user.create({
      data: {
        name: 'Identity Test',
        email: '',
        roles: [kind],
        realm: kind === 'STUDENT' ? 'STUDENT' : 'STAFF',
        kind,
        schoolId,
        loginId: kind === 'TEACHER' ? 'T-' + tag : null,
        studentNumber: kind === 'STUDENT' ? '00123456' : null,
        passwordHash: await hash(password, 4),
      },
    });
    if (kind === 'STUDENT') studentId = user.id;
    else teacherId = user.id;
  }
});
afterAll(async () => {
  await new Promise<void>((resolve) => server.close(resolve));
  await prisma.$disconnect();
});
describe.sequential('real database + local SMTP identity flows', () => {
  it('ID01/03/06: leading-zero school number and staff ID are realm isolated, first login restricted', async () => {
    const login = await authenticate({
      realm: 'STUDENT',
      method: 'PASSWORD',
      identifier: '00123456',
      schoolId,
      password,
    });
    expect(login?.id).toBe(studentId);
    expect(login?.onboarding).toBe(true);
    expect(
      await authenticate({
        realm: 'STAFF',
        method: 'PASSWORD',
        identifier: '00123456',
        schoolId,
        password,
      }),
    ).toBeNull();
    expect(
      await authenticate({
        realm: 'STUDENT',
        method: 'PASSWORD',
        identifier: 'T-' + tag,
        schoolId,
        password,
      }),
    ).toBeNull();
    expect(
      (await authenticate({ realm: 'STAFF', method: 'PASSWORD', identifier: 'T-' + tag, password }))
        ?.id,
    ).toBe(teacherId);
  });
  it('ID04/09: first password change revokes old session and enables student without email', async () => {
    const actor = await loadIdentity(studentId, 'STUDENT', 0, true);
    await changeOwnPassword(actor, password, password + 'new');
    await expect(loadIdentity(studentId, 'STUDENT', 0, true)).rejects.toThrow('SESSION_REVOKED');
    expect(
      (
        await authenticate({
          realm: 'STUDENT',
          method: 'PASSWORD',
          schoolId,
          identifier: '00123456',
          password: password + 'new',
        })
      )?.onboarding,
    ).toBe(false);
  });
  it('EM01/ID03: staff password step persists, SMTP delivers actual code and binding completes onboarding', async () => {
    let actor = await loadIdentity(teacherId, 'STAFF', 0, true);
    await changeOwnPassword(actor, password, password + 'new');
    actor = await loadIdentity(teacherId, 'STAFF', 1, true);
    expect(actor.onboarding).toBe(true);
    const email = 'teacher-' + tag + '@test.invalid';
    const challenge = await requestVerification({
      realm: 'STAFF',
      purpose: 'BIND_EMAIL',
      email,
      actor,
    });
    expect(messages.length).toBeGreaterThan(0);
    const stored = await prisma.verificationChallenge.findUniqueOrThrow({
      where: { id: challenge.challengeId },
    });
    const mail = messages.at(-1)!;
    // Numeric code remains legible in MIME quoted-printable HTML/text.
    const part = mail.match(
      /Content-Type: text\/html[\s\S]*?Content-Transfer-Encoding: (\S+)\r\n\r\n([\s\S]*?)(?=\r\n--)/i,
    )!;
    const html =
      part[1].toLowerCase() === 'base64'
        ? Buffer.from(part[2], 'base64').toString('utf8')
        : part[2]
            .replace(/=\r?\n/g, '')
            .replace(/=([A-F0-9]{2})/gi, (_m, h) => String.fromCharCode(parseInt(h, 16)));
    const code = html.match(/<strong>(\d{6})<\/strong>/)?.[1] ?? '';
    expect(code).toMatch(/^\d{6}$/);
    expect(stored.digest).not.toContain(code);
    await expect(
      consumeVerification({
        realm: 'STUDENT',
        purpose: 'BIND_EMAIL',
        challengeId: challenge.challengeId,
        code,
      }),
    ).rejects.toThrow('INVALID_OR_EXPIRED_CODE');
    await bindVerifiedEmail(actor, {
      challengeId: challenge.challengeId,
      code,
      purpose: 'BIND_EMAIL',
    });
    expect(
      (
        await authenticate({
          realm: 'STAFF',
          method: 'PASSWORD',
          identifier: email,
          password: password + 'new',
        })
      )?.onboarding,
    ).toBe(false);
    await expect(
      consumeVerification({
        realm: 'STAFF',
        purpose: 'BIND_EMAIL',
        challengeId: challenge.challengeId,
        code,
      }),
    ).rejects.toThrow('INVALID_OR_EXPIRED_CODE');
  });
  it('ID09: disabled school revokes existing sessions and login', async () => {
    await prisma.school.update({ where: { id: schoolId }, data: { active: false } });
    await expect(loadIdentity(studentId, 'STUDENT', 1, false)).rejects.toThrow('SCHOOL_DISABLED');
    expect(
      await authenticate({
        realm: 'STUDENT',
        method: 'PASSWORD',
        schoolId,
        identifier: '00123456',
        password: password + 'new',
      }),
    ).toBeNull();
  });
});
