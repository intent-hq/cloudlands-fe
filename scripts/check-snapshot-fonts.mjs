import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

// Pixel snapshots render text, so a spec that captures one before the bundled Inter
// Variable face is loaded regenerates its goldens against the host fallback font and
// fails on the CI runner. The CT harness loads the face for every `.ct.spec.ts`
// (`playwright/index.ts`, intent-hq/intent#5033); the root `test/` harness has no shared
// load, so cloudlands-fe#2709 tripped the same trap five days later. This scan makes the
// safe path mandatory: a root spec that takes a pixel snapshot imports the shared helper,
// and the CT harness keeps its font import while any CT spec takes one.
export const SNAPSHOT_MATCHERS = Object.freeze(['toHaveScreenshot', 'toMatchSnapshot']);
export const ESCAPE_TOKEN = 'snapshot-font-ok';
export const HELPER_MODULE = 'test/test-fonts';
export const HELPER_EXPORT = 'loadBundledInterFont';
export const CT_HARNESS = 'playwright/index.ts';
export const CT_FONT_IMPORT = '@fontsource-variable/inter';
export const ROOT_SPEC_GLOB = 'test/**/*.spec.ts';
export const CT_SPEC_GLOB = 'src/**/*.ct.spec.ts';
export const INCIDENTS = Object.freeze([
  'https://github.com/intent-hq/cloudlands-fe/pull/2709',
  'https://github.com/intent-hq/intent/issues/5033',
]);
export const REMEDIATION_HINT = [
  `Pixel snapshots (${SNAPSHOT_MATCHERS.map((m) => `\`${m}\``).join(' / ')}) render text, so the bundled Inter Variable face must be loaded first;`,
  'otherwise goldens regenerate against the host fallback font and fail on CI',
  `(cloudlands-fe#2709 ${INCIDENTS[0]}, intent-hq/intent#5033 ${INCIDENTS[1]}).`,
  `Root specs (${ROOT_SPEC_GLOB}): add \`import { ${HELPER_EXPORT} } from './test-fonts';\``,
  `and call \`await ${HELPER_EXPORT}(page, { baseUrl });\` before the first snapshot.`,
  `CT specs (${CT_SPEC_GLOB}): keep \`import '${CT_FONT_IMPORT}';\` in ${CT_HARNESS}.`,
  `A text-only snapshot may opt out per line with \`// ${ESCAPE_TOKEN}: <reason>\`;`,
  'a bare token, or one inside a string, does not exempt.',
].join('\n');

const SKIPPED_DIRECTORIES = new Set(['node_modules', 'dist', 'build', '.git', 'paraglide']);
const SCRIPT_EXTENSION = /\.[cm]?[jt]sx?$/;
// An escape only counts as a comment carrying a reason on the line of the call:
// `// token: <reason>` or `/* token: <reason> */`, the reason at least one
// non-whitespace character that does not close the block comment.
const ESCAPE_PATTERN = new RegExp(`^(?://|/\\*)\\s*${ESCAPE_TOKEN}:\\s*(?!\\*/)\\S`);

const normalize = (value) => value.split(path.sep).join('/').replace(/^\.\//, '');
export const isRootSpec = (filePath) => path.posix.matchesGlob(filePath, ROOT_SPEC_GLOB);
export const isCtSpec = (filePath) => path.posix.matchesGlob(filePath, CT_SPEC_GLOB);

const parse = (filePath, content) =>
  ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

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
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      SNAPSHOT_MATCHERS.includes(node.expression.name.text)
    ) {
      const { line } = sourceFile.getLineAndCharacterOfPosition(node.expression.name.getStart());
      if (!isExempt(comments.get(line))) {
        calls.push({
          line: line + 1,
          matcher: node.expression.name.text,
          text: lines[line].trim(),
        });
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

/** Whether the file has a value import of `loadBundledInterFont` resolving to `test/test-fonts`. */
export function importsFontHelper(filePath, content) {
  return parse(filePath, content).statements.some((statement) => {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) {
      return false;
    }
    const specifier = statement.moduleSpecifier.text;
    if (!specifier.startsWith('./') && !specifier.startsWith('../')) return false;
    if (resolveRelative(specifier, filePath) !== HELPER_MODULE) return false;
    const clause = statement.importClause;
    if (!clause || clause.isTypeOnly || !clause.namedBindings) return false;
    if (!ts.isNamedImports(clause.namedBindings)) return false;
    return clause.namedBindings.elements.some(
      (element) =>
        !element.isTypeOnly && (element.propertyName ?? element.name).text === HELPER_EXPORT,
    );
  });
}

/** Whether the CT harness has the side-effect import of the bundled Inter face. */
export function harnessImportsFont(content) {
  return parse(CT_HARNESS, content).statements.some(
    (statement) =>
      ts.isImportDeclaration(statement) &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      statement.moduleSpecifier.text === CT_FONT_IMPORT,
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
