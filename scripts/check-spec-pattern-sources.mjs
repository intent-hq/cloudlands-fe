import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { lineOf, parseSource, ts, unwrapExpression, walk } from './source-ast-lib.mjs';
import { CT_SPEC_SUFFIX } from '../playwright/ct-spec-pattern.mjs';
import {
  ROOT_IGNORED_SPEC_NAMES,
  ROOT_SPEC_SUFFIX,
  ROOT_TEST_DIR,
} from '../playwright/root-spec-pattern.mjs';

// Scripts must classify Playwright specs through `isRootSpec` / `isIgnoredRootSpec`
// (playwright/root-spec-pattern.mjs) and `isCtSpec` (playwright/ct-spec-pattern.mjs),
// never through a copy of the discovery pattern. Each copy drifted from the config it
// mirrored: cloudlands-fe#2572 pasted a broader CT regex into `ct-contract-paths.mjs`,
// and cloudlands-fe#2720's review found `check-snapshot-fonts.mjs` walking
// `test/**/*.spec.ts` unaware of `testIgnore`. This gate scans `scripts/**` and
// `playwright/**` for the literals such a copy needs.
//
// A string literal, the literal text of a template, or a regex literal is an offender
// when
//   (a) it starts with the root test dir (`test/`, `^test\/`, `./test/`) and also
//       contains the root spec suffix (`.spec.ts` / `\.spec\.ts`);
//   (b) it contains the CT spec suffix (`.ct.spec.ts` / `\.ct\.spec\.ts`);
//   (c) it contains the stem of an ignored root spec basename
//       (`catalog-manual-review.capture`, …);
//   (d) it initialises a `const` / `let` / `var` named `ROOT_*` / `PLAYWRIGHT_*` and
//       holds either half of (a) on its own (`ROOT_TEST_DIR = 'test'`,
//       `ROOT_SPEC_SUFFIX = '.spec.ts'`).
// Strings and template text are inspected with their escapes resolved, so
// `new RegExp('^test/.*\\.spec\\.ts$')` reads as the regex it compiles; a `${…}`
// substitution is code, and its own strings and regexes are inspected separately.
// Comments are not literals, so a documented example never trips the gate. Test-path
// heuristics that only name a suffix family (`\.(?:ct|visual)\.spec\.`,
// `\.(?:test|spec)\.ts$`) match none of the forms. `*.test.*` files are skipped
// entirely: their fixtures are path strings by nature, and a classifier they exercise
// is caught where it is defined.
export const SCRIPT_PATH = 'scripts/check-spec-pattern-sources.mjs';
export const SCAN_ROOTS = Object.freeze(['scripts', 'playwright']);
export const SCANNED_EXTENSIONS = new Set(['.mjs', '.cjs', '.js', '.ts']);
export const ROOT_PATTERN_MODULE = 'playwright/root-spec-pattern.mjs';
export const CT_PATTERN_MODULE = 'playwright/ct-spec-pattern.mjs';
export const INCIDENTS = Object.freeze([
  'https://github.com/intent-hq/cloudlands-fe/pull/2572',
  'https://github.com/intent-hq/cloudlands-fe/pull/2720',
]);

// Documented exceptions: repo-relative path → one-line justification. An entry whose
// file no longer carries an offending literal is reported as stale and must be removed.
export const ALLOWLIST = Object.freeze({});

export const REMEDIATION_HINT = [
  'Spec discovery is defined once: import `isRootSpec` / `isIgnoredRootSpec` (and the',
  `ROOT_* constants) from ${ROOT_PATTERN_MODULE}, and \`isCtSpec\` / \`hasCtSpecSuffix\` (and`,
  `the CT_* constants) from ${CT_PATTERN_MODULE}, instead of spelling the pattern again.`,
  'A copied pattern drifts from the config it mirrors: cloudlands-fe#2572',
  `(${INCIDENTS[0]}) pasted a broader CT regex, and cloudlands-fe#2720 (${INCIDENTS[1]})`,
  'found a root walk unaware of `testIgnore`.',
  `A deliberate exception is an ALLOWLIST entry in ${SCRIPT_PATH} with a one-line justification.`,
].join('\n');

