#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';

const ROOT = process.cwd();
const SEARCH_DIR = resolve(ROOT, process.argv[2] ?? 'src/store');
const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  'build',
  '.svelte-kit',
  '.git',
  'cdp-mcp-server',
  'parallel-runner',
]);
const NONDET_RE =
  /\b(?:Date\.now|Math\.random|crypto\.randomUUID|randomUUID)\s*\(|\bnew\s+Date\s*\(\s*\)/g;

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
      if (!SKIP_DIRS.has(entry.name)) yield* walk(full);
    } else if (entry.isFile() && /-slice\.ts$/.test(entry.name) && !/\.test\./.test(entry.name)) {
      yield full;
    }
  }
}

function lineFor(src, index) {
  return src.slice(0, index).split('\n').length;
}

function stripComments(src) {
  let out = '';
  for (let i = 0; i < src.length; ) {
    if (src[i] === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') {
        out += ' ';
        i++;
      }
    } else if (src[i] === '/' && src[i + 1] === '*') {
      out += '  ';
      i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) {
        out += src[i] === '\n' ? '\n' : ' ';
        i++;
      }
      if (i < src.length) {
        out += '  ';
        i += 2;
      }
    } else {
      out += src[i++];
    }
  }
  return out;
}

function findCallEnd(src, openParenIndex) {
  let depth = 0;
  let quote = null;
  for (let i = openParenIndex; i < src.length; i++) {
    const c = src[i];
    const prev = src[i - 1];
    if (quote) {
      if (c === '\\') {
        i++;
        continue;
      }
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

function createActionSpans(src) {
  const spans = [];
  const re = /createAction\s*\(/g;
  let match;
  while ((match = re.exec(src)) !== null) {
    const open = src.indexOf('(', match.index);
    const end = findCallEnd(src, open);
    if (end !== -1) spans.push([match.index, end + 1]);
  }
  return spans;
}

function reducerBodySpans(src) {
  const spans = [];
  const re = /(?:export\s+const|const)\s+\w*Reducer\s*=\s*createReducer\s*(?:<[^>]+>)?\s*\(/g;
  let match;
  while ((match = re.exec(src)) !== null) {
    spans.push([match.index, src.length]);
  }
  return spans;
}

function reducerHelperSpans(src) {
  const spans = [];
  const marker = src.indexOf('Internal Helpers (pure functions used by reducer)');
  if (marker === -1) return spans;
  const reducerMarker = src.indexOf('Reducer', marker + 1);
  spans.push([marker, reducerMarker === -1 ? src.length : reducerMarker]);
  return spans;
}

function isInSpan(index, spans) {
  return spans.some(([start, end]) => index >= start && index <= end);
}

function scanFile(absPath) {
  const src = readFileSync(absPath, 'utf8');
  const stripped = stripComments(src);
  const actionSpans = createActionSpans(stripped);
  const scanSpans = [...reducerHelperSpans(stripped), ...reducerBodySpans(stripped)];
  if (scanSpans.length === 0) return [];
  const violations = [];
  for (const [start, end] of scanSpans) {
    NONDET_RE.lastIndex = start;
    let match;
    while ((match = NONDET_RE.exec(stripped)) !== null && match.index <= end) {
      if (isInSpan(match.index, actionSpans)) continue;
      const line = lineFor(src, match.index);
      violations.push({ line, text: src.split('\n')[line - 1].trim() });
    }
  }
  return violations;
}

const violations = [];
for await (const file of walk(SEARCH_DIR)) {
  const rel = relative(ROOT, file).split('\\').join('/');
  for (const violation of scanFile(file)) violations.push({ file: rel, ...violation });
}

if (violations.length) {
  console.error('\nReducer nondeterminism violations found:');
  for (const v of violations) console.error(`  ${v.file}:${v.line} ${v.text}`);
  console.error(
    '\nMove timestamps/random IDs into action payload modifiers or sagas before dispatch.',
  );
  process.exit(1);
}

console.log('✓ No reducer nondeterminism violations found.');
