import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import {
  CT_TEST_DIR,
  CT_TEST_MATCH,
  isCtSpec,
  normalizeCtPath,
} from '../playwright/ct-spec-pattern.mjs';

// Pixel snapshots render text, so a spec that captures one before the bundled Inter
// Variable face is loaded regenerates its goldens against the host fallback font and
// fails on the CI runner. The CT harness loads the face for every `.ct.spec.ts`
// (`playwright/index.ts`, intent-hq/intent#5033); the root `test/` harness has no shared
// load, so cloudlands-fe#2709 tripped the same trap five days later. This scan makes the
// safe path mandatory: a root spec that takes a pixel snapshot imports and calls the
// shared helper, and the CT harness keeps its font import while any CT spec takes one.
// Whether the call precedes the first snapshot is not statically decidable (fixtures,
// hooks, and helpers can run it); the helper itself throws when the face is not loaded,
// so the runtime assertion is the second layer.
export const SNAPSHOT_MATCHERS = Object.freeze(['toHaveScreenshot', 'toMatchSnapshot']);
export const ESCAPE_TOKEN = 'snapshot-font-ok';
export const HELPER_MODULE = 'test/test-fonts';
export const HELPER_EXPORT = 'loadBundledInterFont';
export const CT_HARNESS = 'playwright/index.ts';
export const CT_FONT_IMPORT = '@fontsource-variable/inter';
// `playwright.config.ts`: `testDir: './test'`, `testMatch: '**/*.spec.ts'`.
export const ROOT_TEST_DIR = 'test';
export const ROOT_SPEC_SUFFIX = '.spec.ts';
export const ROOT_SPEC_GLOB = `${ROOT_TEST_DIR}/**/*${ROOT_SPEC_SUFFIX}`;
export const CT_SPEC_GLOB = `${CT_TEST_DIR}/${CT_TEST_MATCH}`;
export const INCIDENTS = Object.freeze([
  'https://github.com/intent-hq/cloudlands-fe/pull/2709',
  'https://github.com/intent-hq/intent/issues/5033',
]);
export const REMEDIATION_HINT = [
  `Pixel snapshots (${SNAPSHOT_MATCHERS.map((m) => `\`${m}\``).join(' / ')}) render text, so the bundled Inter Variable face must be loaded first;`,
  'otherwise goldens regenerate against the host fallback font and fail on CI',
  `(cloudlands-fe#2709 ${INCIDENTS[0]}, intent-hq/intent#5033 ${INCIDENTS[1]}).`,
  `Root specs (${ROOT_SPEC_GLOB}): add \`import { ${HELPER_EXPORT} } from './test-fonts';\``,
  `and call \`await ${HELPER_EXPORT}(page, { baseUrl });\` before the first snapshot`,
  '(the gate checks import + call; the helper throws at runtime when the face is not loaded).',
  `CT specs (${CT_SPEC_GLOB}): keep \`import '${CT_FONT_IMPORT}';\` in ${CT_HARNESS}.`,
  `A text-only snapshot may opt out per line with \`// ${ESCAPE_TOKEN}: <reason>\`;`,
  'a bare token, or one inside a string, does not exempt.',
].join('\n');

const SKIPPED_DIRECTORIES = new Set(['node_modules', 'dist', 'build', '.git', 'paraglide']);
const SCRIPT_EXTENSION = /\.[cm]?[jt]sx?$/;
const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// An escape only counts as a comment carrying a reason on the line of the call:
// `// token: <reason>` or `/* token: <reason> */`, the reason at least one
// non-whitespace character that does not close the block comment. The token is a
// literal, so it is escaped before interpolation into the pattern.
export const createEscapePattern = (token) =>
  new RegExp(`^(?://|/\\*)\\s*${escapeRegExp(token)}:\\s*(?!\\*/)\\S`);
const ESCAPE_PATTERN = createEscapePattern(ESCAPE_TOKEN);

const normalize = (value) => normalizeCtPath(value);
// Playwright's `createFileMatcher` compares `testMatch` case-insensitively with dot
// segments included (see playwright/ct-spec-pattern.mjs), so the root suite is matched
// the same way as the shared CT classifier rather than with `path.matchesGlob`.
export const isRootSpec = (filePath) => {
  const normalized = normalize(filePath);
  return (
    normalized.startsWith(`${ROOT_TEST_DIR}/`) &&
    normalized.toLowerCase().endsWith(ROOT_SPEC_SUFFIX.toLowerCase())
  );
};
export { isCtSpec };

