#!/usr/bin/env node
// check-node.mjs — the Node preflight every gate runs before anything else
// (via check-deps-fresh.mjs). An unsupported Node used to surface as a
// misleading vitest summary: hundreds of jsdom/undici worker-start errors next
// to a "passed" count. The supported range lives in package.json `engines.node`
// (the one hand-maintained copy; the monorepo bootstrap script parses it too),
// so this module resolves nothing from node_modules and understands exactly the
// grammar used there: `||`-separated clauses of `^X.Y.Z` or `>=X[.Y[.Z]]`.
import { readFileSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const REMEDIATION_HINT =
  'from the monorepo root run: make doctor, then make bootstrap-dev-host';

function parseVersion(text) {
  const match = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:[-+].*)?$/.exec(String(text).trim());
  if (!match) throw new Error(`invalid Node version "${text}"`);
  return [Number(match[1]), Number(match[2] ?? 0), Number(match[3] ?? 0)];
}

function compareVersions(a, b) {
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] < b[index] ? -1 : 1;
  }
  return 0;
}

function parseClause(clause) {
  const caret = /^\^(\d+\.\d+\.\d+)$/.exec(clause);
  if (caret) {
    const floor = parseVersion(caret[1]);
    return (version) => version[0] === floor[0] && compareVersions(version, floor) >= 0;
  }
  const atLeast = /^>=\s*(\d+(?:\.\d+){0,2})$/.exec(clause);
  if (atLeast) {
    const floor = parseVersion(atLeast[1]);
    return (version) => compareVersions(version, floor) >= 0;
  }
  throw new Error(`unsupported engines.node clause "${clause}" (expected ^X.Y.Z or >=X[.Y[.Z]])`);
}

/**
 * Pure check of a Node version against an `engines.node` range written in the
 * `^X.Y.Z || >=X` grammar. Every clause is parsed before any is evaluated, so a
 * typo anywhere in package.json fails loudly instead of being masked by an
 * earlier clause that happens to match.
 */
export function satisfiesNodeRange(version, range) {
  const clauses = String(range)
    .split('||')
    .map((clause) => clause.trim())
    .filter(Boolean);
  if (clauses.length === 0) throw new Error('engines.node range is empty');
  const predicates = clauses.map(parseClause);
  const parsed = parseVersion(version);
  return predicates.some((predicate) => predicate(parsed));
}

/** The `engines.node` range declared by the package at `root`. */
export function readNodeRange(root = REPO_ROOT) {
  const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const range = packageJson?.engines?.node;
  if (typeof range !== 'string' || range.trim() === '') {
    throw new Error('package.json declares no engines.node range');
  }
  return range;
}

export function unsupportedNodeMessage(version, range) {
  return `Unsupported Node v${version} — cloudlands-fe requires Node ${range} (${REMEDIATION_HINT}).`;
}

/**
 * Compare the running (or given) Node against the package's `engines.node`.
 * Returns the same `{ ok, reason }` shape as `checkDepsFresh` so gates report
 * both preflights alike; `reason` is the single line to print on failure.
 */
export function checkNodeSupport({ root = REPO_ROOT, version = process.versions.node } = {}) {
  const range = readNodeRange(root);
  const normalized = String(version).replace(/^v/, '');
  if (satisfiesNodeRange(normalized, range)) {
    return { ok: true, version: normalized, range, reason: null };
  }
  return {
    ok: false,
    version: normalized,
    range,
    reason: unsupportedNodeMessage(normalized, range),
  };
}

const isDirectRun =
  process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
if (isDirectRun) {
  try {
    const node = checkNodeSupport();
    if (!node.ok) {
      console.error(node.reason);
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(`[node:check] ${error instanceof Error ? error.message : error}`);
    process.exitCode = 1;
  }
}
