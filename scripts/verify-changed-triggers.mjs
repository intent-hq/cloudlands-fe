import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { readHeaderMarker, UI_INVARIANT_MARKER } from './ui-invariant-suites.mjs';
import {
  collectTestFiles,
  isPlaywrightFile,
  parseSuite,
  readHeaderLines,
  stripBom,
} from './vitest-suite-files.mjs';

// Self-registering `pnpm run verify:changed` triggers. `vitest related` follows
// the import graph, so a suite that reads the repository tree from disk is
// invisible to change-based selection; cloudlands-fe#2256 and #2314 each needed
// a hand-written planner rule after a CI-only failure. Instead, such a suite
// declares in its leading comments which changed paths select it:
//
//   // @verify-changed-triggers: src/preload/index.ts, src/lib/components/**
//
// Entries are repo-relative paths or globs (`path.matchesGlob`); `./` and `../`
// entries resolve against the test file's directory. Several marker lines
// accumulate, and a line ending in `,` continues on the next one. A suite that
// reads only its own fixtures or temp directories opts out with
// `// @verify-changed-exempt: <reason>`; a `// @ui-invariant` suite already
// runs on every renderer change and needs neither.
export const TRIGGER_MARKER = '@verify-changed-triggers:';
export const EXEMPT_MARKER = '@verify-changed-exempt:';

const GLOB_CHARACTERS = /[*?[\]{}]/;
// Bracket-class escaping is the only form `path.matchesGlob` honors on every
// platform (backslash escapes are path separators on Windows). Escaping `(`
// also disarms the `+(…)` / `!(…)` extglob forms, so `!` stays literal.
const GLOB_METACHARACTERS = /[*?[\]{}+@()]/g;
const INTEGRATION_ROOT = 'tests/integration/';
const READ_FUNCTIONS = new Set(['readFileSync', 'readdirSync', 'globSync', 'readFile', 'readdir']);
const ROOT_IDENTIFIERS = new Set(['__dirname', '__filename', 'repoRoot', 'REPO_ROOT']);
const META_PROPERTIES = new Set(['url', 'dirname', 'filename']);
// The vitest.config.ts aliases that resolve into `src/` (`$app` lands on the
// SvelteKit mock under `src/__mocks__`, which the test-module filter rejects).
const SOURCE_ALIASES = {
  '@': 'src',
  $lib: 'src/lib',
  $store: 'src/store',
  $features: 'src/features',
  $shared: 'src/shared',
  $app: 'src/__mocks__/$app',
};
const TEST_MODULE =
  /(?:^|[./-])(?:test|spec|tests|__tests__|__mocks__|__fixtures__|test-setup|test-utils|test-helpers|test-harness)(?:$|[./-])/;
const TEST_FILE = /\.(?:test|spec)(?:\.[cm]?[jt]sx?)?$/;
// Generated, gitignored output: importing it never makes a source change select the suite.
const GENERATED_MODULE = /(?:^|\/)paraglide\//;
const REPO_LITERAL = /^(?:src|scripts)\//;

const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

function resolveEntry(entry, filePath) {
  const normalized = entry.replaceAll('\\', '/');
  if (!normalized.startsWith('./') && !normalized.startsWith('../')) return normalized;
  return path.posix.normalize(path.posix.join(path.posix.dirname(filePath), normalized));
}

const escapeGlob = (value) => value.replace(GLOB_METACHARACTERS, (character) => `[${character}]`);

// A `./` or `../` glob entry resolves its leading dot segments against the test
// file's directory and glob-escapes that prefix, so route directories such as
// `[id]` stay literal and only the author's text is read as glob syntax. Exact
// entries resolve unescaped for the exact-equality match.
function resolveTriggerEntry(entry, filePath) {
  const normalized = entry.replaceAll('\\', '/');
  if (!GLOB_CHARACTERS.test(normalized)) return resolveEntry(normalized, filePath);
  if (!normalized.startsWith('./') && !normalized.startsWith('../')) return normalized;
  const segments = normalized.split('/');
  let index = 0;
  while (index < segments.length && (segments[index] === '.' || segments[index] === '..')) {
    index += 1;
  }
  const base = path.posix.normalize(
    path.posix.join(path.posix.dirname(filePath), ...segments.slice(0, index)),
  );
  return [escapeGlob(base), ...segments.slice(index)].join('/');
}

