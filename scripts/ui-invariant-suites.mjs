import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import {
  collectTestFiles,
  parseSuite,
  readHeaderLines,
  readLeadingComments,
  stripBom,
  TEST_SCAN_ROOTS,
} from './vitest-suite-files.mjs';

export { collectTestFiles, readLeadingComments };

// Single source of truth for `pnpm run test:ui-invariants` membership. A suite
// joins the gate by carrying `// @ui-invariant` in its leading comments; a
// suite whose code references the UI component inventory builder, or imports a
// `*.meta` module and reads a `.callers` ledger, must carry either that marker
// or `// @ui-invariant-exempt: <reason>`. cloudlands-fe#2260 shipped the gate
// as a hand-listed package.json script and missed qualifying suites until review.
export const UI_INVARIANT_MARKER = '@ui-invariant';
export const UI_INVARIANT_EXEMPT_MARKER = '@ui-invariant-exempt:';
export const UI_INVARIANT_SCAN_ROOTS = TEST_SCAN_ROOTS;

const GATE_MARKER = new RegExp(`${UI_INVARIANT_MARKER}(?![\\w-])`);
const INVENTORY_BUILDER = 'buildUiComponentInventory';
const CALLERS_LEDGER = 'callers';
const META_SPECIFIER = /\.meta(?:\.[cm]?[jt]s)?$/;

export function readHeaderMarker(content) {
  for (const line of readHeaderLines(content)) {
    const exempt = line.indexOf(UI_INVARIANT_EXEMPT_MARKER);
    if (exempt !== -1) {
      return {
        kind: 'exempt',
        reason: line.slice(exempt + UI_INVARIANT_EXEMPT_MARKER.length).trim(),
      };
    }
    if (GATE_MARKER.test(line)) return { kind: 'gate' };
  }
  return { kind: null };
}

function isMetaSpecifier(node) {
  return (
    node !== undefined &&
    (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) &&
    META_SPECIFIER.test(node.text)
  );
}

function isMetaImport(node) {
  if (ts.isImportDeclaration(node)) return isMetaSpecifier(node.moduleSpecifier);
  if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
    return isMetaSpecifier(node.arguments[0]);
  }
  return false;
}

// Parses the suite with the TypeScript compiler so comments, string and
// template bodies, and regex literals never register as consumers, and so
// whitespace or comments between member tokens do not hide one.
export function requiresUiInvariantMarker(content, filePath = 'suite.ts') {
  const source = stripBom(content);
  if (!source.includes(INVENTORY_BUILDER) && !source.includes(CALLERS_LEDGER)) return false;
  const sourceFile = parseSuite(source, filePath);
  let referencesBuilder = false;
  let importsMeta = false;
  let readsCallers = false;
  const visit = (node) => {
    if (ts.isIdentifier(node) && node.text === INVENTORY_BUILDER) referencesBuilder = true;
    else if (isMetaImport(node)) importsMeta = true;
    else if (ts.isPropertyAccessExpression(node) && node.name.text === CALLERS_LEDGER) {
      readsCallers = true;
    }
    if (referencesBuilder) return;
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return referencesBuilder || (importsMeta && readsCallers);
}

export function inspectUiInvariantSuites(files) {
  const suites = [];
  const exempt = [];
  const violations = [];
  const sorted = [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  for (const { path: filePath, content } of sorted) {
    const marker = readHeaderMarker(content);
    if (marker.kind === 'gate') {
      suites.push(filePath);
    } else if (marker.kind === 'exempt') {
      if (marker.reason) exempt.push({ path: filePath, reason: marker.reason });
      else violations.push(`${filePath}: \`${UI_INVARIANT_EXEMPT_MARKER}\` requires a reason`);
    } else if (requiresUiInvariantMarker(content, filePath)) {
      violations.push(
        `${filePath}: consumes the UI component inventory or a *.meta caller ledger without a header marker; add \`// ${UI_INVARIANT_MARKER}\` to run it in test:ui-invariants or \`// ${UI_INVARIANT_EXEMPT_MARKER} <reason>\` to opt out`,
      );
    }
  }
  return { suites, exempt, violations, auditedFiles: sorted.map((file) => file.path) };
}

export function listUiInvariantSuites(root = process.cwd()) {
  return inspectUiInvariantSuites(collectTestFiles(root));
}

// Runs the vitest CLI entry through the current Node binary: `.cmd` shims need
// a command interpreter on Windows, and this keeps argument boundaries intact.
export function runVitest(suites, vitestArgs, root = process.cwd()) {
  const require = createRequire(import.meta.url);
  const vitestPackage = require.resolve('vitest/package.json');
  const vitestBin = path.join(path.dirname(vitestPackage), require(vitestPackage).bin.vitest);
  const child = spawnSync(
    process.execPath,
    [vitestBin, 'run', '--config', 'vitest.config.ts', ...suites, ...vitestArgs],
    { cwd: root, stdio: 'inherit' },
  );
  if (child.error) {
    console.error(`Failed to start vitest: ${child.error.message}`);
    return 1;
  }
  return child.status ?? 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const mode = args.includes('--list') ? 'list' : args.includes('--check') ? 'check' : 'run';
  const vitestArgs = args.filter((arg) => arg !== '--list' && arg !== '--check');
  const result = listUiInvariantSuites();
  if (result.violations.length) {
    console.error(
      [
        'UI invariant suite marker violations:',
        ...result.violations.map((item) => `- ${item}`),
      ].join('\n'),
    );
    process.exit(1);
  }
  if (!result.suites.length) {
    console.error(`No test file carries \`// ${UI_INVARIANT_MARKER}\`; nothing to run.`);
    process.exit(1);
  }
  if (mode === 'list') {
    console.log(result.suites.join('\n'));
  } else if (mode === 'check') {
    console.log(
      `UI invariant suite markers valid: ${result.suites.length} suites, ${result.exempt.length} exempt, ${result.auditedFiles.length} test files audited.`,
    );
  } else {
    process.exit(runVitest(result.suites, vitestArgs));
  }
}
