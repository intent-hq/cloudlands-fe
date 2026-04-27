#!/usr/bin/env node
// check-saga-selector-hygiene.mjs — Grep-based gate for the saga-selector
// hygiene rule documented in `.agents/skills/redux-store/SKILL.md`
// § "State access in functions reached from sagas".
//
// Failure shape:
//   yield* select((s) => sel.select(s, …))
//
// The fix is the equivalent `yield* sel.effect(…)`, which produces the
// same SELECT effect under the hood while preserving expectSaga.provide()
// testability and avoiding stale-state reads.
//
// Why grep and not eslint: the violations are syntactically distinctive
// enough that a 30-line script catches them all without dragging the
// AST machinery into the repo.
//
// Usage:
//   node scripts/check-saga-selector-hygiene.mjs            # scans src/
//   node scripts/check-saga-selector-hygiene.mjs path/dir   # specific dir
//
// Exit codes: 0 = clean, 1 = violations found.

import { readFileSync } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';

const ROOT = process.cwd();
const SEARCH_DIR = resolve(ROOT, process.argv[2] ?? 'src');

const FILE_EXTS = new Set(['.ts', '.tsx', '.svelte', '.js', '.jsx', '.mjs']);
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

// Match the syntactic shape we want to forbid. Targets the exact pattern
// the Wave A1 task description calls out:
//
//   yield* select((s) => sel.select(s, …))
//
// The arrow body must be a `<selector>.select(s` call so we catch only the
// bug class (selector indirection) and not generic whole-state reads or
// `(state) => state.someSlice` shapes, which require a different kind of
// refactor to dedicated selectors.
const PATTERN = /yield\*\s*select\s*\(\s*\(\s*s\s*\)\s*=>\s*[\s\S]{0,80}?\.select\s*\(\s*s\b/g;

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
      const dot = entry.name.lastIndexOf('.');
      if (dot !== -1 && FILE_EXTS.has(entry.name.slice(dot))) yield full;
    }
  }
}

function findViolations(src) {
  const out = [];
  PATTERN.lastIndex = 0;
  let m;
  while ((m = PATTERN.exec(src)) !== null) {
    const line = src.slice(0, m.index).split('\n').length;
    out.push({ line, snippet: src.slice(m.index, m.index + 80).replace(/\n.*/s, '') });
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
    for (const v of findViolations(src)) {
      total++;
      lines.push(`  ${YELLOW}${rel}:${v.line}${NC}  ${v.snippet}`);
    }
  }

  console.log('');
  if (total > 0) {
    console.log(
      `${RED}[saga reads state via yield* select((s) => sel.select(s, ...))]${NC} — ${total} violation(s):`,
    );
    console.log('  Replace with `yield* sel.effect(...)` (see .agents/skills/redux-store/SKILL.md');
    console.log(
      '  § "State access in functions reached from sagas"). Same SELECT effect under the hood,',
    );
    console.log('  but keeps expectSaga.provide() and the rest of the saga machinery happy.');
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
