// @verify-changed-triggers: src/**/*.css, src/**/*.svelte, src/**/*.ts
// Guard literal CSS easing curves, including those embedded in renderer strings.
// Keyframe trajectories and computed JS easing are outside this scan: review their
// start/end values separately. springs.test.ts simulates the shared physical tiers.
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { expect, it } from 'vitest';

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (['node_modules', '__snapshots__', '__tests__', 'paraglide'].includes(entry.name)) return [];
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(css|svelte|ts)$/.test(entry.name) && !/\.(test|spec)\./.test(entry.name)
      ? [path]
      : [];
  });
}

it('keeps literal easing curves within their resting range', () => {
  const violations: string[] = [];
  for (const path of sourceFiles(join(process.cwd(), 'src'))) {
    const source = readFileSync(path, 'utf8').replace(/\/\*[\s\S]*?\*\/|<!--[^]*?-->/g, '');
    for (const match of source.matchAll(/\b(cubic-bezier|linear)\(\s*([-+.\d][^()]*)\)/g)) {
      const values = match[2].split(',').map((part) => Number.parseFloat(part.trim()));
      const outputs = match[1] === 'cubic-bezier' ? [values[1], values[3]] : values;
      if (
        outputs.some((value) => !Number.isFinite(value) || value < 0 || value > 1) ||
        (match[1] === 'linear' &&
          outputs.some((value, index) => index > 0 && value < outputs[index - 1]))
      ) {
        violations.push(`${relative(process.cwd(), path)}: ${match[0]}`);
      }
    }
  }
  expect(violations).toEqual([]);
});
