import { existsSync, readFileSync } from 'node:fs';
import path, { resolve } from 'node:path';
import { globSync } from 'glob';
import ts from 'typescript';
import { gitignoreDirExcludes } from './gitignore-dir-excludes.mjs';

// Shared discovery and header-comment parsing for the scripts that derive
// vitest suite membership from source markers (`ui-invariant-suites.mjs`,
// `verify-changed-triggers.mjs`), so both audit the same file set and read
// markers by the same rules. Discovery follows vitest.config.ts rather than a
// list of directories: a fixed `scripts`/`src` list silently skipped
// tests/unit, eslint-rules and playwright suites that CI runs (cloudlands-fe#4034).

// Mirrors vitest's default include; `.ct.spec` / `.visual.spec` are the
// Playwright suites vitest.config.ts excludes.
const TEST_FILE = /\.(?:test|spec)\.[cm]?[jt]sx?$/;
const PLAYWRIGHT_FILE = /\.(?:ct|visual)\.spec\.[cm]?[jt]sx?$/;
const SCRIPT_KINDS = { '.tsx': ts.ScriptKind.TSX, '.jsx': ts.ScriptKind.JSX };

export function isPlaywrightFile(fileName) {
  return PLAYWRIGHT_FILE.test(fileName);
}

export function isVitestFile(fileName) {
  return TEST_FILE.test(fileName) && !PLAYWRIGHT_FILE.test(fileName);
}

export function stripBom(content) {
  return content.charCodeAt(0) === 0xfeff ? content.slice(1) : content;
}

function readLineEnd(source, index) {
  const end = source.indexOf('\n', index);
  return end === -1 ? source.length : end;
}

// The comments that precede the first token, skipping a hashbang, as
// `{ block, body }`. Text after a closing `*/` on the same line is code.
function readLeadingCommentEntries(content) {
  const source = stripBom(content);
  const comments = [];
  let index = source.startsWith('#!') ? readLineEnd(source, 0) : 0;
  while (index < source.length) {
    if (/\s/.test(source[index])) {
      index += 1;
    } else if (source.startsWith('//', index)) {
      const end = readLineEnd(source, index);
      comments.push({ block: false, body: source.slice(index + 2, end) });
      index = end;
    } else if (source.startsWith('/*', index)) {
      const close = source.indexOf('*/', index + 2);
      const end = close === -1 ? source.length : close;
      comments.push({ block: true, body: source.slice(index + 2, end) });
      index = end + 2;
    } else {
      break;
    }
  }
  return comments;
}

// Returns the bodies of the comments that precede the first token.
export function readLeadingComments(content) {
  return readLeadingCommentEntries(content).map((comment) => comment.body);
}

// The leading comments flattened into trimmed lines, in source order. A single
// `*` gutter is stripped only inside `/* */` blocks; a `**` run, or any leading
// `*` on a `//` line, is content (`**/*.svelte`).
export function readHeaderLines(content) {
  const lines = [];
  for (const { block, body } of readLeadingCommentEntries(content)) {
    for (const rawLine of body.split(/\r?\n/)) {
      lines.push((block ? rawLine.replace(/^\s*\*(?!\*)/, '') : rawLine).trim());
    }
  }
  return lines;
}

export function parseSuite(content, filePath = 'suite.ts') {
  return ts.createSourceFile(
    filePath,
    stripBom(content),
    ts.ScriptTarget.Latest,
    false,
    SCRIPT_KINDS[path.extname(filePath)] ?? ts.ScriptKind.TS,
  );
}

// Vitest's default `test.include`; vitest.config.ts does not override it (a
// config that does is reported as incomplete by `vitestExclusions`).
export const VITEST_INCLUDE_GLOB = '**/*.{test,spec}.?(c|m)[jt]s?(x)';

// Bounded static interpretation only: never evaluate a project's config while
// planning. Unknown expressions must not establish equivalent inventory coverage.
function literalProperty(object, name) {
  if (
    !object ||
    !ts.isObjectLiteralExpression(object) ||
    object.properties.some(
      (property) => ts.isSpreadAssignment(property) || ts.isComputedPropertyName(property.name),
    )
  )
    return null;
  const matches = object.properties.filter((property) => property.name.text === name);
  if (matches.length > 1 || (matches.length && !ts.isPropertyAssignment(matches[0]))) return null;
  return matches[0]?.initializer;
}

