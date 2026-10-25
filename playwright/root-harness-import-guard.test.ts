// @vitest-environment node

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// A root Playwright spec that owns a Vite server and mounts through an in-page
// `import('/src|/test|/@id…')` can lose its document to a cold optimizer reload.
// Such specs must prepare their module graph with `prepareRootHarnessModules`
// (test/root-harness-import.ts), which recovers from exactly that reload.
const testDir = path.resolve(__dirname, '../test');
const IN_PAGE_IMPORT = /import\(\s*['"`]\/(?:src|test|@id)\//;
const ALLOWED = new Set([
  // Asserts dependency CSS through its own document lifecycle.
  'svelte-dependency-css.spec.ts',
  // Exercises the cache-directory helper itself.
  'vite-harness-cache.spec.ts',
  // Exercises prepareRootHarnessModules itself.
  'root-harness-import.spec.ts',
]);

function rootSpecsMissingHarnessPreparation(files: Record<string, string>) {
  return Object.entries(files)
    .filter(([name]) => !ALLOWED.has(name))
    .filter(
      ([, source]) =>
        source.includes('createServer') &&
        IN_PAGE_IMPORT.test(source) &&
        !source.includes('prepareRootHarnessModules'),
    )
    .map(([name]) => name)
    .sort();
}

describe('root harness module preparation guard', () => {
  it('flags a server-owning spec that imports in-page without preparation', () => {
    const unprepared = "createServer({});\nawait page.evaluate(() => import('/src/x.ts'));";
    expect(
      rootSpecsMissingHarnessPreparation({
        'unprepared.spec.ts': unprepared,
        'prepared.spec.ts': `import { prepareRootHarnessModules } from './root-harness-import';\n${unprepared}`,
        'no-server.spec.ts': "await page.evaluate(() => import('/@id/svelte'));",
        'svelte-dependency-css.spec.ts': unprepared,
      }),
    ).toEqual(['unprepared.spec.ts']);
  });

  it('every root spec that mounts through an in-page import prepares its modules', () => {
    const files = Object.fromEntries(
      readdirSync(testDir)
        .filter((name) => name.endsWith('.spec.ts'))
        .map((name) => [name, readFileSync(path.join(testDir, name), 'utf8')]),
    );
    expect(rootSpecsMissingHarnessPreparation(files)).toEqual([]);
  });
});
