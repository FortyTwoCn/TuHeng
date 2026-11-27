import { mkdirSync, writeFileSync } from 'node:fs';
import { constructionAnimationJsonSchema, geometryDocumentJsonSchema } from '@tuheng/contracts';

const directory = new URL('../docs/geometry-schemas/', import.meta.url);
mkdirSync(directory, { recursive: true });
for (const [filename, schema] of [
  ['tuheng.geometry.schema.json', geometryDocumentJsonSchema()],
  ['tuheng.construction-animation.schema.json', constructionAnimationJsonSchema()],
] as const) {
  writeFileSync(new URL(filename, directory), JSON.stringify(schema, null, 2) + '\n');
}