export function vitestExclusions(root, configFile = 'vitest.config.ts') {
  const unknown = { patterns: [], exclusionsKnown: false, complete: false };
  const configPath = resolve(root, configFile);
  if (!existsSync(configPath)) return unknown;
  const source = ts.createSourceFile(
    configPath,
    readFileSync(configPath, 'utf8'),
    ts.ScriptTarget.Latest,
    false,
  );
  if (source.parseDiagnostics.length) return unknown;
  const imports = new Map();
  for (const statement of source.statements.filter(ts.isImportDeclaration)) {
    const clause = statement.importClause;
    if (clause?.name) imports.set(clause.name.text, [statement.moduleSpecifier.text, 'default']);
    if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings)) {
      for (const binding of clause.namedBindings.elements)
        imports.set(binding.name.text, [
          statement.moduleSpecifier.text,
          (binding.propertyName ?? binding.name).text,
        ]);
    }
  }
  const imported = (node, module, name) =>
    node && ts.isIdentifier(node) && imports.get(node.text)?.join(':') === `${module}:${name}`;
  const shadowed = new Set();
  const forgetBindings = (node) => {
    if (ts.isIdentifier(node)) {
      imports.delete(node.text);
      shadowed.add(node.text);
    } else if (ts.isBindingElement(node)) forgetBindings(node.name);
    else ts.forEachChild(node, forgetBindings);
  };
  for (const statement of source.statements.filter(ts.isVariableStatement))
    for (const declaration of statement.declarationList.declarations)
      forgetBindings(declaration.name);
  const exports = source.statements.filter(ts.isExportAssignment);
  if (exports.length !== 1 || exports[0].isExportEquals) return unknown;
  let config = exports[0].expression;
  if (
    ts.isCallExpression(config) &&
    imported(config.expression, 'vitest/config', 'defineConfig') &&
    config.arguments.length === 1
  ) {
    config = config.arguments[0];
    if (ts.isArrowFunction(config) && config.parameters.length === 0 && ts.isBlock(config.body)) {
      const statements = config.body.statements;
      const returned = statements.at(-1);
      if (
        !returned ||
        !ts.isReturnStatement(returned) ||
        !statements.slice(0, -1).every(ts.isVariableStatement)
      )
        return unknown;
      // A callback-local binding must not masquerade as one of the known imports.
      for (const statement of statements.slice(0, -1))
        for (const declaration of statement.declarationList.declarations)
          forgetBindings(declaration.name);
      config = returned.expression;
    }
  }
  const test = literalProperty(config, 'test');
  const exclude = literalProperty(test, 'exclude');
  if (exclude === null || (exclude && !ts.isArrayLiteralExpression(exclude))) return unknown;
  // Discovery and execution filters need a real config evaluator; keep the scan then.
  const complete =
    literalProperty(config, 'root') === undefined &&
    [
      'include',
      'dir',
      'root',
      'projects',
      'workspace',
      'testNamePattern',
      'typecheck',
      'related',
      'changed',
      'shard',
      'tagsFilter',
      'cliExclude',
      'listTags',
      'clearCache',
      'mergeReports',
    ].every((name) => literalProperty(test, name) === undefined);
  const patterns = [];
  let exclusionsKnown = true;
  for (const element of exclude?.elements ?? []) {
    if (ts.isStringLiteral(element)) {
      patterns.push(element.text);
      continue;
    }
    // The repo's one computed exclusion source has an existing pure helper.
    // Accept only its imported call with the exact root .gitignore argument.
    const call = ts.isSpreadElement(element) ? element.expression : null;
    const argument =
      call && ts.isCallExpression(call) && call.arguments.length === 1 ? call.arguments[0] : null;
    const callee = argument && ts.isCallExpression(argument) ? argument.expression : null;
    if (
      call &&
      ts.isCallExpression(call) &&
      imported(call.expression, './scripts/gitignore-dir-excludes.mjs', 'gitignoreDirExcludes') &&
      callee &&
      ts.isPropertyAccessExpression(callee) &&
      callee.name.text === 'join' &&
      (imported(callee.expression, 'path', 'default') ||
        imported(callee.expression, 'node:path', 'default')) &&
      argument.arguments.length === 2 &&
      ts.isIdentifier(argument.arguments[0]) &&
      argument.arguments[0].text === '__dirname' &&
      !shadowed.has('__dirname') &&
      ts.isStringLiteral(argument.arguments[1]) &&
      argument.arguments[1].text === '.gitignore' &&
      existsSync(resolve(root, '.gitignore'))
    ) {
      patterns.push(...gitignoreDirExcludes(resolve(root, '.gitignore')));
    } else exclusionsKnown = false;
  }
  return { patterns, exclusionsKnown, complete: complete && exclusionsKnown };
}

// Vitest's own default exclusions; a readable config replaces them in Vitest,
// and keeping them here only prunes trees the real config also skips.
const VITEST_DEFAULT_EXCLUDE = ['**/node_modules/**', '**/.git/**'];
const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

// The unit config's test files, found the way Vitest finds them: its default
// include, dotfiles included, minus the config's statically readable excludes.
// An exclusion this reader cannot interpret only widens the audit; the
// real-runner drift test in vitest-suite-files.test.ts catches any other gap.
export function collectTestFiles(root = process.cwd()) {
  const { patterns } = vitestExclusions(root);
  return globSync(VITEST_INCLUDE_GLOB, {
    cwd: root,
    ignore: [...VITEST_DEFAULT_EXCLUDE, ...patterns],
    nodir: true,
    dot: true,
    posix: true,
  })
    .filter(isVitestFile)
    .sort(compare)
    .map((file) => ({ path: file, content: readFileSync(path.join(root, file), 'utf8') }));
}
