#!/usr/bin/env node
// auto-pin-merge-route.mjs — decide whether auto-pin-intentd.yml may merge its
// rolling sidecar pin PR directly (CI identity ruleset exemption) or must use
// the ordinary merge queue.
//
// The queue builds one entry at a time and an ordinary entry takes ~45 min, so
// a pin PR queued behind other PRs deferred the alpha cut for hours (pin
// PR #3535 waited 3+ h behind #3534). A plain pin bump already takes the CI
// fast path (release-pr-fast-path.mjs), so the queue adds no test signal for
// it — only wait. Direct merging is allowed ONLY when every guard holds:
//   1. The tested head is a full 40-char SHA.
//   2. CI Gate is green on exactly that head (read by the caller).
//   3. The head contains live main's tip. `--admin` bypasses the ruleset's
//      strict up-to-date rule, so this is checked here instead (intentd cron
//      run 39234998462 cut a release one commit behind main this way).
//   4. main-tip..head has the sidecar pin-bump shape (release-pr-fast-path
//      --pin-only): intentd.version plus the regenerated source-pin line,
//      regular modes, no protocol-version change. A protocol bump re-runs
//      every fake-hello test, so it keeps the queue.
// Anything else — including an unexpected error — routes to the queue. The
// caller merges with `--match-head-commit <head>` so a refreshed, unchecked
// head can never ride this decision.
//
// Usage: node scripts/auto-pin-merge-route.mjs --head <sha> --ci-gate <state>
//                                              [--remote origin] [--branch main]
//   <state> is the CI Gate summary for <head>: `success`, or anything else.
//   Run from the workflow's trusted checkout of main, never the PR head.
//
// Output contract (for CI):
//   - Prints `route=direct|queue` and `main_sha=<sha>` (GITHUB_OUTPUT lines,
//     main_sha empty when unread) and exits 0 whenever a decision was reached;
//     the reason is logged to stderr.
//   - Exits non-zero only on unexpected errors (fetch failure, unreadable
//     refs). Callers must treat a non-zero exit as `route=queue`.

import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluateFastPath } from './release-pr-fast-path.mjs';

const SHA_RE = /^[0-9a-f]{40}$/;

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function hasCommit(cwd, sha) {
  try {
    git(cwd, 'cat-file', '-e', `${sha}^{commit}`);
    return true;
  } catch {
    return false;
  }
}

function isAncestor(cwd, ancestor, descendant) {
  try {
    git(cwd, 'merge-base', '--is-ancestor', ancestor, descendant);
    return true;
  } catch (err) {
    // Exit 1 is git's "not an ancestor"; anything else is a real failure.
    if (err && typeof err === 'object' && 'status' in err && err.status === 1) return false;
    throw err;
  }
}

const queue = (reason, mainSha = '') => ({ route: 'queue', mainSha, reason });

/**
 * Decide the merge route for the rolling pin PR at `head`.
 * Returns { route: 'direct' | 'queue', mainSha, reason }.
 * Throws on unexpected errors (fetch failure, unreadable refs).
 */
export function decidePinMergeRoute({
  head,
  ciGate,
  cwd = process.cwd(),
  remote = 'origin',
  branch = 'main',
}) {
  if (typeof head !== 'string' || !SHA_RE.test(head)) {
    return queue(`tested head '${head}' is not a full commit SHA`);
  }
  if (ciGate !== 'success') {
    return queue(`CI Gate is not green on ${head} (state: ${ciGate || 'missing'})`);
  }

  try {
    git(cwd, 'fetch', '--quiet', '--no-tags', remote, branch);
  } catch (err) {
    throw new Error(
      `cannot fetch ${remote}/${branch}: ${err instanceof Error ? err.message : err}`,
      { cause: err },
    );
  }
  const mainSha = git(cwd, 'rev-parse', '--verify', 'FETCH_HEAD^{commit}').trim();
  if (!hasCommit(cwd, head)) {
    try {
      git(cwd, 'fetch', '--quiet', '--no-tags', remote, head);
    } catch (err) {
      throw new Error(
        `cannot fetch tested head ${head}: ${err instanceof Error ? err.message : err}`,
        { cause: err },
      );
    }
  }

  if (!isAncestor(cwd, mainSha, head)) {
    return queue(
      `tested head ${head} does not contain live ${remote}/${branch} (${mainSha})`,
      mainSha,
    );
  }

  const shape = evaluateFastPath(mainSha, head, cwd, { pinOnly: true });
  if (!shape.fastPath) {
    return queue(`diff is not a plain sidecar pin bump: ${shape.reason}`, mainSha);
  }
  return {
    route: 'direct',
    mainSha,
    reason: `plain sidecar pin bump on live ${remote}/${branch} (${mainSha}) with CI Gate green on ${head}`,
  };
}

function parseArgs(argv) {
  const opts = { remote: 'origin', branch: 'main' };
  const keys = {
    '--head': 'head',
    '--ci-gate': 'ciGate',
    '--remote': 'remote',
    '--branch': 'branch',
  };
  for (let i = 0; i < argv.length; i += 1) {
    const key = keys[argv[i]];
    const value = argv[i + 1];
    if (!key || value === undefined) return undefined;
    opts[key] = value;
    i += 1;
  }
  if (opts.head === undefined || opts.ciGate === undefined) return undefined;
  return opts;
}

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isDirectRun) {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts) {
    console.error(
      'usage: auto-pin-merge-route.mjs --head <sha> --ci-gate <state> [--remote origin] [--branch main]',
    );
    process.exit(2);
  }
  let result;
  try {
    result = decidePinMergeRoute(opts);
  } catch (err) {
    console.error(`error: ${err instanceof Error ? err.message : err}`);
    process.exit(2);
  }
  console.error(`auto-pin-merge-route: ${result.reason}`);
  console.log(`route=${result.route}`);
  console.log(`main_sha=${result.mainSha}`);
}
