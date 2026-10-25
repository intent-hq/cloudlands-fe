// @vitest-environment node

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

// A root Playwright spec that owns a Vite server and mounts through an in-page
// `import('/src|/test|/@id…')` can lose its document to a cold optimizer reload.
// Such specs must prepare their module graph with `prepareRootHarnessModules`
// (test/root-harness-import.ts), which recovers from exactly that reload.
const testDir = path.resolve(__dirname, '../test');
const IN_PAGE_SPECIFIER = /^\/(?:src|test|@id)\//;
const HELPER = 'prepareRootHarnessModules';

// Syntax-aware scan: comments and string contents never count as calls or imports.
function harnessFacts(name: string, source: string) {
  const file = ts.createSourceFile(name, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  let createsServer = false;
  let firstHelperCall = Infinity;
  let firstInPageImport = Infinity;
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const start = node.getStart(file);
      if (ts.isIdentifier(callee) && callee.text === 'createServer') createsServer = true;
      if (ts.isIdentifier(callee) && callee.text === HELPER) {
        firstHelperCall = Math.min(firstHelperCall, start);
      }
      const [specifier] = node.arguments;
      const specifierText =
        specifier &&
        (ts.isStringLiteral(specifier) || ts.isNoSubstitutionTemplateLiteral(specifier))
          ? specifier.text
          : specifier && ts.isTemplateExpression(specifier)
            ? specifier.head.text
            : undefined;
      if (
        callee.kind === ts.SyntaxKind.ImportKeyword &&
        specifierText !== undefined &&
        IN_PAGE_SPECIFIER.test(specifierText)
      ) {
        firstInPageImport = Math.min(firstInPageImport, start);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return { createsServer, firstHelperCall, firstInPageImport };
}

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
    .filter(([name, source]) => {
      const facts = harnessFacts(name, source);
      // The first helper call must precede the first in-page import.
      return (
        facts.createsServer &&
        facts.firstInPageImport !== Infinity &&
        !(facts.firstHelperCall < facts.firstInPageImport)
      );
    })
    .map(([name]) => name)
    .sort();
}

describe('root harness module preparation guard', () => {
  it('flags a server-owning spec that imports in-page without preparation', () => {
    const unprepared = "createServer({});\nawait page.evaluate(() => import('/src/x.ts'));";
    expect(
      rootSpecsMissingHarnessPreparation({
        'unprepared.spec.ts': unprepared,
        'prepared.spec.ts': `import { prepareRootHarnessModules } from './root-harness-import';\nawait prepareRootHarnessModules(page, baseUrl, ['/src/x.ts']);\n${unprepared}`,
        'imported-never-called.spec.ts': `import { prepareRootHarnessModules } from './root-harness-import';\n${unprepared}`,
        'called-after-import.spec.ts': `${unprepared}\nawait prepareRootHarnessModules(page, baseUrl, []);`,
        'glob-string.spec.ts': `createServer({ server: { watch: { ignored: ['**/*'] } } });\nawait page.evaluate(() => import('/src/x.ts'));\n/* a later block comment */`,
        'commented-call.spec.ts': `// await prepareRootHarnessModules(page, baseUrl, []);\n${unprepared}`,
        'no-server.spec.ts': "await page.evaluate(() => import('/@id/svelte'));",
        'svelte-dependency-css.spec.ts': unprepared,
      }),
    ).toEqual([
      'called-after-import.spec.ts',
      'commented-call.spec.ts',
      'glob-string.spec.ts',
      'imported-never-called.spec.ts',
      'unprepared.spec.ts',
    ]);
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
