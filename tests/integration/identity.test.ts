import { resetIdentityFixtureThrottle } from '../identity-fixture';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
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
  await resetIdentityFixtureThrottle();
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
  it('S02: editing an older SMTP version keeps its own credential and rejects stale saves atomically', async () => {
    const { proof } = await reauthenticate(root, process.env.SEED_PASSWORD!);
    const active = await prisma.sMTPConfigurationVersion.findFirstOrThrow({
      where: { enabled: true },
    });
    const first = await saveSMTP(root, active.config, 'smtp-test-secret-a', proof);
    const second = await saveSMTP(root, active.config, 'smtp-test-secret-b', proof);
    const copy = await saveSMTP(root, active.config, '', proof, {
      sourceId: first.id,
      expectedVersion: second.version,
    });
    const originals = await prisma.sMTPConfigurationVersion.findMany({
      where: { id: { in: [first.id, second.id, copy.id] } },
    });
    expect(originals.find((v) => v.id === copy.id)?.secretId).toBe(
      originals.find((v) => v.id === first.id)?.secretId,
    );
    expect(originals.find((v) => v.id === copy.id)?.secretId).not.toBe(
      originals.find((v) => v.id === second.id)?.secretId,
    );
    expect(copy.enabled).toBe(false);
    await manageSMTP(root, 'ENABLE', first.id, proof, undefined, active.id);
    await expect(
      manageSMTP(root, 'ENABLE', second.id, proof, undefined, active.id),
    ).rejects.toThrow('CONFIGURATION_CHANGED');
    expect(
      (await prisma.sMTPConfigurationVersion.findFirstOrThrow({ where: { enabled: true } })).id,
    ).toBe(first.id);
    await manageSMTP(root, 'ENABLE', active.id, proof, undefined, first.id);
    const secretCount = await prisma.secretRecord.count();
    await expect(
      saveSMTP(root, active.config, 'do-not-store-a-conflicted-secret', proof, {
        sourceId: first.id,
        expectedVersion: second.version,
      }),
    ).rejects.toThrow('CONFIGURATION_CHANGED');
    expect(await prisma.secretRecord.count()).toBe(secretCount);
    expect(
      (await prisma.sMTPConfigurationVersion.findUniqueOrThrow({ where: { id: active.id } }))
        .enabled,
    ).toBe(true);
  });
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
  it('EM02/03: five failures, expiration, resend invalidation and concurrent replay are enforced', async () => {
    const u = await prisma.user.create({
      data: {
        name: '挑战测试',
        email: '',
        kind: 'STUDENT',
        realm: 'STUDENT',
        roles: ['STUDENT'],
        schoolId,
        studentNumber: 'challenge-' + tag,
        passwordHash: await hash(password, 4),
        mustChangePassword: false,
      },
    });
    const actor = await loadIdentity(u.id, 'STUDENT', 0, false);
    const issue = async (label: string) => {
      const challenge = await requestVerification({
        realm: 'STUDENT',
        purpose: 'BIND_EMAIL',
        actor,
        email: label + tag + '@test.invalid',
      });
      const part = messages
        .at(-1)!
        .match(
          /Content-Type: text\/html[\s\S]*?Content-Transfer-Encoding: (\S+)\r\n\r\n([\s\S]*?)(?=\r\n--)/i,
        )!;
      const html =
        part[1].toLowerCase() === 'base64'
          ? Buffer.from(part[2], 'base64').toString('utf8')
          : part[2]
              .replace(/=\r?\n/g, '')
              .replace(/=([A-F0-9]{2})/gi, (_m, h) => String.fromCharCode(parseInt(h, 16)));
      return {
        challengeId: challenge.challengeId,
        realm: 'STUDENT' as const,
        purpose: 'BIND_EMAIL' as const,
        code: html.match(/<strong>(\d{6})<\/strong>/)![1],
      };
    };
    const first = await issue('failures');
    for (let i = 0; i < 5; i++)
      await expect(
        consumeVerification({ ...first, code: first.code === '000000' ? '111111' : '000000' }),
      ).rejects.toThrow('INVALID_OR_EXPIRED_CODE');
    await expect(consumeVerification(first)).rejects.toThrow('INVALID_OR_EXPIRED_CODE');
    expect(
      (await prisma.verificationChallenge.findUniqueOrThrow({ where: { id: first.challengeId } }))
        .failures,
    ).toBe(5);
    const second = await issue('resend'),
      third = await issue('replacement');
    await expect(consumeVerification(second)).rejects.toThrow('INVALID_OR_EXPIRED_CODE');
    const results = await Promise.allSettled([
      consumeVerification(third),
      consumeVerification(third),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const expired = await issue('expired');
    await prisma.verificationChallenge.update({
      where: { id: expired.challengeId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    await expect(consumeVerification(expired)).rejects.toThrow('INVALID_OR_EXPIRED_CODE');
    await expect(
      requestVerification({
        realm: 'STUDENT',
        purpose: 'BIND_EMAIL',
        actor,
        email: 'expired' + tag + '@test.invalid',
      }),
    ).rejects.toThrow('RATE_LIMITED');
  });
  it('ID08: an in-flight code cannot outlive a password/session version change', async () => {
    const user = await prisma.user.create({
      data: {
        name: '安全版本',
        email: 'safe-' + tag + '@test.invalid',
        emailNormalized: 'safe-' + tag + '@test.invalid',
        emailVerifiedAt: new Date(),
        kind: 'STUDENT',
        realm: 'STUDENT',
        roles: ['STUDENT'],
        schoolId,
        studentNumber: 'safe-' + tag,
        passwordHash: await hash(password, 4),
        mustChangePassword: false,
      },
    });
    const actor = await loadIdentity(user.id, 'STUDENT', 0, false);
    const results = await Promise.allSettled([
      changeOwnPassword(actor, password, password + 'One'),
      changeOwnPassword(actor, password, password + 'Two'),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const challenge = await requestVerification({
      realm: 'STUDENT',
      purpose: 'LOGIN',
      email: user.emailNormalized!,
    });
    await prisma.user.update({ where: { id: user.id }, data: { tokenVersion: { increment: 1 } } });
    // Even a correctly digested code is invalid after this security boundary.
    const row = await prisma.verificationChallenge.findUniqueOrThrow({
      where: { id: challenge.challengeId },
    });
    expect(row.tokenVersion).toBe(1);
    await expect(
      consumeVerification({
        challengeId: row.id,
        realm: 'STUDENT',
        purpose: 'LOGIN',
        code: '000000',
      }),
    ).rejects.toThrow('INVALID_OR_EXPIRED_CODE');
    expect(
      (await prisma.verificationChallenge.findUniqueOrThrow({ where: { id: row.id } })).failures,
    ).toBe(0);
  });
  it('EM03: configured SMTP with an untrusted test certificate is rejected', async () => {
    const secure = new SMTPServer({ secure: true, disabledCommands: ['AUTH'] });
    secure.on('error', () => {});
    await new Promise<void>((resolve) => secure.listen(0, '127.0.0.1', resolve));
    const port = (secure.server.address() as { port: number }).port,
      previous = process.env.TUHENG_OUTBOUND_ALLOWLIST;
    process.env.TUHENG_OUTBOUND_ALLOWLIST = '127.0.0.1:' + port;
    try {
      const { proof } = await reauthenticate(root, process.env.SEED_PASSWORD!);
      const config = await saveSMTP(
        root,
        {
          name: 'Invalid certificate fixture',
          host: '127.0.0.1',
          port,
          tls: 'TLS',
          username: '',
          fromName: 'Test',
          fromEmail: 'test@test.invalid',
        },
        '',
        proof,
      );
      await expect(manageSMTP(root, 'VERIFY', config.id, proof)).rejects.toThrow(
        'SMTP_CERTIFICATE_INVALID',
      );
      expect(
        (await prisma.sMTPConfigurationVersion.findUniqueOrThrow({ where: { id: config.id } }))
          .enabled,
      ).toBe(false);
      try {
        vi.stubEnv('NODE_ENV', 'production');
        await expect(
          saveSMTP(
            root,
            {
              name: 'Forbidden cleartext in production',
              host: '127.0.0.1',
              port,
              tls: 'LOCAL_TEST',
              username: '',
              fromName: 'Test',
              fromEmail: 'test@test.invalid',
            },
            '',
            proof,
          ),
        ).rejects.toThrow('SMTP_TLS_REQUIRED');
      } finally {
        vi.unstubAllEnvs();
      }
    } finally {
      process.env.TUHENG_OUTBOUND_ALLOWLIST = previous;
      await new Promise<void>((resolve) => secure.close(resolve));
    }
  });
  it('EM02: SMTP rejection is reported as failure and revokes the undelivered challenge', async () => {
    const failing = new SMTPServer({
      disabledCommands: ['AUTH', 'STARTTLS'],
      onData(stream, _session, done) {
        stream.resume();
        stream.on('end', () => done(new Error('test receiver rejects delivery')));
      },
    });
    await new Promise<void>((resolve) => failing.listen(0, '127.0.0.1', resolve));
    const port = (failing.server.address() as { port: number }).port,
      previous = process.env.TUHENG_OUTBOUND_ALLOWLIST;
    const original = await prisma.sMTPConfigurationVersion.findFirstOrThrow({
      where: { enabled: true },
    });
    const { proof } = await reauthenticate(root, process.env.SEED_PASSWORD!);
    try {
      process.env.TUHENG_OUTBOUND_ALLOWLIST = '127.0.0.1:' + port;
      const config = await saveSMTP(
        root,
        {
          name: 'SMTP rejection fixture',
          host: '127.0.0.1',
          port,
          tls: 'LOCAL_TEST',
          username: '',
          fromName: 'Test',
          fromEmail: 'test@test.invalid',
        },
        '',
        proof,
      );
      await manageSMTP(root, 'ENABLE', config.id, proof);
      await expect(
        manageSMTP(root, 'TEST', config.id, proof, 'rejected@test.invalid'),
      ).rejects.toThrow('SMTP_SERVER_REJECTED');
      const u = await prisma.user.findUniqueOrThrow({ where: { id: studentId } });
      const email = 'failure-' + tag + '@test.invalid';
      await expect(
        requestVerification({
          realm: 'STUDENT',
          purpose: 'BIND_EMAIL',
          email,
          actor: await loadIdentity(u.id, 'STUDENT', u.tokenVersion, false),
        }),
      ).rejects.toThrow('SMTP_SEND_FAILED');
      const challenge = await prisma.verificationChallenge.findFirstOrThrow({
        where: { targetEmail: email },
      });
      expect(challenge.revokedAt).not.toBeNull();
      expect(
        (await prisma.emailDelivery.findUniqueOrThrow({ where: { challengeId: challenge.id } }))
          .status,
      ).toBe('FAILED');
    } finally {
      process.env.TUHENG_OUTBOUND_ALLOWLIST = previous;
      await manageSMTP(root, 'ENABLE', original.id, proof);
      await new Promise<void>((resolve) => failing.close(resolve));
    }
  });
  it('S03: authentication failures and ambiguous send timeouts stay distinct and never activate a draft', async () => {
    const { proof } = await reauthenticate(root, process.env.SEED_PASSWORD!);
    const active = await prisma.sMTPConfigurationVersion.findFirstOrThrow({
      where: { enabled: true },
    });
    const previous = process.env.TUHENG_OUTBOUND_ALLOWLIST;
    for (const mode of ['AUTH', 'UNKNOWN'] as const) {
      const receiver = new SMTPServer({
        disabledCommands: mode === 'AUTH' ? ['STARTTLS'] : ['STARTTLS', 'AUTH'],
        allowInsecureAuth: true,
        authOptional: mode !== 'AUTH',
        onAuth(_auth, _session, callback) {
          callback(new Error('fixture authentication rejected'));
        },
        onData(stream) {
          stream.on('data', () => {});
          stream.on('end', () => {});
        },
      });
      await new Promise<void>((resolve) => receiver.listen(0, '127.0.0.1', resolve));
      const port = (receiver.server.address() as { port: number }).port;
      try {
        process.env.TUHENG_OUTBOUND_ALLOWLIST = '127.0.0.1:' + port;
        const config = await saveSMTP(
          root,
          {
            name: 'SMTP failure fixture',
            host: '127.0.0.1',
            port,
            tls: 'LOCAL_TEST',
            username: mode === 'AUTH' ? 'fixture' : '',
            fromName: 'Test',
            fromEmail: 'test@test.invalid',
            timeoutMs: 1000,
          },
          'test-only-smtp-secret',
          proof,
        );
        await expect(
          manageSMTP(
            root,
            mode === 'AUTH' ? 'VERIFY' : 'TEST',
            config.id,
            proof,
            'timeout@test.invalid',
          ),
        ).rejects.toThrow(mode === 'AUTH' ? 'SMTP_AUTH_FAILED' : 'SMTP_SEND_STATUS_UNKNOWN');
        expect(
          (await prisma.sMTPConfigurationVersion.findUniqueOrThrow({ where: { id: config.id } }))
            .enabled,
        ).toBe(false);
        expect(
          (await prisma.sMTPConfigurationVersion.findFirstOrThrow({ where: { enabled: true } })).id,
        ).toBe(active.id);
      } finally {
        process.env.TUHENG_OUTBOUND_ALLOWLIST = previous;
        await new Promise<void>((resolve) => receiver.close(resolve));
      }
    }
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
  it('ID02: old root onboarding claims no longer require email, but password and session checks still apply', async () => {
    const before = await prisma.user.findUniqueOrThrow({ where: { id: 'admin' } });
    try {
      const changed = await prisma.user.update({
        where: { id: before.id },
        data: {
          mustChangePassword: false,
          email: '',
          emailNormalized: null,
          emailVerifiedAt: null,
          installationComplete: false,
          tokenVersion: { increment: 1 },
        },
      });
      const rootWithOldClaim = await loadIdentity(changed.id, 'STAFF', changed.tokenVersion, true);
      expect(rootWithOldClaim.onboarding).toBe(false);
      expect(
        (
          await authenticate({
            realm: 'STAFF',
            method: 'PASSWORD',
            identifier: 'admin',
            password: process.env.SEED_PASSWORD!,
          })
        )?.onboarding,
      ).toBe(false);
      await expect(loadIdentity(changed.id, 'STAFF', before.tokenVersion, true)).rejects.toThrow(
        'SESSION_REVOKED',
      );
      await prisma.user.update({ where: { id: changed.id }, data: { mustChangePassword: true } });
      expect(
        (await loadIdentity(changed.id, 'STAFF', changed.tokenVersion, false)).onboarding,
      ).toBe(true);
    } finally {
      await prisma.user.update({
        where: { id: before.id },
        data: {
          mustChangePassword: before.mustChangePassword,
          email: before.email,
          emailNormalized: before.emailNormalized,
          emailVerifiedAt: before.emailVerifiedAt,
          installationComplete: before.installationComplete,
          tokenVersion: { increment: 1 },
        },
      });
    }
  });
});