const parse = (filePath, content) =>
  ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

const unwrapParentheses = (node) => {
  while (ts.isParenthesizedExpression(node)) node = node.expression;
  return node;
};

// `x.toHaveScreenshot(...)`, `x['toHaveScreenshot'](...)`, and either wrapped in
// parentheses: `{ name, position }` of the matcher name, else `undefined`.
function snapshotMatcherOf(call) {
  const callee = unwrapParentheses(call.expression);
  if (ts.isPropertyAccessExpression(callee) && SNAPSHOT_MATCHERS.includes(callee.name.text)) {
    return { name: callee.name.text, position: callee.name.getStart() };
  }
  if (ts.isElementAccessExpression(callee)) {
    const argument = unwrapParentheses(callee.argumentExpression);
    if (ts.isStringLiteralLike(argument) && SNAPSHOT_MATCHERS.includes(argument.text)) {
      return { name: argument.text, position: argument.getStart() };
    }
  }
  return undefined;
}

// Every comment in the file, keyed by the line it starts on. Comments are trivia of
// the token they precede or follow, so walking all tokens (not just AST nodes) finds
// each one exactly once via its position.
function commentsByLine(sourceFile) {
  const text = sourceFile.text;
  const byLine = new Map();
  const seen = new Set();
  const add = (range) => {
    if (!range || seen.has(range.pos)) return;
    seen.add(range.pos);
    const { line } = sourceFile.getLineAndCharacterOfPosition(range.pos);
    const list = byLine.get(line) ?? [];
    list.push(text.slice(range.pos, range.end));
    byLine.set(line, list);
  };
  const visit = (node) => {
    ts.getLeadingCommentRanges(text, node.getFullStart())?.forEach(add);
    ts.getTrailingCommentRanges(text, node.getEnd())?.forEach(add);
    node.getChildren(sourceFile).forEach(visit);
  };
  visit(sourceFile);
  return byLine;
}

const isExempt = (comments) => comments?.some((comment) => ESCAPE_PATTERN.test(comment));

