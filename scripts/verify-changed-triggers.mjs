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

// Wildcards, classes, braces, and the extglob openers `@(` `+(` `!(` (`?(` and
// `*(` are already covered by their first character).
const GLOB_CHARACTERS = /[*?[\]{}]|[@+!]\(/;
// Bracket-class escaping is the only form `path.matchesGlob` honors on every
// platform (backslash escapes are path separators on Windows). Escaping `(`
// also disarms the `+(…)` / `!(…)` extglob forms, so `!` stays literal.
const GLOB_METACHARACTERS = /[*?[\]{}+@()]/g;
const INTEGRATION_ROOT = 'tests/integration/';
const READ_FUNCTIONS = new Set([
  'readFileSync',
  'readdirSync',
  'globSync',
  'existsSync',
  'readFile',
  'readdir',
]);
// Resolved entries that cannot match a repo-relative changed path.
const OUTSIDE_PACKAGE = /^(?:\.\.(?:\/|$)|\/|[A-Za-z]:\/)/;
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
// `[id]` stay literal and only the author's text is read as glob syntax. An
// exact entry whose resolved path lands under such a directory is escaped
// whole, so it never falls through to glob matching.
function resolveTriggerEntry(entry, filePath) {
  const normalized = entry.replaceAll('\\', '/');
  if (!GLOB_CHARACTERS.test(normalized)) {
    const resolved = resolveEntry(normalized, filePath);
    return resolved === normalized || !GLOB_CHARACTERS.test(resolved)
      ? resolved
      : escapeGlob(resolved);
  }
  if (!normalized.startsWith('./') && !normalized.startsWith('../')) return normalized;
  const segments = normalized.split('/');
  let index = 0;
  while (index < segments.length && (segments[index] === '.' || segments[index] === '..')) {
    index += 1;
  }
  const base = path.posix.normalize(
    path.posix.join(path.posix.dirname(filePath), ...segments.slice(0, index)),
  );
  const prefix = base === '.' ? [] : [escapeGlob(base)];
  return [...prefix, ...segments.slice(index)].join('/');
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
function containsRoot(node, references) {
  if (isRootSource(node)) return true;
  if (ts.isIdentifier(node) && references.get(node)?.tainted) return true;
  if (ts.isPropertyAssignment(node) && ts.isComputedPropertyName(node.name)) {
    return containsRoot(node.initializer, references);
  }
  return ts.forEachChild(node, (child) => containsRoot(child, references) || undefined) === true;
}

function readCallee(node) {
  if (!ts.isCallExpression(node)) return false;
  const callee = node.expression;
  if (ts.isIdentifier(callee)) return READ_FUNCTIONS.has(callee.text);
  return ts.isPropertyAccessExpression(callee) && READ_FUNCTIONS.has(callee.name.text);
}

// The object literals an option argument may denote: the literal itself, or
// every literal the local name it resolves to is bound to (`const opts = { cwd }`).
function optionObjects(argument, references) {
  if (ts.isObjectLiteralExpression(argument)) return [argument];
  if (!ts.isIdentifier(argument)) return [];
  return (references.get(argument)?.expressions ?? []).filter(ts.isObjectLiteralExpression);
}

// The `cwd` values of any option object after the target, written inline or
// through a local binding, as `cwd: expr` or shorthand `{ cwd }`. Only that
// property names a location a read resolves against (`globSync('*.ts', opts)`);
// other options and callbacks are not inspected, so a callback body that
// mentions `process.cwd()` does not make a read. Spread, method, and accessor
// members have no plain name and are skipped without expansion.
function cwdOptions(node, references) {
  const locations = [];
  for (const argument of node.arguments.slice(1)) {
    for (const object of optionObjects(argument, references)) {
      for (const property of object.properties) {
        const assignment = ts.isPropertyAssignment(property);
        if (!assignment && !ts.isShorthandPropertyAssignment(property)) continue;
        if (!ts.isIdentifier(property.name) || property.name.text !== 'cwd') continue;
        locations.push(assignment ? property.initializer : property.name);
      }
    }
  }
  return locations;
}

// A read location is argument zero, or a `cwd` option; either counts when it is
// a bare repo literal or derives from a root.
function readsRootArgument(node, references) {
  const locations = node.arguments[0] ? [node.arguments[0], ...cwdOptions(node, references)] : [];
  return locations.some(
    (location) => isRepoLiteral(location) || containsRoot(location, references),
  );
}

const isPlainAssignment = (node) =>
  ts.isBinaryExpression(node) &&
  node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
  ts.isIdentifier(node.left);

// Function bodies, blocks, loop heads, `catch` clauses, and `switch` bodies
// open a scope; `var` declarations hoist to the nearest function scope.
const opensScope = (node) =>
  ts.isFunctionLike(node) ||
  ts.isBlock(node) ||
  ts.isForStatement(node) ||
  ts.isForInStatement(node) ||
  ts.isForOfStatement(node) ||
  ts.isCatchClause(node) ||
  ts.isCaseBlock(node);

const isBlockScoped = (parent) =>
  ts.isCatchClause(parent) || (parent.flags & ts.NodeFlags.BlockScoped) !== 0;

// An identifier that reads a binding, as opposed to one that names a
// declaration, a property (`a.b`, `{ b: 1 }`, `{ b: alias } = o`), or a label.
function isReference(node, parent) {
  if (ts.isShorthandPropertyAssignment(parent)) return true;
  if (parent.name === node) return false;
  if (ts.isBindingElement(parent) && parent.propertyName === node) return false;
  return !(
    (ts.isLabeledStatement(parent) || ts.isBreakOrContinueStatement(parent)) &&
    parent.label === node
  );
}

const propertyKey = (name) =>
  ts.isIdentifier(name) || ts.isStringLiteralLike(name) || ts.isNumericLiteral(name)
    ? name.text
    : undefined;

// The expressions a pattern initializer contributes to one destructured
// element. An object or array literal is projected to the member the element
// names, so `{ fixture } = { fixture: '/tmp/a', source: process.cwd() }` does
// not taint `fixture` with its sibling. A rest element, a spread, computed,
// method, or accessor member, or a non-literal initializer is not statically
// projectable and falls back to the whole initializer.
function projectInitializer(initializer, pattern, element, index) {
  if (element.dotDotDotToken) return [initializer];
  if (ts.isObjectBindingPattern(pattern) && ts.isObjectLiteralExpression(initializer)) {
    const key = propertyKey(element.propertyName ?? element.name);
    if (key === undefined) return [initializer];
    const members = [];
    for (const property of initializer.properties) {
      const assignment = ts.isPropertyAssignment(property);
      if (!assignment && !ts.isShorthandPropertyAssignment(property)) return [initializer];
      const name = propertyKey(property.name);
      if (name === undefined) return [initializer];
      if (name === key) members.push(assignment ? property.initializer : property.name);
    }
    return members;
  }
  if (ts.isArrayBindingPattern(pattern) && ts.isArrayLiteralExpression(initializer)) {
    if (initializer.elements.some(ts.isSpreadElement)) return [initializer];
    const member = initializer.elements[index];
    return member && !ts.isOmittedExpression(member) ? [member] : [];
  }
  return [initializer];
}

// Every binding a suite declares — variables, parameters, destructured names,
// functions, classes — resolved by scope, with the expressions each is bound
// to: variable initializers, function bodies, and plain `name = expr`
// assignments. A parameter or block-scoped local shadows an outer name of the
// same spelling, so taint never crosses between them (intent-hq/intent#4737).
// `references` maps each reading identifier node to the binding it resolves
// to; unresolved names (imports, globals) are absent. Declarations are
// collected before references resolve, so use-before-declaration order in the
// source does not matter.
function collectBindings(sourceFile) {
  const bindings = [];
  const references = new Map();
  const pending = [];
  const assignments = [];
  const createScope = (parent, isFunction) => {
    const scope = { parent, declarations: new Map() };
    scope.functionScope = isFunction || !parent ? scope : parent.functionScope;
    return scope;
  };
  const declare = (scope, name) => {
    let binding = scope.declarations.get(name);
    if (!binding) {
      binding = { expressions: [], tainted: false };
      scope.declarations.set(name, binding);
      bindings.push(binding);
    }
    return binding;
  };
  // Declares every name in a binding target and attaches its initializers:
  // the variable initializer, a parameter default, and every destructuring
  // default on the way down, each projected onto the element it reaches, so
  // `{ root } = { root: process.cwd() }` taints `root` with `process.cwd()`.
  const declareNames = (scope, name, initializers) => {
    if (ts.isIdentifier(name)) {
      declare(scope, name.text).expressions.push(...initializers);
      return;
    }
    name.elements.forEach((element, index) => {
      if (!ts.isBindingElement(element)) return;
      const projected = initializers.flatMap((e) => projectInitializer(e, name, element, index));
      if (element.initializer) projected.push(element.initializer);
      declareNames(scope, element.name, projected);
    });
  };
  const lookup = (scope, name) => {
    for (let current = scope; current; current = current.parent) {
      const binding = current.declarations.get(name);
      if (binding) return binding;
    }
    return undefined;
  };
  const root = createScope(undefined, true);
  const visit = (node, scope, parent) => {
    if (ts.isTypeNode(node) || ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) return;
    if (ts.isIdentifier(node)) {
      if (isReference(node, parent)) pending.push({ node, scope });
      return;
    }
    if (ts.isFunctionDeclaration(node) && node.name) {
      const binding = declare(scope, node.name.text);
      if (node.body) binding.expressions.push(node.body);
    } else if (ts.isClassDeclaration(node) && node.name) {
      declare(scope, node.name.text);
    } else if (isPlainAssignment(node)) {
      assignments.push({ name: node.left.text, expression: node.right, scope });
    }
    const inner = opensScope(node) ? createScope(scope, ts.isFunctionLike(node)) : scope;
    if (ts.isVariableDeclaration(node) || ts.isParameter(node)) {
      const target = ts.isParameter(node) || isBlockScoped(parent) ? inner : inner.functionScope;
      declareNames(target, node.name, node.initializer ? [node.initializer] : []);
    }
    ts.forEachChild(node, (child) => visit(child, inner, node));
  };
  visit(sourceFile, root, undefined);
  for (const { name, expression, scope } of assignments) {
    (lookup(scope, name) ?? declare(root, name)).expressions.push(expression);
  }
  for (const { node, scope } of pending) {
    const binding = lookup(scope, node.text);
    if (binding) references.set(node, binding);
  }
  return { bindings, references };
}

// Marks the bindings whose expressions derive from a repository root: variables
// and functions whose initializer, assigned value, or body mentions a root
// source or another tainted binding. Iterates to a fixpoint so order does not
// matter.
function markTaintedBindings(bindings, references) {
  let grew = true;
  while (grew) {
    grew = false;
    for (const binding of bindings) {
      if (binding.tainted) continue;
      if (binding.expressions.some((e) => isRepoLiteral(e) || containsRoot(e, references))) {
        binding.tainted = true;
        grew = true;
      }
    }
  }
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
  const { bindings, references } = collectBindings(sourceFile);
  markTaintedBindings(bindings, references);
  const visit = (node) => {
    if (importsSource) return;
    if (isSourceImport(moduleSpecifier(node), filePath)) {
      importsSource = true;
      return;
    }
    if (!readsRoot && readCallee(node)) readsRoot = readsRootArgument(node, references);
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
      const escaped = header.triggers.filter((trigger) => OUTSIDE_PACKAGE.test(trigger));
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
            `${TRIGGER_MARKER} entries are not repo-relative: ${escaped.join(', ')}`,
            'triggers must resolve to repo-relative paths under the package root (no leading / or ../)',
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
