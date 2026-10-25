// @vitest-environment node

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

// A root Playwright spec that owns a Vite server and mounts through an in-page
// `import('/src|/test|/@id…')` can lose its document to a cold optimizer reload.
// Such specs must prepare their module graph with `prepareRootHarnessModules`
// (test/root-harness-import.ts), which recovers from exactly that reload.
//
// Calls are matched through the local names bound by named (optionally aliased)
// imports of `createServer` from 'vite' and of the helper from
// './root-harness-import'. Known limits, deliberately not modelled: namespace or
// default imports, re-exports through another module, require(), and execution
// order (calls are ordered by source position, not by when they run).
const testDir = path.resolve(__dirname, '../test');
const IN_PAGE_SPECIFIER = /^\/(?:src|test|@id)\//;

// Syntax-aware scan: comments and string contents never count as calls or imports.
function harnessFacts(name: string, source: string) {
  const file = ts.createSourceFile(name, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const serverNames = new Set<string>();
  const helperNames = new Set<string>();
  for (const statement of file.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) {
      continue;
    }
    const from = statement.moduleSpecifier.text;
    const bindings = statement.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    for (const element of bindings.elements) {
      const imported = (element.propertyName ?? element.name).text;
      if (from === 'vite' && imported === 'createServer') serverNames.add(element.name.text);
      if (from === './root-harness-import' && imported === 'prepareRootHarnessModules') {
        helperNames.add(element.name.text);
      }
    }
  }
  let createsServer = false;
  let firstHelperCall = Infinity;
  let firstInPageImport = Infinity;
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const start = node.getStart(file);
      if (ts.isIdentifier(callee) && serverNames.has(callee.text)) createsServer = true;
      if (ts.isIdentifier(callee) && helperNames.has(callee.text)) {
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
    const viteImport = "import { createServer } from 'vite';\n";
    const helperImport = "import { prepareRootHarnessModules } from './root-harness-import';\n";
    const mount = "await page.evaluate(() => import('/src/x.ts'));";
    const unprepared = `${viteImport}createServer({});\n${mount}`;
    expect(
      rootSpecsMissingHarnessPreparation({
        'unprepared.spec.ts': unprepared,
        'prepared.spec.ts': `${helperImport}${viteImport}createServer({});\nawait prepareRootHarnessModules(page, baseUrl, ['/src/x.ts']);\n${mount}`,
        'imported-never-called.spec.ts': `${helperImport}${unprepared}`,
        'called-after-import.spec.ts': `${helperImport}${unprepared}\nawait prepareRootHarnessModules(page, baseUrl, []);`,
        'commented-call.spec.ts': `// await prepareRootHarnessModules(page, baseUrl, []);\n${unprepared}`,
        'glob-string.spec.ts': `${viteImport}createServer({ server: { watch: { ignored: ['**/*'] } } });\n${mount}\n/* a later block comment */`,
        'aliased-server.spec.ts': `import { createServer as makeViteServer } from 'vite';\nmakeViteServer({});\n${mount}`,
        'aliased-helper.spec.ts': `import { prepareRootHarnessModules as prepare } from './root-harness-import';\n${viteImport}createServer({});\nawait prepare(page, baseUrl, []);\n${mount}`,
        'no-server.spec.ts': "await page.evaluate(() => import('/@id/svelte'));",
        'svelte-dependency-css.spec.ts': unprepared,
      }),
    ).toEqual([
      'aliased-server.spec.ts',
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
