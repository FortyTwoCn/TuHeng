import { afterEach, expect, it, vi } from 'vitest';
import { addDrawing, copyEntities, createDocument } from '@tuheng/geometry-core';
import { createId, GeometryDocument } from '@tuheng/contracts';

afterEach(() => vi.unstubAllGlobals());

it('creates and copies valid drawing entities when HTTP LAN browsers lack randomUUID', () => {
  const getRandomValues = crypto.getRandomValues.bind(crypto);
  vi.stubGlobal('crypto', { getRandomValues });
  const drawn = addDrawing(
    createDocument('VHW_PROJECTION'),
    'segment',
    'view-0',
    [
      { x: 10, y: 20 },
      { x: 30, y: 25 },
    ],
    'student',
  );
  const copied = copyEntities(
    drawn,
    drawn.entities.map((e) => e.id),
    'student',
  );
  expect(GeometryDocument.safeParse(copied).success).toBe(true);
  expect(copied.entities).toHaveLength(6);
  expect(new Set(copied.entities.map((e) => e.id)).size).toBe(6);
  for (const entity of copied.entities) {
    expect(entity.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  }
});

it('uses native UUIDs when available and refuses an insecure random-number fallback', () => {
  const randomUUID = vi.fn(() => 'c3f6866d-389b-46e7-bbd2-5e0eafcd2c08');
  vi.stubGlobal('crypto', { randomUUID });
  expect(createId()).toBe('c3f6866d-389b-46e7-bbd2-5e0eafcd2c08');
  expect(randomUUID).toHaveBeenCalledOnce();
  vi.stubGlobal('crypto', undefined);
  expect(createId).toThrow('浏览器不支持安全随机数');
});
