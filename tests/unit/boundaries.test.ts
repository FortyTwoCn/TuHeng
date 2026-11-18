import { it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
const packages = readdirSync('packages');
const imports = new Map<string, Set<string>>();
for (const name of packages) {
  const paths = readdirSync(`packages/${name}/src`, { recursive: true, encoding: 'utf8' }).filter(
    (p) => /\.tsx?$/.test(p),
  );
  const code = paths.map((p) => readFileSync(`packages/${name}/src/${p}`, 'utf8')).join('\n');
  imports.set(name, new Set([...code.matchAll(/from ['"]@tuheng\/([^'"]+)/g)].map((m) => m[1])));
}
it('keeps domain and grading contracts free of framework and infrastructure dependencies', () => {
  for (const name of ['contracts', 'domain', 'grading-core', 'geometry-core']) {
    for (const dependency of imports.get(name) ?? [])
      expect(
        name === 'domain' ? ['contracts', 'domain', 'geometry-core'] : ['contracts'],
      ).toContain(dependency);
    const files = readdirSync(`packages/${name}/src`, { recursive: true, encoding: 'utf8' }).filter(
      (p) => /\.tsx?$/.test(p),
    );
    for (const file of files) {
      const code = readFileSync(`packages/${name}/src/${file}`, 'utf8');
      expect(code).not.toMatch(/from ['"](?:next(?:\/|['"])|react['"]|@prisma|bullmq|ioredis)/);
    }
  }
});
it('has no circular package dependency', () => {
  function visit(name: string, path: string[]) {
    expect(path).not.toContain(name);
    for (const next of imports.get(name) ?? []) visit(next, [...path, name]);
  }
  for (const name of packages) visit(name, []);
});
