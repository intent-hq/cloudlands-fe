#!/usr/bin/env node
// check-dead-code.mjs — the knip dead-code gate (`pnpm run lint:dead-code`) with canaries.
//
// Materialises canary files under src/lib/components/__knip-canary__/ and runs knip twice
// with the JSON reporter:
//   1. Default pass (tests are entries): fails when either known-unused canary is NOT
//      reported — the gate has gone blind to unused files (cloudlands-fe#2695 found three
//      such masks that passed silently for months). Otherwise the remaining issues are
//      reported with knip's own exit semantics (error-level rules only).
//   2. Production pass (`--production`, tests are not entries): reports files and exports
//      that only tests use. A canary imported only by a test must be reported; findings
//      outside scripts/knip-production-baseline.json fail, and stale baseline entries fail
//      until `--prune-baseline` removes them (the baseline only shrinks).
// Missing generated modules (fresh worktree) stop the gate with the generate command to run,
// instead of a flood of unresolved-import errors.
// A per-worktree lock owns the canaries from creation through scan completion and cleanup.
// They are excluded in tsconfig.json so a concurrent type-check never sees them (TS6053).
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ALL_CANARY_FILES,
  CANARY_DIR,
  CANARY_PATHS,
  PRODUCTION_BASELINE_PATH,
  PRODUCTION_CANARY_PATHS,
  PRODUCTION_ISSUE_TYPES,
  compareToBaseline,
  decideExitCode,
  findMissingCanaries,
  findMissingGeneratedFiles,
  formatCanaryFailure,
  formatMissingGeneratedFiles,
  formatProductionCanaryFailure,
  parseKnipJson,
  parseKnipRules,
  parseProductionBaseline,
  productionIssueKeys,
  pruneBaseline,
  renderIssues,
  renderProductionResult,
  serializeProductionBaseline,
  stripCanaryIssues,
} from './check-dead-code-lib.mjs';
import { acquireVerificationLock, defaultLockPath, lockTimeout } from './verification-lock.mjs';

// CHECK_DEAD_CODE_ROOT is test-only: it lets the CLI regression tests run the real script
// against a throwaway fixture root instead of the live checkout.
const REPO_ROOT = realpathSync(
  process.env.CHECK_DEAD_CODE_ROOT ??
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'),
);
const canaryDir = path.join(REPO_ROOT, CANARY_DIR);
const lockKey = `dead-code:${REPO_ROOT}`;
let releaseLock;
let knipChild;
let interruptedExitCode;
let shutdownTimer;

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
  for (const file of ALL_CANARY_FILES) {
    writeFileSync(path.join(REPO_ROOT, file.path), file.content);
  }
}

function cleanup() {
  // A cancelled waiter has no ownership of the live scanner's canaries.
  if (!releaseLock) return;
  try {
    removeCanary();
  } finally {
    releaseLock();
    releaseLock = undefined;
  }
}

function closeCancelledOutput() {
  if (!knipChild || !interruptedExitCode) return;
  if (knipChild.exitCode === null && knipChild.signalCode === null) return;
  // A descendant can inherit these pipes. Once the cancelled scanner has exited,
  // its output is irrelevant; inherited handles must not keep execFile waiting.
  knipChild.stdout.destroy();
  knipChild.stderr.destroy();
}

for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => {
    const repeated = Boolean(interruptedExitCode);
    interruptedExitCode ??= 128 + (signal === 'SIGINT' ? 2 : signal === 'SIGTERM' ? 15 : 1);
    if (knipChild) {
      // Keep ownership until the scanner has stopped using the files.
      knipChild.kill(repeated ? 'SIGKILL' : signal);
      closeCancelledOutput();
      if (!repeated) {
        shutdownTimer = setTimeout(() => knipChild?.kill('SIGKILL'), 10_000);
        shutdownTimer.unref();
      }
    } else {
      process.exit(interruptedExitCode);
    }
  });
}
process.on('exit', cleanup);

