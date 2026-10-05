import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
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
const QUOTES = new Set(["'", '"']);
const DECLARED_NAME_PATTERN = /^(?:ROOT|PLAYWRIGHT)_/;
// `const NAME = `, optionally with a TypeScript annotation (`const NAME: string = `).
const DECLARATION_PATTERN = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]*)?=\s*$/;
// A `/` opens a regex literal after these characters or keywords; anywhere else it is
// a division.
const REGEX_PRECEDERS = new Set([...'(,=:[!&|?{};+-*%<>~^']);
const REGEX_KEYWORDS = new Set(['return', 'typeof', 'case', 'in', 'of', 'instanceof', 'void']);
const ESCAPE_PATTERN =
  /\\(?:u\{([0-9a-fA-F]+)\}|u([0-9a-fA-F]{4})|x([0-9a-fA-F]{2})|\r\n|([\s\S]))/g;
const SIMPLE_ESCAPES = Object.freeze({
  n: '\n',
  t: '\t',
  r: '\r',
  b: '\b',
  f: '\f',
  v: '\v',
  0: '\0',
  '\n': '',
  '\r': '',
  '\u2028': '',
  '\u2029': '',
});

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

const previousWord = (text, index) => {
  let end = index;
  while (end > 0 && /\s/.test(text[end - 1])) end -= 1;
  let start = end;
  while (start > 0 && /[\w$]/.test(text[start - 1])) start -= 1;
  return { char: end > 0 ? text[end - 1] : '', word: text.slice(start, end).join('') };
};

const opensRegex = (text, index) => {
  const { char, word } = previousWord(text, index);
  return char === '' || REGEX_PRECEDERS.has(char) || REGEX_KEYWORDS.has(word);
};

// End (exclusive) of the regex literal opening at `start`, or -1 when no closing `/`
// precedes the newline (the slash was a division after all).
function regexEnd(text, start) {
  let inClass = false;
  for (let i = start + 1; i < text.length; i += 1) {
    const char = text[i];
    if (char === '\\') i += 1;
    else if (char === '\n') return -1;
    else if (char === '[') inClass = true;
    else if (char === ']') inClass = false;
    else if (char === '/' && !inClass) return i + 1;
  }
  return -1;
}

// End (exclusive) of the quoted string opening at `start`; a string left open at a
// newline ends there.
function stringEnd(text, start) {
  const quote = text[start];
  for (let i = start + 1; i < text.length; i += 1) {
    const char = text[i];
    if (char === '\\') i += 1;
    else if (char === quote) return i + 1;
    else if (char === '\n') return i;
  }
  return text.length;
}

// The value a string literal or template text evaluates to: escape sequences resolved,
// line continuations dropped, an unknown escape reduced to its character. This is the
// pattern `new RegExp(string)` compiles, so `'^test/.*\\.spec\\.ts$'` is inspected as
// `^test/.*\.spec\.ts$`.
const cook = (raw) =>
  raw.replace(ESCAPE_PATTERN, (match, codePoint, unit, byte, char) => {
    if (codePoint !== undefined) {
      const value = parseInt(codePoint, 16);
      return value <= 0x10ffff ? String.fromCodePoint(value) : match;
    }
    if (unit !== undefined) return String.fromCharCode(parseInt(unit, 16));
    if (byte !== undefined) return String.fromCharCode(parseInt(byte, 16));
    if (char === undefined) return '';
    return Object.hasOwn(SIMPLE_ESCAPES, char) ? SIMPLE_ESCAPES[char] : char;
  });