// Splits a marker list on commas outside `{}` / `[]`, so brace and class globs
// such as `src/*.{ts,svelte}` stay whole.
function splitEntries(list) {
  const entries = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < list.length; index += 1) {
    const character = list[index];
    if (character === '{' || character === '[') depth += 1;
    else if (character === '}' || character === ']') depth = Math.max(0, depth - 1);
    else if (character === ',' && depth === 0) {
      entries.push(list.slice(start, index));
      start = index + 1;
    }
  }
  entries.push(list.slice(start));
  return entries;
}

export function readTriggerHeader(content, filePath = 'suite.test.ts') {
  const triggers = [];
  let declared = false;
  let continuing = false;
  for (const line of readHeaderLines(content)) {
    const exempt = line.indexOf(EXEMPT_MARKER);
    if (exempt !== -1) {
      return { kind: 'exempt', reason: line.slice(exempt + EXEMPT_MARKER.length).trim() };
    }
    const marker = line.indexOf(TRIGGER_MARKER);
    if (marker === -1 && !continuing) continue;
    const list = marker === -1 ? line : line.slice(marker + TRIGGER_MARKER.length);
    declared = true;
    continuing = list.trimEnd().endsWith(',');
    for (const entry of splitEntries(list)) {
      const trimmed = entry.trim();
      if (trimmed) triggers.push(resolveTriggerEntry(trimmed, filePath));
    }
  }
  return declared ? { kind: 'triggers', triggers } : { kind: null };
}

// Exact match first: route segments such as `(app)` and `[id]` are literal
// path characters, not glob syntax.
export function matchesTrigger(trigger, changedPath) {
  if (trigger === changedPath) return true;
  return GLOB_CHARACTERS.test(trigger) && path.posix.matchesGlob(changedPath, trigger);
}

// Type-only imports are erased before vitest builds its module graph.
function isTypeOnlyImport(node) {
  const clause = node.importClause ?? node.exportClause;
  if (node.isTypeOnly || clause?.isTypeOnly) return true;
  const bindings = node.importClause?.namedBindings ?? node.exportClause;
  return (
    !node.importClause?.name &&
    bindings !== undefined &&
    'elements' in bindings &&
    bindings.elements.length > 0 &&
    bindings.elements.every((element) => element.isTypeOnly)
  );
}

function moduleSpecifier(node) {
  if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
    return isTypeOnlyImport(node) ? undefined : node.moduleSpecifier;
  }
  if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
    return node.arguments[0];
  }
  return undefined;
}

// The repo-relative path an import specifier resolves to: aliases through
// vitest.config.ts, `./` and `../` against the importing file's directory.
function resolveSpecifier(specifier, filePath) {
  const [alias] = Object.entries(SOURCE_ALIASES).find(
    ([name]) => specifier === name || specifier.startsWith(`${name}/`),
  ) ?? [undefined];
  if (alias) return path.posix.normalize(SOURCE_ALIASES[alias] + specifier.slice(alias.length));
  if (specifier.startsWith('./') || specifier.startsWith('../')) {
    return resolveEntry(specifier, filePath);
  }
  return path.posix.normalize(specifier);
}

// An import `vitest related` follows into production source: it resolves under
// `src/` and is not itself a test module (suites, `__tests__` / `__fixtures__`
// helpers, mocks, harnesses) or generated output.
function isSourceImport(specifierNode, filePath) {
  if (!specifierNode || !ts.isStringLiteralLike(specifierNode)) return false;
  const specifier = specifierNode.text.split('?')[0];
  const resolved = resolveSpecifier(specifier, filePath);
  if (!resolved.startsWith('src/')) return false;
  if (GENERATED_MODULE.test(resolved)) return false;
  const moduleName = resolved.replace(/\.[cm]?[jt]sx?$|\.svelte$/, '');
  return !TEST_FILE.test(moduleName) && !TEST_MODULE.test(moduleName);
}

