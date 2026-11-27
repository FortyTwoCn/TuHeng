import { z } from 'zod';

export const TermLifecycleStatus = z.enum(['UPCOMING', 'ACTIVE', 'ENDED']);
export type TermLifecycleStatus = z.infer<typeof TermLifecycleStatus>;
export type TermRange = { startsAt: Date; endsAt: Date };

export function isValidTermRange(startsAt: Date, endsAt: Date) {
  return startsAt.getTime() < endsAt.getTime();
}
