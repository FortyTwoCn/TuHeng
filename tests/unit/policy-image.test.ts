import { it, expect } from 'vitest';
import sharp from 'sharp';
import { checkSubmissionWindow, requireRole } from '@tuheng/domain';
import { preprocess, mapPoint, inspectImage } from '@tuheng/image-pipeline';
it('checks deadline equality and late policy', () => {
  const now = new Date('2026-10-19T12:00Z');
  const a = { status: 'PUBLISHED', startsAt: new Date('2026-10-18'), dueAt: now, allowLate: false };
  expect(() => checkSubmissionWindow(a, now)).not.toThrow();
  expect(() => checkSubmissionWindow(a, new Date(now.getTime() + 1))).toThrow('DEADLINE_PASSED');
  expect(() =>
    checkSubmissionWindow({ ...a, allowLate: true }, new Date(now.getTime() + 1)),
  ).not.toThrow();
  expect(() => checkSubmissionWindow({ ...a, status: 'DRAFT' }, now)).toThrow('NOT_PUBLISHED');
  expect(() => checkSubmissionWindow({ ...a, startsAt: new Date('2026-10-20') }, now)).toThrow(
    'NOT_STARTED',
  );
});
it('does not grant grade control to admin/operator', () => {
  for (const role of ['ADMIN', 'PLATFORM_OPERATOR', 'COURSE_MANAGER'] as const)
    expect(() => requireRole({ id: 'a', name: 'a', roles: [role] }, 'TEACHER')).toThrow(
      'FORBIDDEN',
    );
});
it('validates image bytes instead of extensions', async () => {
  await expect(inspectImage(Buffer.from('<script>fake.png</script>'))).rejects.toThrow();
});
it('preserves original and records manual transforms', async () => {
  const original = await sharp({
    create: { width: 1000, height: 800, channels: 3, background: 'white' },
  })
    .png()
    .toBuffer();
  const copy = Buffer.from(original);
  const p = await preprocess(original, {
    maxDimension: 1200,
    rotate: 90,
    crop: { left: 0.1, top: 0.2, width: 0.5, height: 0.5 },
  });
  expect(original.equals(copy)).toBe(true);
  const point = mapPoint({ x: 0.1, y: 0.2 }, p.record.transform.matrix);
  expect(point.x).toBeCloseTo(1);
  expect(point.y).toBeCloseTo(0);
  expect(p.record.perspective).toBe('NOT_APPLIED');
  expect(p.width).toBe(400);
  expect(p.height).toBe(500);
});
it('rejects invalid crop/rotation rather than distorting', async () => {
  const b = await sharp({ create: { width: 100, height: 100, channels: 3, background: 'white' } })
    .png()
    .toBuffer();
  await expect(preprocess(b, { maxDimension: 1000, rotate: 15, crop: null })).rejects.toThrow(
    'INVALID_ROTATION',
  );
  await expect(
    preprocess(b, {
      maxDimension: 1000,
      rotate: 0,
      crop: { left: 0.5, top: 0, width: 1, height: 1 },
    }),
  ).rejects.toThrow('INVALID_CROP');
});
