#!/usr/bin/env node
// check-saga-selector-hygiene.mjs — Grep-based gate for the saga-selector
// hygiene rules documented in `.agents/skills/redux-store/SKILL.md`
// § "Sagas" and "State access in functions reached from sagas".
//
// Failure shapes:
//   added raw selector reads: yield* select()
//   added raw selector reads: yield* select(selectFoo.select, ...)
//   yield* select((state) => ...)
//   yield* takeEvery(action.type, handler)
//   yield* takeLatest([actionA.type, actionB.type], handler)
//
// The fix is the equivalent `yield* sel.effect(…)`, which produces the
// same SELECT effect under the hood while preserving expectSaga.provide()
// testability and avoiding stale-state reads.
//
// Why grep and not eslint: the violations are syntactically distinctive
// enough that this script catches them without dragging AST machinery
// into the repo.
//
// Usage:
//   node scripts/check-saga-selector-hygiene.mjs            # scans src/
//   node scripts/check-saga-selector-hygiene.mjs path/dir   # specific dir
//
// Exit codes: 0 = clean, 1 = violations found.

import { readFileSync } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { join, relative, resolve } from 'node:path';

const ROOT = process.cwd();
const SEARCH_DIR = resolve(ROOT, process.argv[2] ?? 'src');

const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  'build',
  '.svelte-kit',
  '.git',
  'cdp-mcp-server',
  'parallel-runner',
  'playwright-report',
]);

function isSagaFile(absPath) {
  const norm = absPath.split('\\').join('/');
  if (!norm.includes('/sagas/')) return false;
  if (!/\.(ts|tsx|js|jsx|mjs)$/.test(norm)) return false;
  if (/\.test\.(ts|tsx|js|jsx|mjs)$/.test(norm)) return false;
  return true;
}

const INLINE_SELECTOR_PATTERN =
  /yield\s*\*\s*select\s*\(\s*(?:\([^)]*\)|[A-Za-z_$][\w$]*(?:\s*:\s*[^=,()]+)?)\s*=>/g;
const RAW_SELECT_PATTERN = /yield\s*\*\s*select\s*\(/g;
const WATCHER_PATTERN = /yield\s*\*?\s*take(?:Every|Latest|Leading|Maybe)\s*\(/g;
let rawSelectBaseRef;

async function* walk(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      yield* walk(full);
    } else if (entry.isFile()) {
      if (isSagaFile(full)) yield full;
    }
  }
}

