import { z } from 'zod';

export const SiteSettings = z.object({
  filingNumber: z
    .string()
    .trim()
    .max(120, '备案号最多 120 个字符')
    .regex(/^[^\r\n]*$/, '请输入单行备案号'),
  version: z.number().int().nonnegative(),
});
export type SiteSettings = z.infer<typeof SiteSettings>;

export const UpdateSiteSettings = SiteSettings.omit({ version: true }).extend({
  expectedVersion: z.number().int().nonnegative(),
});