// A bare `src/...` / `scripts/...` path, which node resolves against the cwd
// vitest runs from. Only counted as a whole read argument or initializer, so a
// fixture layout built under a temp dir (`join(tmp, 'src/a.ts')`) is not a read.
function isRepoLiteral(node) {
  if (ts.isStringLiteralLike(node)) return REPO_LITERAL.test(node.text);
  return ts.isTemplateExpression(node) && REPO_LITERAL.test(node.head.text);
}

// A repository root the read resolves against: `process.cwd()`, the module's own
// location, or a `repoRoot` binding.
function isRootSource(node) {
  if (ts.isIdentifier(node)) return ROOT_IDENTIFIERS.has(node.text);
  if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
    const { expression, name } = node.expression;
    return ts.isIdentifier(expression) && expression.text === 'process' && name.text === 'cwd';
  }
  if (ts.isPropertyAccessExpression(node) && ts.isMetaProperty(node.expression)) {
    return node.expression.name.text === 'meta' && META_PROPERTIES.has(node.name.text);
  }
  return false;
}

// A computed object key (`{ [file]: '' }`) names an entry a fixture creates,
// not a location it reads, so taint does not flow through it.
function containsRoot(node, tainted) {
  if (isRootSource(node)) return true;
  if (ts.isIdentifier(node) && tainted.has(node.text)) return true;
  if (ts.isPropertyAssignment(node) && ts.isComputedPropertyName(node.name)) {
    return containsRoot(node.initializer, tainted);
  }
  return ts.forEachChild(node, (child) => containsRoot(child, tainted) || undefined) === true;
}

function readCallee(node) {
  if (!ts.isCallExpression(node)) return false;
  const callee = node.expression;
  if (ts.isIdentifier(callee)) return READ_FUNCTIONS.has(callee.text);
  return ts.isPropertyAccessExpression(callee) && READ_FUNCTIONS.has(callee.name.text);
}