// Every string literal, template text run, and regex literal in the source as
// `{ start, text }` — strings and template text cooked (see `cook`), regex bodies raw,
// `start` the offset of the opening delimiter (for a template's later text runs, of
// the `}` closing the preceding substitution) — plus `code`: the source with every
// comment blanked to spaces (newlines kept, so offsets match). Comments are skipped,
// so a documented pattern is never a literal; `//` inside a string never opens a
// comment. A template's `${…}` substitutions are scanned as code, so their strings,
// regexes, and comments are handled like any other. The regex/division and declaration
// lookbacks run on `code`, so a comment between `=` and a literal cannot hide it.
function tokenize(source) {
  const literals = [];
  const code = source.split('');
  const blank = (from, to) => {
    for (let k = from; k < to; k += 1) if (code[k] !== '\n') code[k] = ' ';
  };

  // Scans code from `from`; inside a substitution it stops at the `}` closing it and
  // returns that offset, otherwise it returns the end of the source.
  const scanCode = (from, insideSubstitution) => {
    let depth = 0;
    let i = from;
    while (i < source.length) {
      const char = source[i];
      if (char === '/' && source[i + 1] === '/') {
        const newline = source.indexOf('\n', i);
        const end = newline === -1 ? source.length : newline;
        blank(i, end);
        i = end;
      } else if (char === '/' && source[i + 1] === '*') {
        const close = source.indexOf('*/', i + 2);
        const end = close === -1 ? source.length : close + 2;
        blank(i, end);
        i = end;
      } else if (QUOTES.has(char)) {
        const end = stringEnd(source, i);
        const closed = end > i + 1 && source[end - 1] === char;
        literals.push({ start: i, text: cook(source.slice(i + 1, closed ? end - 1 : end)) });
        i = end;
      } else if (char === '`') {
        i = scanTemplate(i);
      } else if (char === '/' && opensRegex(code, i)) {
        const end = regexEnd(source, i);
        if (end === -1) i += 1;
        else {
          literals.push({ start: i, text: source.slice(i + 1, end - 1) });
          i = end;
        }
      } else if (insideSubstitution && char === '}' && depth === 0) {
        return i;
      } else {
        if (char === '{') depth += 1;
        else if (char === '}') depth -= 1;
        i += 1;
      }
    }
    return i;
  };

  // Scans the template literal opening at `start` and returns the offset after its
  // closing backtick. Each non-empty run of literal text is a literal of its own; each
  // `${…}` substitution is code.
  const scanTemplate = (start) => {
    let runStart = start;
    let textStart = start + 1;
    const pushRun = (end) => {
      if (end > textStart)
        literals.push({ start: runStart, text: cook(source.slice(textStart, end)) });
    };
    let i = textStart;
    while (i < source.length) {
      const char = source[i];
      if (char === '\\') i += 2;
      else if (char === '`') {
        pushRun(i);
        return i + 1;
      } else if (char === '$' && source[i + 1] === '{') {
        pushRun(i);
        const close = scanCode(i + 2, true);
        runStart = close;
        textStart = Math.min(close + 1, source.length);
        i = textStart;
      } else i += 1;
    }
    pushRun(source.length);
    return source.length;
  };

  scanCode(0, false);
  return { literals, code: code.join('') };
}

export const extractLiterals = (source) => tokenize(source).literals;

// The `ROOT_*` / `PLAYWRIGHT_*` name a literal initialises, or null. `code` is the
// comment-blanked source from `tokenize`.
const declaredRootName = (code, start) => {
  const name = DECLARATION_PATTERN.exec(code.slice(Math.max(0, start - 200), start))?.[1];
  return name && DECLARED_NAME_PATTERN.test(name) ? name : null;
};

const offendingRule = (code, { start, text }) => {
  if (ROOT_DIR_PREFIX.test(text) && ROOT_SUFFIX.test(text)) return 'rootPattern';
  if (CT_SUFFIX.test(text)) return 'ctSuffix';
  if (IGNORED_STEMS.test(text)) return 'ignoredSpec';
  if (declaredRootName(code, start) && (ROOT_DIR_ONLY.test(text) || ROOT_SUFFIX.test(text))) {
    return 'rootConstant';
  }
  return null;
};

// Every offending literal in one file: `{ line, text, rule }` per hit, in source order.
export function findOffenders(source) {
  const hits = [];
  const lines = source.split('\n');
  const { literals, code } = tokenize(source);
  for (const literal of literals) {
    const rule = offendingRule(code, literal);
    if (!rule) continue;
    const line = source.slice(0, literal.start).split('\n').length;
    hits.push({ line, text: lines[line - 1].trim(), rule });
  }
  return hits;
}

// Hits in non-allowlisted files plus allowlist entries that no longer match anything.
export function checkSpecPatternSources(files, allowlist = ALLOWLIST) {
  const hits = [];
  const matched = new Set();
  for (const file of files) {
    const filePath = normalize(file.path);
    if (!isScannedPath(filePath)) continue;
    const offenders = findOffenders(file.content);
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
