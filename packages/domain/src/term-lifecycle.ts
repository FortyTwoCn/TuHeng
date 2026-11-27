import { isValidTermRange, type TermLifecycleStatus, type TermRange } from '@tuheng/contracts';
import { ensure } from './policy';

export function requireTermRange({ startsAt, endsAt }: Partial<TermRange>) {
  ensure(startsAt && endsAt && isValidTermRange(startsAt, endsAt), 'INVALID_TERM_RANGE');
}

export function computeTermStatus(
  startsAt: Date,
  endsAt: Date,
  now = new Date(),
): TermLifecycleStatus {
  if (now < startsAt) return 'UPCOMING';
  if (now > endsAt) return 'ENDED';
  return 'ACTIVE';
}

export function termLifecycle({ startsAt, endsAt }: TermRange, now = new Date()) {
  return { startsAt, endsAt, lifecycleStatus: computeTermStatus(startsAt, endsAt, now) };
}