// Names bound to expressions that derive from a repository root: variables and
// functions whose initializer or body mentions a root source or another tainted
// name. Iterates to a fixpoint so declaration order does not matter.
function collectTaintedNames(sourceFile) {
  const bindings = [];
  const visit = (node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      bindings.push([node.name.text, node.initializer]);
    } else if (ts.isFunctionDeclaration(node) && node.name && node.body) {
      bindings.push([node.name.text, node.body]);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  const tainted = new Set();
  let grew = true;
  while (grew) {
    grew = false;
    for (const [name, expression] of bindings) {
      if (tainted.has(name)) continue;
      if (isRepoLiteral(expression) || containsRoot(expression, tainted)) {
        tainted.add(name);
        grew = true;
      }
    }
  }
  return tainted;
}

// A vitest suite that reads the repository tree from disk and imports nothing
// from `src/`, so `vitest related` can never select it. Playwright specs and
// `tests/integration/` suites are outside `verify:changed`'s vitest selection.
export function requiresTriggerDeclaration(content, filePath = 'suite.test.ts') {
  if (isPlaywrightFile(filePath) || filePath.startsWith(INTEGRATION_ROOT)) return false;
  const source = stripBom(content);
  if (![...READ_FUNCTIONS].some((name) => source.includes(name))) return false;
  const sourceFile = parseSuite(source, filePath);
  let importsSource = false;
  let readsRoot = false;
  const tainted = collectTaintedNames(sourceFile);
  const visit = (node) => {
    if (importsSource) return;
    if (isSourceImport(moduleSpecifier(node), filePath)) {
      importsSource = true;
      return;
    }
    if (!readsRoot && readCallee(node) && node.arguments[0]) {
      const target = node.arguments[0];
      readsRoot = isRepoLiteral(target) || containsRoot(target, tainted);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return readsRoot && !importsSource;
}

const violation = (file, message, hint) => ({ path: file, message, hint });
const DECLARE_HINT = `add \`// ${TRIGGER_MARKER} <repo-relative path or glob>, ...\` naming the paths whose change should run it, or \`// ${EXEMPT_MARKER} <reason>\` if it reads only its own fixtures`;

export function inspectDeclaredSuites(files) {
  const suites = [];
  const exempt = [];
  const uiInvariant = [];
  const violations = [];
  for (const file of [...files].sort((a, b) => compare(a.path, b.path))) {
    const header = readTriggerHeader(file.content, file.path);
    if (header.kind === 'exempt') {
      if (header.reason) exempt.push({ path: file.path, reason: header.reason });
      else {
        violations.push(
          violation(
            file.path,
            `${EXEMPT_MARKER} needs a reason`,
            `write \`// ${EXEMPT_MARKER} <why the suite reads no repository source>\``,
          ),
        );
      }
      continue;
    }
    if (header.kind === 'triggers') {
      const escaped = header.triggers.filter((trigger) => trigger.startsWith('../'));
      if (header.triggers.length === 0) {
        violations.push(
          violation(
            file.path,
            `${TRIGGER_MARKER} lists no paths`,
            `name at least one repo-relative path or glob, or use \`// ${EXEMPT_MARKER} <reason>\``,
          ),
        );
      } else if (escaped.length > 0) {
        violations.push(
          violation(
            file.path,
            `${TRIGGER_MARKER} entries resolve outside the package: ${escaped.join(', ')}`,
            'triggers must resolve to paths under the package root',
          ),
        );
      } else {
        suites.push({ path: file.path, triggers: [...new Set(header.triggers)] });
      }
      continue;
    }
    if (readHeaderMarker(file.content).kind === 'gate') {
      uiInvariant.push(file.path);
      continue;
    }
    if (requiresTriggerDeclaration(file.content, file.path)) {
      violations.push(
        violation(
          file.path,
          `reads the repository tree from disk but declares no ${TRIGGER_MARKER}, so \`verify:changed\` never selects it`,
          DECLARE_HINT,
        ),
      );
    }
  }
  return { suites, exempt, uiInvariant, violations, auditedFiles: files.length };
}

export function selectDeclaredSuites(suites, changedFiles) {
  const changed = [...changedFiles];
  const selected = new Set();
  for (const suite of suites) {
    if (suite.triggers.some((trigger) => changed.some((file) => matchesTrigger(trigger, file)))) {
      selected.add(suite.path);
    }
  }
  return [...selected].sort(compare);
}

export function listDeclaredSuites(root = process.cwd()) {
  return inspectDeclaredSuites(collectTestFiles(root));
}

function formatViolations(violations) {
  return violations
    .map((entry) => `  ${entry.path}\n    ${entry.message}\n    fix: ${entry.hint}`)
    .join('\n');
}

function main(argv) {
  const check = argv.includes('--check');
  const list = argv.includes('--list');
  if (!check && !list) {
    console.error(`usage: node scripts/verify-changed-triggers.mjs --check | --list`);
    return 2;
  }
  const result = listDeclaredSuites();
  if (list) {
    for (const suite of result.suites) console.log(`${suite.path}: ${suite.triggers.join(', ')}`);
    for (const entry of result.exempt) console.log(`${entry.path}: exempt (${entry.reason})`);
    for (const file of result.uiInvariant) console.log(`${file}: ${UI_INVARIANT_MARKER}`);
  }
  if (result.violations.length > 0) {
    console.error(
      `verify-changed-triggers: ${result.violations.length} of ${result.auditedFiles} vitest suites need a ${TRIGGER_MARKER} or ${EXEMPT_MARKER} header:\n${formatViolations(result.violations)}`,
    );
    return 1;
  }
  if (check) {
    console.log(
      `verify-changed-triggers: ${result.suites.length} declared, ${result.exempt.length} exempt, ${result.uiInvariant.length} ${UI_INVARIANT_MARKER} suites across ${result.auditedFiles} files`,
    );
  }
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2));
}
