import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const sourceRoot = path.resolve(process.cwd(), 'src');
const ignoredSegments = ['/__tests__/', '.test.ts', '.spec.ts'];
const obsoleteRoles = [
  'destructive',
  ['destructive', 'foreground'].join('-'),
  ['error', 'foreground'].join('-'),
];

function productionSources(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) return productionSources(absolute);
    const relative = path.relative(process.cwd(), absolute).replaceAll(path.sep, '/');
    if (!/\.(svelte|css|ts)$/.test(relative)) return [];
    if (ignoredSegments.some((segment) => relative.includes(segment))) return [];
    return [relative];
  });
}

describe('danger color usage contract', () => {
  it('keeps obsolete color roles out of production styling', () => {
    const violations: string[] = [];
    const utilityPrefixes = '(?:bg|text|border|ring|outline|fill|stroke|accent)';
    for (const file of productionSources(sourceRoot)) {
      const source = fs.readFileSync(path.resolve(process.cwd(), file), 'utf8');
      for (const role of obsoleteRoles) {
        const utility = new RegExp(`${utilityPrefixes}-${role}(?:\\b|/)`);
        const customProperty = new RegExp(`var\\(--${role}(?:\\)|\\s|/)`);
        if (utility.test(source) || customProperty.test(source)) violations.push(file);
      }
    }
    expect([...new Set(violations)], violations.join('\n')).toEqual([]);
  });
});
