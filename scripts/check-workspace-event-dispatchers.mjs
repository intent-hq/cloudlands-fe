#!/usr/bin/env node
// check-workspace-event-dispatchers.mjs — Grep-based gate for the
// cross-workspace dispatch bug class (Wave 1 follow-up).
//
// Four failure shapes:
//   1. Raw CustomEvent for a protected workspace:* event name, e.g.:
//        new CustomEvent('workspace:open-file', { detail: ... })
//      The dispatcher must go through dispatchWindowEvent() so the
//      typed overloads can enforce the WorkspaceOpen*Detail shape.
//   2. dispatchWindowEvent('workspace:<protected>', { ... }) where the
//      inline detail object literal does NOT include `workspaceId`.
//      The TypeScript generic-fallback overload in window-events.ts
//      (lines 207-213) accepts arbitrary detail shapes, so this bug
//      class is not caught by tsc today.
//   3. Raw CustomEvent for a protected dynamic-name prefix, e.g.:
//        new CustomEvent(`agent:stream:${id}`, { detail: ... })
//      These must go through the typed wrapper (dispatchAgentStream)
//      so the AgentStreamDetail contract is enforced. Multi-line
//      construction (backtick template, args on separate lines) is
//      caught — the gate matches across newlines.
//   4. `window.dispatchEvent(new CustomEvent(...))` (inline OR multi-line)
//      for any event name in non-test, non-allowlisted source files
//      (Wave 2a hygiene tightening): all dispatchers must go through
//      dispatchWindowEvent() so the WindowEventName union and per-event
//      typed overloads can enforce the channel-name and detail-shape
//      contracts at compile time.
//
// Defensive rule: if the detail literal contains `...` (spread), it
// PASSES — workspaceId may be supplied via the spread source.
//
// Usage:
//   node scripts/check-workspace-event-dispatchers.mjs            # scans src/
//   node scripts/check-workspace-event-dispatchers.mjs path/dir   # specific dir
//
// Exit codes: 0 = clean, 1 = violations found.

import { readFileSync } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';

const ROOT = process.cwd();
const SEARCH_DIR = resolve(ROOT, process.argv[2] ?? 'src');

const PROTECTED_NAMES = [
  'workspace:new-terminal',
];
const PROTECTED_SUFFIXES = PROTECTED_NAMES.map((n) => n.slice('workspace:'.length));
const PROTECTED_RE = new RegExp(`^workspace:(?:${PROTECTED_SUFFIXES.join('|')})$`);

// Dynamic-name channel prefixes that must dispatch through a typed wrapper
// (e.g. dispatchAgentStream) instead of raw `new CustomEvent(`prefix:${id}`)`.
// Allowlist: window-events.ts itself implements the typed wrapper and is the
// only legitimate site of raw CustomEvent for these prefixes.
const PROTECTED_DYNAMIC_PREFIXES = ['agent:stream:'];
const DYNAMIC_PREFIX_ALLOWLIST = new Set([
  'src/lib/utils/window-events.ts',
]);

const FILE_EXTS = new Set(['.ts', '.tsx', '.svelte', '.js', '.jsx', '.mjs']);
const SKIP_DIRS = new Set([
  'node_modules', 'dist', 'build', '.svelte-kit', '.git',
  'cdp-mcp-server', 'parallel-runner', 'playwright-report',
]);

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

