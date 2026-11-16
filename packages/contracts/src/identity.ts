import { z } from 'zod';

export const AuthRealm = z.enum(['STUDENT', 'STAFF']);
export type AuthRealm = z.infer<typeof AuthRealm>;
export const AccountKind = z.enum(['SITE_ADMIN', 'SCHOOL_ADMIN', 'TEACHER', 'STUDENT']);
export type AccountKind = z.infer<typeof AccountKind>;
export const VerificationPurpose = z.enum([
  'LOGIN',
  'BIND_EMAIL',
  'CHANGE_EMAIL',
  'RESET_PASSWORD',
  'SENSITIVE_REAUTH',
]);
export type VerificationPurpose = z.infer<typeof VerificationPurpose>;
export const EmailAddress = z.string().trim().max(254).email();
export const normalizedEmail = (email: string) => EmailAddress.parse(email).toLowerCase();
export const NewPassword = z
  .string()
  .min(12, '密码至少 12 个字符')
  .refine((v) => new TextEncoder().encode(v).length <= 72, '密码 UTF-8 编码不能超过 72 字节');
export const LoginInput = z.object({
  realm: AuthRealm,
  method: z.enum(['PASSWORD', 'CODE']),
  identifier: z.string().trim().min(1).max(254),
  schoolId: z.string().max(100).optional(),
  password: z.string().max(200).optional(),
  challengeId: z.string().max(100).optional(),
  code: z
    .string()
    .regex(/^\d{6}$/)
    .optional(),
});
export type LoginInput = z.infer<typeof LoginInput>;
export const SMTPConfig = z.object({
  name: z.string().trim().min(1).max(100),
  host: z.string().trim().min(1).max(253),
  port: z.number().int().min(1).max(65535),
  tls: z.enum(['TLS', 'STARTTLS', 'LOCAL_TEST']),
  username: z.string().max(254),
  fromName: z.string().max(100),
  fromEmail: EmailAddress,
  replyTo: EmailAddress.optional(),
  timeoutMs: z.number().int().min(1000).max(30000).default(10000),
  perMinute: z.number().int().min(1).max(500).default(60),
});
export type SMTPConfig = z.infer<typeof SMTPConfig>;
export const AudienceSelection = z.object({
  version: z.literal(1),
  schoolId: z.string().min(1),
  include: z.object({
    allEligibleInScope: z.boolean(),
    classIds: z.array(z.string()).max(2000),
    studentIds: z.array(z.string()).max(10000),
  }),
  exclude: z.object({ studentIds: z.array(z.string()).max(10000) }),
});
export type AudienceSelection = z.infer<typeof AudienceSelection>;
export const RosterRow = z.object({
  row: z.number().int().min(2),
  teacher: z.string().max(100).optional(),
  className: z.string().trim().min(1).max(100),
  studentNumber: z.string().trim().min(1).max(100),
  name: z.string().trim().min(1).max(100),
});
export type RosterRow = z.infer<typeof RosterRow>;

export const ReviewerAssignment = z
  .object({ teacherId: z.string().min(1), selection: AudienceSelection })
  .strict();
export type ReviewerAssignment = z.infer<typeof ReviewerAssignment>;
