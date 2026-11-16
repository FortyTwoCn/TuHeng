import nodemailer from 'tuheng-smtp-client';
import { prisma } from '@tuheng/database';
import { SMTPConfig, EmailAddress, type VerificationPurpose } from '@tuheng/contracts';
import { ensure, requireSMTPManager, type Actor } from '@tuheng/domain';
import { explicitlyAllowed, resolveOutbound } from './outbound';
import { readSecret, storeSecret } from './secret-store';
import { rateLimit } from './security-throttle';
import { requireRecentAuthentication } from './identity-security';

export async function smtpManager(actor: Actor, proof?: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: actor.id } });
  const bootstrap =
    user.kind === 'SITE_ADMIN' && !user.installationComplete && !user.mustChangePassword;
  requireSMTPManager(actor, bootstrap);
  await requireRecentAuthentication(actor, proof);
}
export async function saveSMTP(actor: Actor, input: unknown, password?: string, proof?: string) {
  await smtpManager(actor, proof);
  const config = SMTPConfig.parse(input);
  await resolveOutbound(config.host, config.port, 'SMTP');
  ensure(
    config.tls !== 'LOCAL_TEST' || explicitlyAllowed(config.host, config.port),
    'SMTP_TLS_REQUIRED',
  );
  ensure(!/[\r\n]/.test(config.fromName + config.username + config.name), 'INVALID_MAIL_HEADER');
  const secret = password ? await storeSecret(password, 'SMTP') : null;
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(72651320)`;
    const prior = await tx.sMTPConfigurationVersion.findFirst({ orderBy: { version: 'desc' } });
    const row = await tx.sMTPConfigurationVersion.create({
      data: {
        version: (prior?.version ?? 0) + 1,
        config,
        secretId: secret?.id ?? prior?.secretId,
        enabled: false,
      },
    });
    await tx.auditLog.create({
      data: {
        actorId: actor.id,
        action: 'SMTP_VERSION_CREATED',
        resourceId: row.id,
        details: { version: row.version },
      },
    });
    return { id: row.id, version: row.version, enabled: false };
  });
}
async function smtpTransport(id?: string) {
  const row = id
    ? await prisma.sMTPConfigurationVersion.findUnique({ where: { id } })
    : await prisma.sMTPConfigurationVersion.findFirst({
        where: { enabled: true },
        orderBy: { version: 'desc' },
      });
  ensure(row, 'SMTP_NOT_CONFIGURED', 503);
  const config = SMTPConfig.parse(row.config);
  const [address] = await resolveOutbound(config.host, config.port, 'SMTP');
  ensure(
    config.tls !== 'LOCAL_TEST' || explicitlyAllowed(config.host, config.port),
    'SMTP_TLS_REQUIRED',
  );
  const transport = nodemailer.createTransport({
    host: address.address,
    port: config.port,
    secure: config.tls === 'TLS',
    requireTLS: config.tls === 'STARTTLS',
    ignoreTLS: config.tls === 'LOCAL_TEST',
    tls: { servername: config.host, rejectUnauthorized: true },
    auth: config.username
      ? { user: config.username, pass: row.secretId ? await readSecret(row.secretId, 'SMTP') : '' }
      : undefined,
    connectionTimeout: config.timeoutMs,
    greetingTimeout: config.timeoutMs,
    socketTimeout: config.timeoutMs,
    disableFileAccess: true,
    disableUrlAccess: true,
    logger: false,
    debug: false,
  });
  return { row, config, transport };
}
export async function manageSMTP(
  actor: Actor,
  action: 'VERIFY' | 'TEST' | 'ENABLE' | 'DISABLE',
  id: string,
  proof?: string,
  recipient?: string,
) {
  await smtpManager(actor, proof);
  const { row, transport, config } = await smtpTransport(id);
  try {
    if (action === 'VERIFY') await transport.verify();
    if (action === 'TEST') {
      await rateLimit('smtp-test:' + actor.id, 5, 60000);
      await transport.sendMail({
        from: { name: config.fromName, address: config.fromEmail },
        to: EmailAddress.parse(recipient),
        subject: '图衡邮件服务测试',
        text: '这是一封管理员主动发送的图衡邮件服务测试。SMTP 接受不等于邮件已到达收件箱。',
        html: '<p>图衡邮件服务测试。SMTP 接受不等于已送达收件箱。</p>',
      });
    }
    if (action === 'ENABLE' || action === 'DISABLE')
      await prisma.$transaction(async (tx) => {
        await tx.sMTPConfigurationVersion.updateMany({ data: { enabled: false } });
        if (action === 'ENABLE')
          await tx.sMTPConfigurationVersion.update({ where: { id }, data: { enabled: true } });
      });
    await prisma.auditLog.create({
      data: { actorId: actor.id, action: `SMTP_${action}`, resourceId: row.id, details: {} },
    });
    return {
      status:
        action === 'TEST'
          ? 'SUBMITTED_TO_SMTP'
          : action === 'VERIFY'
            ? 'CONNECTION_VERIFIED'
            : action,
    };
  } finally {
    transport.close();
  }
}
const purposes: Record<VerificationPurpose, string> = {
  LOGIN: '登录',
  BIND_EMAIL: '首次绑定邮箱',
  CHANGE_EMAIL: '更换绑定邮箱',
  RESET_PASSWORD: '找回密码',
  SENSITIVE_REAUTH: '确认敏感操作',
};
const escapeHTML = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
export async function sendVerificationMail(challengeId: string, code: string) {
  const challenge = await prisma.verificationChallenge.findUniqueOrThrow({
    where: { id: challengeId },
  });
  ensure(
    !challenge.consumedAt && !challenge.revokedAt && challenge.expiresAt > new Date(),
    'CODE_EXPIRED',
  );
  const { row, config, transport } = await smtpTransport();
  await rateLimit('smtp-budget:' + row.id, config.perMinute, 60000);
  await prisma.emailDelivery.create({
    data: {
      challengeId,
      smtpId: row.id,
      purpose: challenge.purpose,
      expiresAt: challenge.expiresAt,
    },
  });
  try {
    const purpose = purposes[challenge.purpose as VerificationPurpose];
    await transport.sendMail({
      from: { name: config.fromName, address: config.fromEmail },
      to: EmailAddress.parse(challenge.targetEmail),
      replyTo: config.replyTo,
      subject: `图衡${purpose}验证码`,
      text: `您正在${purpose}。验证码：${code}，5 分钟内有效。若非本人操作，请忽略本邮件。`,
      html: `<p>您正在${escapeHTML(purpose)}。</p><p>验证码：<strong>${code}</strong>，5 分钟内有效。</p><p>若非本人操作，请忽略本邮件。</p>`,
    });
    await prisma.emailDelivery.update({
      where: { challengeId },
      data: { status: 'SUBMITTED_TO_SMTP' },
    });
  } catch {
    await prisma.emailDelivery.update({
      where: { challengeId },
      data: { status: 'FAILED', errorCode: 'SMTP_SEND_FAILED' },
    });
    await prisma.verificationChallenge.update({
      where: { id: challengeId },
      data: { revokedAt: new Date() },
    });
    throw new Error('SMTP_SEND_FAILED');
  } finally {
    transport.close();
  }
}
