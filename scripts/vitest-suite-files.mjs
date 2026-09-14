import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

// Shared discovery and header-comment parsing for the scripts that derive
// vitest suite membership from source markers (`ui-invariant-suites.mjs`,
// `verify-changed-triggers.mjs`), so both audit the same file set and read
// markers by the same rules.
export const TEST_SCAN_ROOTS = ['scripts', 'src'];

// Mirrors vitest's default include; `.ct.spec` / `.visual.spec` are the
// Playwright suites vitest.config.ts excludes.
const TEST_FILE = /\.(?:test|spec)\.[cm]?[jt]sx?$/;
const PLAYWRIGHT_FILE = /\.(?:ct|visual)\.spec\.[cm]?[jt]sx?$/;
const SKIP_DIRECTORIES = new Set(['node_modules', 'dist', 'build']);
const SCRIPT_KINDS = { '.tsx': ts.ScriptKind.TSX, '.jsx': ts.ScriptKind.JSX };

export const normalizePath = (value) => value.split(path.sep).join('/');

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

export function collectTestFiles(root = process.cwd()) {
  const files = [];
  const walk = (directory) => {
    if (!fs.existsSync(directory)) return;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRECTORIES.has(entry.name) && !entry.name.startsWith('.')) walk(absolute);
      } else if (isVitestFile(entry.name)) {
        files.push({
          path: normalizePath(path.relative(root, absolute)),
          content: fs.readFileSync(absolute, 'utf8'),
        });
      }
    }
  };
  for (const scanRoot of TEST_SCAN_ROOTS) walk(path.join(root, scanRoot));
  return files;
}
