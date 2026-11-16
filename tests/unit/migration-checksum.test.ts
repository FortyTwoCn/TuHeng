import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import { migrationChecksum, matchesMigrationChecksum } from '../../scripts/migration-checksum';

it('accepts historical LF/CRLF migration checksums after a cross-platform checkout', () => {
  const lf = 'CREATE TABLE "Sample" (id TEXT);\n-- immutable history\n';
  const crlf = lf.replaceAll('\n', '\r\n');
  const legacy = createHash('sha256').update(crlf).digest('hex');
  expect(migrationChecksum(lf)).toBe(migrationChecksum(crlf));
  expect(matchesMigrationChecksum(lf, legacy)).toBe(true);
  expect(matchesMigrationChecksum(crlf, migrationChecksum(lf))).toBe(true);
});
it('still rejects changed statements, comments and whitespace in an applied migration', () => {
  const original = 'SELECT 1;\n';
  const stored = migrationChecksum(original);
  for (const changed of ['SELECT 2;\n', ' SELECT 1;\n', 'SELECT 1;\n-- edited\n'])
    expect(matchesMigrationChecksum(changed, stored)).toBe(false);
});
