#!/usr/bin/env node
// check-dead-code.mjs — the knip dead-code gate (`pnpm run lint:dead-code`) with a canary.
//
// Materialises two known-unused canary files under src/lib/components/__knip-canary__/,
// runs knip once with the JSON reporter, and fails when either canary is NOT reported:
// that means the gate has gone blind to unused files (cloudlands-fe#2695 found three such
// masks that passed silently for months). Otherwise the canary rows are dropped and the
// remaining issues are reported with knip's own exit semantics (error-level rules only).
// The canary directory is removed on every exit path, including SIGINT/SIGTERM.
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CANARY_DIR,
  CANARY_FILES,
  CANARY_PATHS,
  decideExitCode,
  findMissingCanaries,
  formatCanaryFailure,
  parseKnipJson,
  parseKnipRules,
  renderIssues,
  stripCanaryIssues,
} from './check-dead-code-lib.mjs';

// CHECK_DEAD_CODE_ROOT is test-only: it lets the CLI regression tests run the real script
// against a throwaway fixture root instead of the live checkout.
const REPO_ROOT = process.env.CHECK_DEAD_CODE_ROOT
  ? path.resolve(process.env.CHECK_DEAD_CODE_ROOT)
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const canaryDir = path.join(REPO_ROOT, CANARY_DIR);

// knip's exports map does not expose package.json; walk up from its main entry
// (<pkg>/dist/index.js) to the package root and read `bin.knip` from there.
function resolveKnipBin() {
  const require = createRequire(import.meta.url);
  const pkgRoot = path.resolve(path.dirname(require.resolve('knip')), '..');
  const pkg = JSON.parse(readFileSync(path.join(pkgRoot, 'package.json'), 'utf8'));
  return path.join(pkgRoot, pkg.bin.knip);
}

function removeCanary() {
  rmSync(canaryDir, { recursive: true, force: true });
}

function writeCanary() {
  removeCanary();
  mkdirSync(canaryDir, { recursive: true });
  for (const file of CANARY_FILES) {
    writeFileSync(path.join(REPO_ROOT, file.path), file.content);
  }
}

for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => {
    removeCanary();
    process.exit(128 + (signal === 'SIGINT' ? 2 : signal === 'SIGTERM' ? 15 : 1));
  });
}

function runKnip() {
  const result = spawnSync(process.execPath, [resolveKnipBin(), '--reporter', 'json'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
    maxBuffer: 256 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  return result;
}

function main() {
  const rules = parseKnipRules(readFileSync(path.join(REPO_ROOT, 'knip.jsonc'), 'utf8'));
  let result;
  try {
    writeCanary();
    result = runKnip();
  } finally {
    removeCanary();
  }

  if (result.signal) {
    console.error(`knip was killed by ${result.signal}`);
    return 1;
  }
  let issues;
  try {
    issues = parseKnipJson(result.stdout);
  } catch (error) {
    console.error(error.message);
    return result.status || 1;
  }

  const missing = findMissingCanaries(issues, CANARY_PATHS);
  if (missing.length > 0) {
    console.error(formatCanaryFailure(missing));
    return 1;
  }

  const remaining = stripCanaryIssues(issues, CANARY_DIR);
  console.log(renderIssues(remaining, rules));
  return decideExitCode(remaining, rules);
}

process.exitCode = main();
