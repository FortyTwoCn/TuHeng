import { createHash } from 'node:crypto';

const hash = (sql: string) => createHash('sha256').update(sql).digest('hex');
export const migrationChecksum = (sql: string) => hash(sql.replaceAll('\r\n', '\n'));

export function matchesMigrationChecksum(sql: string, stored: string) {
  const lf = sql.replaceAll('\r\n', '\n');
  // Older Windows deployments hashed CRLF verbatim. Accept only newline variants,
  // never trim/reformat SQL or rewrite the checksum of an applied migration.
  return stored === hash(lf) || stored === hash(lf.replaceAll('\n', '\r\n'));
}