function stripComments(src) {
  let out = '';
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const next = src[i + 1];
    if (c === '/' && next === '/') {
      while (i < n && src[i] !== '\n') {
        out += ' ';
        i++;
      }
    } else if (c === '/' && next === '*') {
      out += '  ';
      i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) {
        out += src[i] === '\n' ? '\n' : ' ';
        i++;
      }
      if (i < n) {
        out += '  ';
        i += 2;
      }
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

function findFirstArgumentEnd(src, openParenIndex) {
  let depth = 0;
  let quote = null;
  for (let i = openParenIndex; i < src.length; i++) {
    const c = src[i];
    const prev = src[i - 1];
    if (quote) {
      if (c === quote && prev !== '\\') quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      quote = c;
      continue;
    }
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') depth--;
    else if (c === ',' && depth === 1) return i;
  }
  return -1;
}

function findCallEnd(src, openParenIndex) {
  let depth = 0;
  let quote = null;
  for (let i = openParenIndex; i < src.length; i++) {
    const c = src[i];
    const prev = src[i - 1];
    if (quote) {
      if (c === quote && prev !== '\\') quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      quote = c;
      continue;
    }
    if (c === '(') depth++;
    else if (c === ')') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function getRawSelectBaseRef() {
  if (rawSelectBaseRef !== undefined) return rawSelectBaseRef;
  const candidates = [
    process.env.SAGA_SELECTOR_HYGIENE_BASE,
    'origin/main',
    'main',
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      execFileSync('git', ['merge-base', candidate, 'HEAD'], {
        cwd: ROOT,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
      rawSelectBaseRef = candidate;
      return rawSelectBaseRef;
    } catch {
      // Try the next candidate.
    }
  }
  rawSelectBaseRef = null;
  return rawSelectBaseRef;
}

function getAddedLineNumbersSinceBase(relPath) {
  const baseRef = getRawSelectBaseRef();
  if (!baseRef) return null;

  try {
    execFileSync('git', ['ls-files', '--error-unmatch', relPath], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return null;
  }

  let base;
  try {
    base = execFileSync('git', ['merge-base', baseRef, 'HEAD'], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }

  let diff;
  try {
    diff = execFileSync('git', ['diff', '--unified=0', base, '--', relPath], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return null;
  }

  const added = new Set();
  let newLine = 0;
  for (const line of diff.split('\n')) {
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (hunk) {
      newLine = Number(hunk[1]);
      continue;
    }
    if (line.startsWith('+++')) continue;
    if (line.startsWith('+')) {
      added.add(newLine);
      newLine++;
    } else if (line.startsWith('-')) {
      continue;
    } else if (line.length > 0) {
      newLine++;
    }
  }
  return added;
}

function lineRangeOverlaps(lineSet, startLine, endLine) {
  if (!lineSet) return true;
  for (let line = startLine; line <= endLine; line++) {
    if (lineSet.has(line)) return true;
  }
  return false;
}

function findViolations(src, relPath) {
  const stripped = stripComments(src);
  const out = [];
  INLINE_SELECTOR_PATTERN.lastIndex = 0;
  let m;
  while ((m = INLINE_SELECTOR_PATTERN.exec(stripped)) !== null) {
    const line = stripped.slice(0, m.index).split('\n').length;
    out.push({
      name: 'inline selector lambda',
      line,
      snippet: src.slice(m.index, m.index + 100).replace(/\n.*/s, ''),
    });
  }

  // Legacy saga files still contain raw select reads. Keep the gate useful for
  // PRs by enforcing the `.effect()` rule on lines added or changed relative to
  // the merge base, while older raw reads are migrated incrementally.
  const addedLines = getAddedLineNumbersSinceBase(relPath);
  RAW_SELECT_PATTERN.lastIndex = 0;
  while ((m = RAW_SELECT_PATTERN.exec(stripped)) !== null) {
    const openParenIndex = stripped.indexOf('(', m.index);
    const closeParenIndex = findCallEnd(stripped, openParenIndex);
    if (closeParenIndex === -1) continue;

    const startLine = stripped.slice(0, m.index).split('\n').length;
    const endLine =
      startLine + stripped.slice(m.index, closeParenIndex).split('\n').length - 1;
    if (!lineRangeOverlaps(addedLines, startLine, endLine)) continue;

    const firstArgEnd = findFirstArgumentEnd(stripped, openParenIndex);
    const firstArgClose =
      firstArgEnd === -1 || firstArgEnd > closeParenIndex ? closeParenIndex : firstArgEnd;
    const firstArg = stripped.slice(openParenIndex + 1, firstArgClose).trim();
    const name =
      firstArg.length === 0
        ? 'raw whole-state select'
        : /\b[A-Za-z_$][\w$]*\.select\b/.test(firstArg)
          ? 'raw selector.select read'
          : 'raw select read';
    out.push({
      name,
      line: startLine,
      snippet: src
        .slice(m.index, closeParenIndex + 1)
        .replace(/\n\s*/g, ' ')
        .slice(0, 120),
    });
  }

  WATCHER_PATTERN.lastIndex = 0;
  while ((m = WATCHER_PATTERN.exec(stripped)) !== null) {
    const openParenIndex = stripped.indexOf('(', m.index);
    const firstArgEnd = findFirstArgumentEnd(stripped, openParenIndex);
    if (firstArgEnd === -1) continue;
    const firstArg = stripped.slice(openParenIndex + 1, firstArgEnd);
    if (!/\b[A-Za-z_$][\w$]*\.type\b/.test(firstArg)) continue;
    const line = stripped.slice(0, m.index).split('\n').length;
    out.push({
      name: 'watcher .type registration',
      line,
      snippet: src
        .slice(m.index, firstArgEnd + 1)
        .replace(/\n\s*/g, ' ')
        .slice(0, 120),
    });
  }
  return out;
}

const RED = '\x1b[0;31m';
const YELLOW = '\x1b[0;33m';
const CYAN = '\x1b[0;36m';
const NC = '\x1b[0m';

async function main() {
  let isDir = false;
  try {
    isDir = (await stat(SEARCH_DIR)).isDirectory();
  } catch {
    /* ignore */
  }
  if (!isDir) {
    console.error(`${RED}Search directory not found: ${SEARCH_DIR}${NC}`);
    process.exit(2);
  }

  console.log(`${CYAN}=== saga selector-hygiene gate ===${NC}`);
  console.log(`Scanning: ${relative(ROOT, SEARCH_DIR) || '.'}/`);

  let total = 0;
  const lines = [];
  for await (const file of walk(SEARCH_DIR)) {
    let src;
    try {
      src = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    const rel = relative(ROOT, file);
    for (const v of findViolations(src, rel)) {
      total++;
      lines.push(
        `  ${YELLOW}${rel}:${v.line}${NC}  [${v.name}]  ${v.snippet}`,
      );
    }
  }

  console.log('');
  if (total > 0) {
    console.log(
      `${RED}[saga convention hygiene]${NC} — ${total} violation(s):`,
    );
    console.log('  Replace raw `yield* select(...)` reads with named selector `.effect(...)`.');
    console.log('  Pass action creators directly to watcher helpers instead of `.type`.');
    console.log('  See .agents/skills/redux-store/SKILL.md § "Sagas".');
    for (const line of lines) console.log(line);
    console.log('');
    console.log(`${RED}✗ Found ${total} saga selector-hygiene violation(s).${NC}`);
    process.exit(1);
  }
  console.log(`${CYAN}✓ No saga selector-hygiene violations found.${NC}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
