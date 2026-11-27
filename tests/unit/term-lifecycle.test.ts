import { describe, expect, it } from 'vitest';
import { OrganizationCommand } from '@tuheng/contracts';
import { computeTermStatus } from '@tuheng/domain';

const startsAt = new Date('2026-09-01T00:00:00.000Z');
const endsAt = new Date('2027-01-31T12:00:00.000Z');
describe('term lifecycle', () => {
  it.each([
    [new Date(startsAt.getTime() - 1), 'UPCOMING'],
    [startsAt, 'ACTIVE'],
    [new Date('2026-12-01T00:00:00.000Z'), 'ACTIVE'],
    [endsAt, 'ACTIVE'],
    [new Date(endsAt.getTime() + 1), 'ENDED'],
  ] as const)('derives the correct status at %s', (now, expected) => {
    expect(computeTermStatus(startsAt, endsAt, now)).toBe(expected);
  });

  const create = { operation: 'create-offering', schoolId: 's', courseId: 'c', term: '秋季' };
  const update = { operation: 'update-offering', schoolId: 's', offeringId: 'o' };
  it.each([create, update])('requires both non-equal, ordered instants for $operation', (input) => {
    const start = startsAt.toISOString();
    const end = endsAt.toISOString();
    expect(OrganizationCommand.parse({ ...input, startsAt: start, endsAt: end })).toMatchObject({
      startsAt,
      endsAt,
    });
    for (const dates of [
      { startsAt: start },
      { endsAt: end },
      { startsAt: start, endsAt: start },
      { startsAt: end, endsAt: start },
      { startsAt: start, endsAt: '2027-02-29T00:00:00Z' },
    ]) {
      const result = OrganizationCommand.safeParse({ ...input, ...dates });
      expect(result.success).toBe(false);
      expect(result.error?.issues).toContainEqual(
        expect.objectContaining({ message: 'INVALID_TERM_RANGE' }),
      );
    }
  });

  it('preserves archive-only commands and resolves offsets before comparing instants', () => {
    const start = '2026-09-01T08:00:00+08:00';
    expect(
      OrganizationCommand.parse({ ...create, startsAt: start, endsAt: endsAt.toISOString() }),
    ).toMatchObject({ startsAt, endsAt });
    expect(
      OrganizationCommand.safeParse({ ...create, startsAt: start, endsAt: startsAt.toISOString() })
        .success,
    ).toBe(false);
    expect(OrganizationCommand.parse({ ...update, archived: false })).toEqual({
      ...update,
      archived: false,
    });
    expect(
      OrganizationCommand.safeParse({ ...update, archived: false, term: '秋季' }).success,
    ).toBe(false);
  });
});