function runKnip(extraArgs = []) {
  return new Promise((resolve, reject) => {
    knipChild = execFile(
      process.execPath,
      [
        resolveKnipBin(),
        '--config',
        fileURLToPath(new URL('./knip.config.js', import.meta.url)),
        '--reporter',
        'json',
        ...extraArgs,
      ],
      {
        cwd: REPO_ROOT,
        encoding: 'utf8',
        maxBuffer: 256 * 1024 * 1024,
      },
      (error, stdout) => {
        clearTimeout(shutdownTimer);
        knipChild = undefined;
        if (error && typeof error.code !== 'number' && !error.signal) reject(error);
        else resolve({ stdout, status: error?.code ?? 0, signal: error?.signal });
      },
    );
    knipChild.once('exit', closeCancelledOutput);
    knipChild.stdin.end();
    knipChild.stderr.pipe(process.stderr);
  });
}

function parseResult(result) {
  if (result.signal) {
    console.error(`knip was killed by ${result.signal}`);
    return { code: 1 };
  }
  try {
    return { issues: parseKnipJson(result.stdout) };
  } catch (error) {
    console.error(error.message);
    return { code: result.status || 1 };
  }
}

function checkDefault(result, rules) {
  const { issues, code } = parseResult(result);
  if (!issues) return code;
  const missing = findMissingCanaries(issues, CANARY_PATHS);
  if (missing.length > 0) {
    console.error(formatCanaryFailure(missing));
    return 1;
  }
  const remaining = stripCanaryIssues(issues, CANARY_DIR);
  console.log(renderIssues(remaining, rules));
  return decideExitCode(remaining, rules);
}

function checkProduction(result, { prune }) {
  const { issues, code } = parseResult(result);
  if (!issues) return code;
  const missing = findMissingCanaries(issues, PRODUCTION_CANARY_PATHS);
  if (missing.length > 0) {
    console.error(formatProductionCanaryFailure(missing));
    return 1;
  }
  const current = productionIssueKeys(stripCanaryIssues(issues, CANARY_DIR));
  const baselinePath = path.join(REPO_ROOT, PRODUCTION_BASELINE_PATH);
  let baseline = parseProductionBaseline(
    existsSync(baselinePath) ? readFileSync(baselinePath, 'utf8') : null,
  );
  if (prune) {
    const pruned = pruneBaseline(current, baseline);
    const before = serializeProductionBaseline(baseline);
    const after = serializeProductionBaseline(pruned);
    if (after !== before) {
      writeFileSync(baselinePath, after);
      console.log(
        `Pruned ${PRODUCTION_BASELINE_PATH}: ${baseline.size} → ${pruned.size} entr(ies).`,
      );
    }
    baseline = pruned;
  }
  const report = renderProductionResult(compareToBaseline(current, baseline));
  if (report) {
    console.log(report);
    return 1;
  }
  console.log(
    `knip --production: no new code used only by tests (${baseline.size} baselined finding(s)).`,
  );
  return 0;
}

async function main() {
  const missingGenerated = findMissingGeneratedFiles((file) =>
    existsSync(path.join(REPO_ROOT, file)),
  );
  if (missingGenerated.length > 0) {
    console.error(formatMissingGeneratedFiles(missingGenerated));
    return 1;
  }
  const prune = process.argv.includes('--prune-baseline');
  const rules = parseKnipRules(readFileSync(path.join(REPO_ROOT, 'knip.jsonc'), 'utf8'));
  releaseLock = await acquireVerificationLock({
    lockPath: defaultLockPath(lockKey),
    timeoutMs: lockTimeout(lockKey, process.env.VERIFY_CHANGED_LOCK_TIMEOUT_MS),
    cwd: REPO_ROOT,
  });
  let result;
  let production;
  try {
    writeCanary();
    result = await runKnip();
    if (!interruptedExitCode && !result.signal) {
      production = await runKnip(['--production', '--include', PRODUCTION_ISSUE_TYPES.join(',')]);
    }
  } finally {
    cleanup();
  }

  if (interruptedExitCode) return interruptedExitCode;
  const defaultCode = checkDefault(result, rules);
  if (!production) return defaultCode || 1;
  return Math.max(defaultCode, checkProduction(production, { prune }));
}

process.exitCode = await main();
