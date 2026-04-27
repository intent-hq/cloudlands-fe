#!/usr/bin/env node
// check-saga-adapter-bypass.mjs — Lint gate that prevents saga code from
// reintroducing dependencies on `panel-layout-adapter`.
//
// Background: Wave A2/A3 of the panel-layout-adapter migration converted
// every saga that previously called `getPanelLayoutManager(wsId).foo(...)`
// or `hasPanelLayoutManager(wsId)` into direct `put(action(...))` /
// selector `effect(...)` use. The adapter still exists for legacy
// component callers, but new saga code must dispatch actions and read
// state via selectors.
//
// This gate flags any import of `panel-layout-adapter` (or direct use of
// `getPanelLayoutManager` / `hasPanelLayoutManager`) inside a saga file
// under `src/lib/store/slices/**/sagas/**`. Test files (`*.test.ts`) are
// excluded so historical mocks can be cleaned up incrementally.
//
// Usage:
//   node scripts/check-saga-adapter-bypass.mjs            # scans src/
//   node scripts/check-saga-adapter-bypass.mjs path/dir   # specific dir
//
// Exit codes: 0 = clean, 1 = violations found.

import { readFileSync } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
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

// Saga files only: live under `<...>/sagas/<...>` and end in .ts but not .test.ts.
function isSagaFile(absPath) {
  const norm = absPath.split('\\').join('/');
  if (!norm.includes('/sagas/')) return false;
  if (!norm.endsWith('.ts')) return false;
  if (norm.endsWith('.test.ts')) return false;
  return true;
}

// Patterns to forbid in saga files. We target the layout-manager
// indirection specifically (the helpers that hand out a `PanelLayoutAdapter`
// instance), not unrelated utilities exported from the same module
// (e.g. `clearPanelLayoutAdapter` for cache cleanup).
const PATTERNS = [
  {
    name: 'getPanelLayoutManager use',
    re: /\bgetPanelLayoutManager\b/g,
  },
  {
    name: 'hasPanelLayoutManager use',
    re: /\bhasPanelLayoutManager\b/g,
  },
  {
    name: 'PanelLayoutAdapter use',
    re: /\bPanelLayoutAdapter\b/g,
  },
];

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

// Replace `//` and `/* */` comments with spaces (preserving newlines/length so
// line numbers and offsets stay accurate) before pattern matching, so that
// references inside doc comments (e.g. "Clean up PanelLayoutAdapter Map…")
// don't trigger the gate.
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

function findViolations(src) {
  const stripped = stripComments(src);
  const out = [];
  for (const { name, re } of PATTERNS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(stripped)) !== null) {
      const line = stripped.slice(0, m.index).split('\n').length;
      const snippet = src.slice(m.index, m.index + 80).replace(/\n.*/s, '');
      out.push({ name, line, snippet });
    }
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

  console.log(`${CYAN}=== saga panel-layout-adapter bypass gate ===${NC}`);
  console.log(`Scanning: ${relative(ROOT, SEARCH_DIR) || '.'}/  (sagas only, *.test.ts excluded)`);

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
    for (const v of findViolations(src)) {
      total++;
      lines.push(`  ${YELLOW}${rel}:${v.line}${NC}  [${v.name}]  ${v.snippet}`);
    }
  }

  console.log('');
  if (total > 0) {
    console.log(
      `${RED}[saga uses panel-layout-adapter]${NC} — ${total} violation(s):`,
    );
    console.log('  Sagas must dispatch panel-layout actions directly via `yield* put(action(...))`');
    console.log('  and read panel-layout state via selector effects (e.g. `yield* selectPanels.effect(wsId)`).');
    console.log('  Do not import or call PanelLayoutAdapter helpers from saga code.');
    for (const line of lines) console.log(line);
    console.log('');
    console.log(`${RED}✗ Found ${total} saga adapter-bypass violation(s).${NC}`);
    process.exit(1);
  }
  console.log(`${CYAN}✓ No saga adapter-bypass violations found.${NC}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});