function isTestFile(relPath) {
  return (
    relPath.includes('/__tests__/') ||
    relPath.includes('\\__tests__\\') ||
    /\.test\.[mc]?[jt]sx?$/.test(relPath) ||
    /\.spec\.[mc]?[jt]sx?$/.test(relPath)
  );
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function findRawCustomEvent(src, relPath) {
  const out = [];
  // Match the channel-name argument of `new CustomEvent(...)`, allowing single
  // quote, double quote, or backtick (template literal). The inner-content
  // class uses `[^]` (not `.`) so multi-line template literals and multi-line
  // construction (e.g. `new CustomEvent(\n  `prefix:${id}`,\n  { ... })`) are
  // caught — `.` would stop at the first newline.
  const re = /new\s+CustomEvent\s*\(\s*(['"`])((?:\\[^]|(?!\1)[^])*)\1/g;
  const isAllowlisted = DYNAMIC_PREFIX_ALLOWLIST.has(relPath);
  // Tests legitimately dispatch raw events to simulate wire-level traffic into
  // listeners under test; only the workspace:* contract (which has a tighter
  // detail shape) is enforced there.
  const checkDynamicPrefixes = !isAllowlisted && !isTestFile(relPath);
  let m;
  while ((m = re.exec(src)) !== null) {
    const name = m[2];
    let matched = PROTECTED_RE.test(name);
    if (!matched && checkDynamicPrefixes) {
      for (const prefix of PROTECTED_DYNAMIC_PREFIXES) {
        if (name.startsWith(prefix)) { matched = true; break; }
      }
    }
    if (!matched) continue;
    const line = src.slice(0, m.index).split('\n').length;
    out.push({ line, name });
  }
  return out;
}

// Catch the variable-aliased dispatch shape:
//   const eventName = `agent:stream:${id}`;
//   window.dispatchEvent(new CustomEvent(eventName, ...));
// or
//   const event = new CustomEvent(eventName, ...);
//   window.dispatchEvent(event);
// The inline-template form is already covered by findRawCustomEvent. This
// function tracks variables tainted by a protected-prefix template literal
// and flags any `new CustomEvent(<taintedVar>, ...)` use of them.
function findRawCustomEventViaVariable(src, relPath) {
  if (DYNAMIC_PREFIX_ALLOWLIST.has(relPath)) return [];
  if (isTestFile(relPath)) return [];
  const out = [];
  const prefixesAlt = PROTECTED_DYNAMIC_PREFIXES.map(escapeRegex).join('|');
  const assignRe = new RegExp(
    `(?:const|let|var)\\s+(\\w+)\\s*=\\s*\`(?:${prefixesAlt})`,
    'g',
  );
  const taintedVars = new Set();
  let a;
  while ((a = assignRe.exec(src)) !== null) {
    taintedVars.add(a[1]);
  }
  if (taintedVars.size === 0) return [];
  for (const varName of taintedVars) {
    const useRe = new RegExp(
      `new\\s+CustomEvent\\s*\\(\\s*${escapeRegex(varName)}\\b`,
      'g',
    );
    let u;
    while ((u = useRe.exec(src)) !== null) {
      const line = src.slice(0, u.index).split('\n').length;
      out.push({ line, name: `<via var \`${varName}\`>` });
    }
  }
  return out;
}

function extractBalancedObject(src, startIdx) {
  // Returns the substring from src[startIdx] (which must be `{`) through the
  // matching `}`, accounting for nested braces, strings, template literals,
  // and line/block comments. Returns null if unbalanced.
  if (src[startIdx] !== '{') return null;
  let i = startIdx;
  let depth = 0;
  let inStr = null;          // ' " or `
  let templateDepth = 0;     // for ${...} inside template literals
  while (i < src.length) {
    const c = src[i];
    const next = src[i + 1];
    if (inStr) {
      if (c === '\\') { i += 2; continue; }
      if (inStr === '`' && c === '$' && next === '{') {
        templateDepth++; i += 2; depth++; continue;
      }
      if (c === inStr) inStr = null;
      i++; continue;
    }
    if (c === '/' && next === '/') {
      while (i < src.length && src[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && next === '*') {
      i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++;
      i += 2; continue;
    }
    if (c === '"' || c === "'" || c === '`') { inStr = c; i++; continue; }
    if (c === '{') { depth++; i++; continue; }
    if (c === '}') {
      depth--;
      if (depth === 0) return src.slice(startIdx, i + 1);
      i++; continue;
    }
    i++;
  }
  return null;
}

// Wave 2a hygiene tightening: flag any `window.dispatchEvent(new
// CustomEvent(...))` for ANY event name in non-test, non-allowlisted source
// files. The wrapper home (window-events.ts) is allowlisted because it owns
// the only legitimate raw `window.dispatchEvent(new CustomEvent(...))` calls.
// Tests are skipped because they legitimately simulate wire-level events into
// listeners under test. The Wave 2a continuation broadens the regex to match
// across newlines (`[\s]*` instead of `[ \t]*`) so multi-line construction
// (e.g. `window.dispatchEvent(\n  new CustomEvent(...))`) is also caught.
function findInlineRawDispatch(src, relPath) {
  if (DYNAMIC_PREFIX_ALLOWLIST.has(relPath)) return [];
  if (isTestFile(relPath)) return [];
  const out = [];
  const re = /window\.dispatchEvent\(\s*new\s+CustomEvent\b/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    const line = src.slice(0, m.index).split('\n').length;
    out.push({ line });
  }
  return out;
}

function findDispatchMissingWorkspaceId(src) {
  const out = [];
  const re = /dispatchWindowEvent\s*\(\s*['"](workspace:[a-z-]+)['"]\s*,/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    const name = m[1];
    if (!PROTECTED_RE.test(name)) continue;
    let i = re.lastIndex;
    while (i < src.length && /\s/.test(src[i])) i++;
    if (src[i] !== '{') continue; // non-literal detail (variable, etc.) — skip
    const detail = extractBalancedObject(src, i);
    if (detail === null) continue;
    if (detail.includes('...')) continue; // defensive: spread may carry workspaceId
    const hasIdentKey = /\bworkspaceId\b\s*[,:}]/.test(detail);
    const hasStringKey = /['"]workspaceId['"]\s*:/.test(detail);
    if (hasIdentKey || hasStringKey) continue;
    const line = src.slice(0, m.index).split('\n').length;
    out.push({ line, name });
  }
  return out;
}

const RED = '\x1b[0;31m';
const YELLOW = '\x1b[0;33m';
const CYAN = '\x1b[0;36m';
const NC = '\x1b[0m';

async function main() {
  let isDir = false;
  try { isDir = (await stat(SEARCH_DIR)).isDirectory(); } catch { /* ignore */ }
  if (!isDir) {
    console.error(`${RED}Search directory not found: ${SEARCH_DIR}${NC}`);
    process.exit(2);
  }

  console.log(`${CYAN}=== workspace:* event dispatcher gate ===${NC}`);
  console.log(`Scanning: ${relative(ROOT, SEARCH_DIR) || '.'}/`);

  let rawCount = 0;
  let missingCount = 0;
  let inlineCount = 0;
  const rawLines = [];
  const missingLines = [];
  const inlineLines = [];

  for await (const file of walk(SEARCH_DIR)) {
    let src;
    try { src = readFileSync(file, 'utf8'); } catch { continue; }
    const rel = relative(ROOT, file);
    for (const v of findRawCustomEvent(src, rel)) {
      rawCount++;
      rawLines.push(`  ${YELLOW}${rel}:${v.line}${NC}  new CustomEvent('${v.name}', ...)`);
    }
    for (const v of findRawCustomEventViaVariable(src, rel)) {
      rawCount++;
      rawLines.push(`  ${YELLOW}${rel}:${v.line}${NC}  new CustomEvent(${v.name}, ...)`);
    }
    for (const v of findInlineRawDispatch(src, rel)) {
      inlineCount++;
      inlineLines.push(`  ${YELLOW}${rel}:${v.line}${NC}  window.dispatchEvent(new CustomEvent(...))`);
    }
    for (const v of findDispatchMissingWorkspaceId(src)) {
      missingCount++;
      missingLines.push(`  ${YELLOW}${rel}:${v.line}${NC}  dispatchWindowEvent('${v.name}', { ... }) — missing workspaceId`);
    }
  }

  if (rawCount > 0) {
    console.log(`\n${RED}[Raw CustomEvent for protected event]${NC} — ${rawCount} violation(s):`);
    console.log('  Use dispatchWindowEvent(...) (workspace:*) or dispatchAgentStream(...) (agent:stream:*)');
    console.log('  so the typed wrapper enforces the detail-object contract.');
    for (const line of rawLines) console.log(line);
  }
  if (inlineCount > 0) {
    console.log(`\n${RED}[Inline raw window.dispatchEvent(new CustomEvent(...))]${NC} — ${inlineCount} violation(s):`);
    console.log('  Use dispatchWindowEvent(eventName, detail?) so the WindowEventName union and');
    console.log('  per-event typed overloads enforce the channel-name and detail-shape contracts.');
    for (const line of inlineLines) console.log(line);
  }
  if (missingCount > 0) {
    console.log(`\n${RED}[dispatchWindowEvent missing workspaceId]${NC} — ${missingCount} violation(s):`);
    console.log('  The detail object literal must include `workspaceId` (or a `...` spread that carries it).');
    for (const line of missingLines) console.log(line);
  }

  const total = rawCount + missingCount + inlineCount;
  console.log('');
  if (total > 0) {
    console.log(`${RED}✗ Found ${total} dispatcher violation(s).${NC}`);
    process.exit(1);
  }
  console.log(`${CYAN}✓ No dispatcher violations found.${NC}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});

