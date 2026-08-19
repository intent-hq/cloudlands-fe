import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const sourceRoot = path.resolve(process.cwd(), 'src');
const ignoredSegments = ['/__tests__/', '.test.ts', '.spec.ts'];
const explicitExceptions = new Map([
  [
    'src/lib/components/ui/tooltip/TooltipRich.svelte',
    'The error variant defines one solid bg-destructive map for its text, border, and icon.',
  ],
  [
    'src/lib/components/ui/slider/slider.svelte',
    'The token draws invalid control boundaries and the thumb; it is not text or an icon.',
  ],
]);

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

function approvedUtilityContext(line: string, variant = ''): boolean {
  const prefix = variant ? `${variant}:` : '';
  return new RegExp(`(?:^|[\\s'"\\x60])${prefix}bg-destructive(?:$|[\\s'"\\x60])`).test(line);
}

describe('destructive foreground usage contract', () => {
  it('reserves destructive-foreground content for solid destructive backgrounds', () => {
    const violations: string[] = [];
    for (const file of productionSources(sourceRoot)) {
      if (file === 'src/lib/styles/tokens.css' || explicitExceptions.has(file)) continue;
      const lines = fs.readFileSync(path.resolve(process.cwd(), file), 'utf8').split('\n');
      lines.forEach((line, index) => {
        for (const match of line.matchAll(
          /(?:(hover|focus|focus-visible|active|disabled):)?text-destructive-foreground\b/g,
        )) {
          if (!approvedUtilityContext(line, match[1] ?? '')) {
            violations.push(`${file}:${index + 1} ${match[0]}`);
          }
        }
        if (line.includes('var(--destructive-foreground)')) {
          violations.push(`${file}:${index + 1} raw destructive foreground`);
        }
      });
    }
    expect(violations, violations.join('\n')).toEqual([]);
  });

  it('keeps every explicit exception narrow and documented', () => {
    for (const [file, reason] of explicitExceptions) {
      expect(reason.length).toBeGreaterThan(40);
      expect(fs.readFileSync(path.resolve(process.cwd(), file), 'utf8')).toContain(
        'destructive-foreground',
      );
    }
  });
});