const SKIPPED_DIRECTORIES = new Set(['node_modules', 'dist', 'build', '.git']);
const SKIPPED_FILES = new Set([ROOT_PATTERN_MODULE, CT_PATTERN_MODULE]);
const TEST_FILE_PATTERN = /\.test\.[cm]?[jt]sx?$/;
const DECLARED_NAME_PATTERN = /^(?:ROOT|PLAYWRIGHT)_/;

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// `.` may be spelled `\.` in a regex, and a `/` may be `\/`.
const literalPattern = (value) =>
  escapeRegExp(value).replace(/\\\./g, '\\\\?\\.').replace(/\//g, '\\\\?\\/');
const specStem = (name) => name.slice(0, -ROOT_SPEC_SUFFIX.length);

const ROOT_DIR_PREFIX = new RegExp(`^\\^?(?:\\.\\/)?${literalPattern(`${ROOT_TEST_DIR}/`)}`);
const ROOT_DIR_ONLY = new RegExp(`^\\^?(?:\\.\\/)?${literalPattern(ROOT_TEST_DIR)}\\\\?\\/?\\$?$`);
const ROOT_SUFFIX = new RegExp(literalPattern(ROOT_SPEC_SUFFIX), 'i');
const CT_SUFFIX = new RegExp(literalPattern(CT_SPEC_SUFFIX), 'i');
const IGNORED_STEMS = new RegExp(
  ROOT_IGNORED_SPEC_NAMES.map((name) => literalPattern(specStem(name))).join('|'),
  'i',
);

export const RULES = Object.freeze({
  rootPattern: `root spec discovery (\`${ROOT_TEST_DIR}/\` + \`${ROOT_SPEC_SUFFIX}\`) — use \`isRootSpec\` from ${ROOT_PATTERN_MODULE}`,
  ctSuffix: `CT spec suffix \`${CT_SPEC_SUFFIX}\` — use \`isCtSpec\` from ${CT_PATTERN_MODULE}`,
  ignoredSpec: `ignored root spec name — use \`isIgnoredRootSpec\` / ROOT_IGNORED_SPEC_NAMES from ${ROOT_PATTERN_MODULE}`,
  rootConstant: `root spec dir/suffix constant — import ROOT_TEST_DIR / ROOT_SPEC_SUFFIX from ${ROOT_PATTERN_MODULE}`,
});

const normalize = (value) => value.split(path.sep).join('/').replace(/^\.\//, '');

export const isScannedPath = (filePath) =>
  SCANNED_EXTENSIONS.has(path.posix.extname(filePath)) &&
  !TEST_FILE_PATTERN.test(filePath) &&
  !SKIPPED_FILES.has(filePath);

// Every string literal, template text run and regex literal in the source, in source
// order: `{ node, text }`. The parser cooks strings and template text (escapes resolved),
// so `new RegExp('^test/.*\\.spec\\.ts$')` reads as the regex it compiles; regex bodies
// are raw. Comments are not nodes, and a `${…}` substitution is code whose own literals
// are visited separately.
function literalNodes(sourceFile) {
  const literals = [];
  walk(sourceFile, (node) => {
    let text = null;
    if (ts.isRegularExpressionLiteral(node)) text = node.text.slice(1, node.text.lastIndexOf('/'));
    else if (
      ts.isStringLiteralLike(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node)
    ) {
      text = node.text ?? node.rawText ?? '';
    }
    if (text) literals.push({ node, text });
  });
  return literals;
}

export const extractLiterals = (source, filePath) =>
  literalNodes(parseSource(source, filePath)).map(({ node, text }) => ({
    start: node.getStart(),
    text,
  }));

// The `ROOT_*` / `PLAYWRIGHT_*` variable a literal initialises (a template through its
// head), or null.
function declaredRootName(node) {
  let value = ts.isTemplateHead(node) ? node.parent : node;
  while (value.parent && unwrapExpression(value.parent) !== value.parent) value = value.parent;
  const declaration = value.parent;
  if (
    !declaration ||
    !ts.isVariableDeclaration(declaration) ||
    declaration.initializer !== value ||
    !ts.isIdentifier(declaration.name)
  ) {
    return null;
  }
  return DECLARED_NAME_PATTERN.test(declaration.name.text) ? declaration.name.text : null;
}

const offendingRule = ({ node, text }) => {
  if (ROOT_DIR_PREFIX.test(text) && ROOT_SUFFIX.test(text)) return 'rootPattern';
  if (CT_SUFFIX.test(text)) return 'ctSuffix';
  if (IGNORED_STEMS.test(text)) return 'ignoredSpec';
  if (declaredRootName(node) && (ROOT_DIR_ONLY.test(text) || ROOT_SUFFIX.test(text))) {
    return 'rootConstant';
  }
  return null;
};

// Every offending literal in one file: `{ line, text, rule }` per hit, in source order.
export function findOffenders(source, filePath) {
  const lines = source.split('\n');
  return literalNodes(parseSource(source, filePath)).flatMap((literal) => {
    const rule = offendingRule(literal);
    if (!rule) return [];
    const line = lineOf(literal.node);
    return [{ line, text: lines[line - 1].trim(), rule }];
  });
}

// Hits in non-allowlisted files plus allowlist entries that no longer match anything.
export function checkSpecPatternSources(files, allowlist = ALLOWLIST) {
  const hits = [];
  const matched = new Set();
  for (const file of files) {
    const filePath = normalize(file.path);
    if (!isScannedPath(filePath)) continue;
    const offenders = findOffenders(file.content, filePath);
    if (!offenders.length) continue;
    if (Object.hasOwn(allowlist, filePath)) matched.add(filePath);
    else hits.push(...offenders.map((hit) => ({ path: filePath, ...hit })));
  }
  const stale = Object.keys(allowlist).filter((filePath) => !matched.has(filePath));
  return { hits, stale };
}

export const formatHit = ({ path: filePath, line, text, rule }) =>
  `${filePath}:${line}\n    ${text}\n    ${RULES[rule]}`;

export function collectSourceFiles(root, roots = SCAN_ROOTS) {
  const files = [];
  const walk = (directory) => {
    if (!fs.existsSync(directory)) return;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRECTORIES.has(entry.name) && !entry.name.startsWith('.')) walk(absolute);
      } else if (entry.isFile()) {
        const relative = normalize(path.relative(root, absolute));
        if (isScannedPath(relative)) {
          files.push({ path: relative, content: fs.readFileSync(absolute, 'utf8') });
        }
      }
    }
  };
  for (const scanRoot of roots) walk(path.join(root, scanRoot));
  return files;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { hits, stale } = checkSpecPatternSources(collectSourceFiles(process.cwd()));
  if (hits.length || stale.length) {
    const lines = [];
    if (hits.length) {
      lines.push(
        `Re-derived spec discovery pattern${hits.length === 1 ? '' : 's'} in ${SCAN_ROOTS.join('/ and ')}/:`,
      );
      lines.push(...hits.map((hit) => `  ${formatHit(hit)}`));
      lines.push('', REMEDIATION_HINT);
    }
    if (stale.length) {
      lines.push(
        `Stale ALLOWLIST ${stale.length === 1 ? 'entry' : 'entries'} in ${SCRIPT_PATH} (no offending literal left):`,
      );
      lines.push(...stale.map((filePath) => `  ${filePath}`));
    }
    console.error(lines.join('\n'));
    process.exit(1);
  }
  console.log(`spec-pattern-sources: no re-derived spec discovery in ${SCAN_ROOTS.join('/, ')}/.`);
}
