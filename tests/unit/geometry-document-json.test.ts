import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { GEOMETRY_DOCUMENT_MAX_BYTES, geometryDocumentJsonSchema } from '@tuheng/contracts';
import {
  createDocument,
  exportGeometryBundle,
  loadGeometryDocument,
  serializeGeometryDocument,
} from '@tuheng/geometry-core';

const example = (name: string) => readFileSync(`docs/geometry-examples/${name}`, 'utf8');

it('exports stable readable coordinates and preserves precision, references and scoring data', () => {
  const document = loadGeometryDocument(example('AI-LINE-V3.json'));
  const point = document.entities[0];
  if (point.kind !== 'point') throw Error('示例首个对象应为端点');
  point.position.x = 3.141592653589793;
  point.name = '标注 "A"\n端点';
  const text = serializeGeometryDocument(document);

  expect(text).toContain('"id": "point-a",\n      "kind": "point"');
  expect(text).toContain('"position": { "x": 3.141592653589793, "y": 10 }');
  expect(text).toContain('"startPoint": "point-a"');
  expect(text.endsWith('\n')).toBe(true);
  expect(loadGeometryDocument(text)).toEqual(document);
  expect(serializeGeometryDocument(loadGeometryDocument(text))).toBe(text);
  expect(exportGeometryBundle(document).document).toEqual(document);
});

it('accepts a UTF-8 BOM and locates bad JSON and field values without discarding precision', () => {
  const text = example('AI-LINE-V3.json');
  const drawing = loadGeometryDocument(text);
  expect(loadGeometryDocument('\uFEFF' + text)).toEqual(drawing);
  expect(() => loadGeometryDocument('{ "units": }')).toThrow('JSON 语法无效');
  expect(() =>
    loadGeometryDocument(text.replace('"x": 15, "y": 10', '"x": "15", "y": 10')),
  ).toThrow('$.entities[0].position.x');
  expect(() =>
    loadGeometryDocument(text.replace('"startPoint": "point-a"', '"startPoint": "not-found"')),
  ).toThrow();
});

it('derives the V3 schema and keeps the editable examples compatible with the real reader', () => {
  expect(geometryDocumentJsonSchema()).toMatchObject({
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    additionalProperties: false,
    properties: { schemaVersion: { const: 'tuheng.geometry/3.0.0' }, units: { const: 'mm' } },
    required: expect.arrayContaining(['sheet', 'auxiliarySystems', 'views', 'layers', 'entities']),
  });
  for (const name of ['AI-LINE-V3.json', 'CAD-V3.json']) {
    const text = example(name).replaceAll('\r\n', '\n');
    expect(serializeGeometryDocument(loadGeometryDocument(text))).toBe(text);
  }
});

it('keeps large legal documents re-importable when indentation would exceed the file limit', () => {
  const drawing = createDocument('VHW_PROJECTION');
  const sample = { x: 32.12345678912345, y: 11.12345678912345, pressure: 0.12345678912345678 };
  for (let index = 0; index < 7; index++) {
    drawing.entities.push({
      id: `stroke-${index}`,
      kind: 'polyline',
      fitStatus: 'UNFITTED',
      layerId: 'answer',
      viewId: 'view-0',
      lineStyle: 'ANSWER_VISIBLE',
      points: [
        { x: 32, y: 11 },
        { x: 33, y: 12 },
      ],
      samples: Array.from({ length: 3500 }, () => sample),
    });
  }

  const text = serializeGeometryDocument(drawing);
  expect(text).not.toContain('\n');
  expect(Buffer.byteLength(text)).toBeLessThanOrEqual(GEOMETRY_DOCUMENT_MAX_BYTES);
  expect(loadGeometryDocument(text)).toEqual(drawing);
});