/** Every non-exempt pixel-snapshot call: `{ line, matcher, text }`, in source order. */
export function findSnapshotCalls(filePath, content) {
  const sourceFile = parse(filePath, content);
  const comments = commentsByLine(sourceFile);
  const lines = content.split('\n');
  const calls = [];
  const visit = (node) => {
    const matcher = ts.isCallExpression(node) ? snapshotMatcherOf(node) : undefined;
    if (matcher) {
      const { line } = sourceFile.getLineAndCharacterOfPosition(matcher.position);
      if (!isExempt(comments.get(line))) {
        calls.push({ line: line + 1, matcher: matcher.name, text: lines[line].trim() });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return calls;
}

const resolveRelative = (specifier, filePath) =>
  path.posix
    .normalize(path.posix.join(path.posix.dirname(filePath), specifier))
    .replace(SCRIPT_EXTENSION, '');

// Local names bound by value imports of `loadBundledInterFont` from `test/test-fonts`
// (`load` for `import { loadBundledInterFont as load }`).
function fontHelperBindings(sourceFile, filePath) {
  const names = [];
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) {
      continue;
    }
    const specifier = statement.moduleSpecifier.text;
    if (!specifier.startsWith('./') && !specifier.startsWith('../')) continue;
    if (resolveRelative(specifier, filePath) !== HELPER_MODULE) continue;
    const clause = statement.importClause;
    if (!clause || clause.isTypeOnly || !clause.namedBindings) continue;
    if (!ts.isNamedImports(clause.namedBindings)) continue;
    for (const element of clause.namedBindings.elements) {
      if (!element.isTypeOnly && (element.propertyName ?? element.name).text === HELPER_EXPORT) {
        names.push(element.name.text);
      }
    }
  }
  return names;
}

/** Whether the file has a value import of `loadBundledInterFont` resolving to `test/test-fonts`. */
export function importsFontHelper(filePath, content) {
  return fontHelperBindings(parse(filePath, content), filePath).length > 0;
}

/**
 * Whether the file both imports `loadBundledInterFont` (see `importsFontHelper`) and
 * has at least one call expression invoking that binding. Call order relative to the
 * snapshot is not checked: it is not statically decidable, and the helper throws at
 * runtime when the face is not loaded.
 */
export function callsFontHelper(filePath, content) {
  const sourceFile = parse(filePath, content);
  const bindings = new Set(fontHelperBindings(sourceFile, filePath));
  if (bindings.size === 0) return false;
  let called = false;
  const visit = (node) => {
    if (called) return;
    if (ts.isCallExpression(node)) {
      const callee = unwrapParentheses(node.expression);
      if (ts.isIdentifier(callee) && bindings.has(callee.text)) {
        called = true;
        return;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return called;
}

/**
 * Whether the CT harness has the bare side-effect import of the bundled Inter face,
 * `import '@fontsource-variable/inter';`. Any import clause is rejected: a type-only
 * clause is erased at compile time and never loads the stylesheet.
 */
export function harnessImportsFont(content) {
  return parse(CT_HARNESS, content).statements.some(
    (statement) =>
      ts.isImportDeclaration(statement) &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      statement.moduleSpecifier.text === CT_FONT_IMPORT &&
      statement.importClause === undefined,
  );
}

export function collectSpecFiles(root, directory = root) {
  const files = [];
  if (!fs.existsSync(directory)) return files;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRECTORIES.has(entry.name)) files.push(...collectSpecFiles(root, absolute));
    } else if (entry.isFile()) {
      const relative = normalize(path.relative(root, absolute));
      if (isRootSpec(relative) || isCtSpec(relative)) {
        files.push({ path: relative, content: fs.readFileSync(absolute, 'utf8') });
      }
    }
  }
  return files;
}

/**
 * One hit per offending spec, at its first non-exempt pixel-snapshot call:
 * `{ path, line, matcher, text, reason }`. `harness` is the CT harness source
 * (`undefined` when the file is absent).
 */
export function findSnapshotFontHits(files, harness) {
  const hits = [];
  const harnessOk = harness !== undefined && harnessImportsFont(harness);
  for (const file of files) {
    const filePath = normalize(file.path);
    const root = isRootSpec(filePath);
    if (!root && !isCtSpec(filePath)) continue;
    const [first] = findSnapshotCalls(filePath, file.content);
    if (!first) continue;
    if (root && !importsFontHelper(filePath, file.content)) {
      hits.push({
        path: filePath,
        ...first,
        reason: `no \`import { ${HELPER_EXPORT} }\` from \`./test-fonts\` (${HELPER_MODULE}.ts)`,
      });
    } else if (root && !callsFontHelper(filePath, file.content)) {
      hits.push({
        path: filePath,
        ...first,
        reason: `\`${HELPER_EXPORT}\` is imported but never called`,
      });
    } else if (!root && !harnessOk) {
      hits.push({
        path: filePath,
        ...first,
        reason:
          harness === undefined
            ? `${CT_HARNESS} is missing`
            : `${CT_HARNESS} no longer imports '${CT_FONT_IMPORT}'`,
      });
    }
  }
  return hits;
}

export const formatHit = ({ path: filePath, line, matcher, text, reason }) =>
  `${filePath}:${line}: \`${matcher}\` — ${reason}\n    ${text}`;

const readHarness = (root) => {
  const absolute = path.join(root, CT_HARNESS);
  return fs.existsSync(absolute) ? fs.readFileSync(absolute, 'utf8') : undefined;
};

export function main(root = process.cwd()) {
  const files = collectSpecFiles(root);
  const hits = findSnapshotFontHits(files, readHarness(root));
  if (hits.length) {
    console.error(
      [
        `Pixel-snapshot specs without the bundled Inter face (${hits.length}):`,
        ...hits.map(formatHit),
        REMEDIATION_HINT,
      ].join('\n'),
    );
    return 1;
  }
  const snapshotting = files.filter(
    (file) => findSnapshotCalls(normalize(file.path), file.content).length > 0,
  ).length;
  console.log(
    `Snapshot fonts valid: ${snapshotting} of ${files.length} Playwright specs take pixel snapshots, all with the bundled Inter face loaded.`,
  );
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main());
}
