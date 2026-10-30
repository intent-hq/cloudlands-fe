#!/usr/bin/env node
// rolling-pr.mjs — find the release automation's own open rolling PR on a
// branch (e.g. `auto/intentd-pin`) for auto-pin-intentd.yml and
// auto-cut-alpha.yml.
//
// `gh pr list --head <branch>` also returns FORK PRs whose branch merely has
// the same name, so picking `.[0]` blindly lets a fork PR be edited, merged,
// or used to pause/defer the release train. Only a PR whose head lives in this
// repository AND that was opened by the release token's own login (the
// identity the workflows push and open the PR with) qualifies. The workflows
// used to repeat this filter inline four times; this is the one tested copy.
//
// Usage: node scripts/rolling-pr.mjs --repo <owner/name> --branch <name>
//                                    [--viewer <login>]
//   Without --viewer the login is read with `gh api user`, so GH_TOKEN must be
//   the release token. Pass --viewer when GH_TOKEN is a different token (the
//   implicit GITHUB_TOKEN cannot read `user`).
//
// Output contract (GITHUB_OUTPUT lines, exit 0):
//   number=<PR number, empty when there is none>
//   hold_release=<true when that PR carries the hold-release label, else false>
// Exits 1 when gh fails, its output is not the expected JSON, or the login is
// empty — callers keep their own fail-open / fail-closed handling. Exits 2 on
// a usage error.

import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const HOLD_RELEASE_LABEL = 'hold-release';

/** Run gh and return stdout; throws on a non-zero exit. */
function runGh(args) {
  return execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
}

/**
 * Pick the rolling PR from `gh pr list` JSON. Exported for tests; prefer
 * findRollingPr, which also performs the lookups.
 *
 * @param {unknown} prs parsed `gh pr list --json number,headRefName,isCrossRepository,author,labels`
 * @param {{ branch: string, viewer: string }} options
 * @returns {{ number: number | null, holdRelease: boolean }}
 */
export function selectRollingPr(prs, { branch, viewer }) {
  if (!Array.isArray(prs)) throw new Error('gh pr list did not return a JSON array');
  if (!viewer) throw new Error('release token login is empty');
  const match = prs.find(
    (pr) =>
      pr !== null &&
      typeof pr === 'object' &&
      pr.isCrossRepository === false &&
      pr.headRefName === branch &&
      pr.author?.login === viewer,
  );
  if (!match) return { number: null, holdRelease: false };
  if (!Number.isInteger(match.number) || match.number <= 0) {
    throw new Error(`rolling PR has an invalid number: ${JSON.stringify(match.number)}`);
  }
  const labels = Array.isArray(match.labels) ? match.labels : [];
  return {
    number: match.number,
    holdRelease: labels.some((label) => label?.name === HOLD_RELEASE_LABEL),
  };
}

/**
 * Find the open same-repo rolling PR on `branch` authored by `viewer` (or by
 * the gh token's own login when `viewer` is omitted).
 *
 * @param {{ repo: string, branch: string, viewer?: string, gh?: (args: string[]) => string }} options
 * @returns {{ number: number | null, holdRelease: boolean, viewer: string }}
 */
export function findRollingPr({ repo, branch, viewer, gh = runGh }) {
  const login = viewer || gh(['api', 'user', '--jq', '.login']).trim();
  if (!login) throw new Error('could not resolve the release token login');
  const raw = gh([
    'pr',
    'list',
    '--repo',
    repo,
    '--head',
    branch,
    '--state',
    'open',
    '--json',
    'number,headRefName,isCrossRepository,author,labels',
  ]);
  let prs;
  try {
    prs = JSON.parse(raw);
  } catch {
    throw new Error('gh pr list returned output that is not JSON');
  }
  return { ...selectRollingPr(prs, { branch, viewer: login }), viewer: login };
}

function parseArgs(argv) {
  const opts = {};
  const keys = { '--repo': 'repo', '--branch': 'branch', '--viewer': 'viewer' };
  for (let i = 0; i < argv.length; i += 2) {
    const key = keys[argv[i]];
    const value = argv[i + 1];
    if (!key || value === undefined || opts[key] !== undefined) return undefined;
    opts[key] = value;
  }
  if (!/^[\w.-]+\/[\w.-]+$/.test(opts.repo ?? '') || !opts.branch) return undefined;
  if (opts.viewer === '') return undefined;
  return opts;
}

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isDirectRun) {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts) {
    console.error('usage: rolling-pr.mjs --repo <owner/name> --branch <name> [--viewer <login>]');
    process.exit(2);
  }
  let result;
  try {
    result = findRollingPr(opts);
  } catch (err) {
    console.error(`rolling-pr: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }
  console.error(
    result.number === null
      ? `rolling-pr: no open same-repo PR on ${opts.branch} by ${result.viewer}`
      : `rolling-pr: PR #${result.number} on ${opts.branch} by ${result.viewer}`,
  );
  console.log(`number=${result.number ?? ''}`);
  console.log(`hold_release=${result.holdRelease}`);
}
