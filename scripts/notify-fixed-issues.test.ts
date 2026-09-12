// @verify-changed-triggers: scripts/notify-fixed-issues.sh

/**
 * Regression tests for scripts/notify-fixed-issues.sh: runs the real script in
 * --dry-run against a stubbed `gh` (no network, no credentials) and a
 * throwaway git repo, and asserts which issues it would comment on. Guards
 * the completeness gate: a mention-only reference (the range names an issue
 * that has no delivered linked closing PR) and a still-open issue must never
 * produce a comment, while a closed issue whose linked fix PR is merged and
 * contained in the released fe tag / bundled intentd tag does.
 *
 * Every scenario references two issues in the same range: #10 varies per
 * scenario and #11 is a fixed positive control (closed, delivered fix PR), so
 * a "no comment on #10" assertion is never satisfied by a run that posts
 * nothing at all.
 *
 * The linked-PR enumeration is stubbed at the `gh api graphql` boundary with
 * raw GraphQL response bodies, and the stub applies the script's own `--jq`
 * projection to them with the `jq` CLI (required on PATH), so a renamed field
 * or wrong path in that projection breaks these scenarios instead of silently
 * changing what gets posted.
 */
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const SCRIPT = resolve(process.cwd(), 'scripts/notify-fixed-issues.sh');
const SOURCE_REPO = 'intent-hq/cloudlands-fe';
const INTENTD_REPO = 'intent-hq/intentd';
const FE_TAG = 'v2.150.0';
const INTENTD_TAG = 'v1.2.3';
const CONTAINED_FE_SHA = 'a'.repeat(40);
const CONTAINED_INTENTD_SHA = 'b'.repeat(40);
const OUTSIDE_INTENTD_SHA = 'c'.repeat(40);
const WOULD_COMMENT_10 = '--- would comment on intent-hq/intent#10: ---';
const WOULD_COMMENT_11 = '--- would comment on intent-hq/intent#11: ---';
const EXPECTED_MESSAGE = 'This fix is included in cloudlands-fe v2.150.0 (bundles intentd v1.2.3).';
const EXPECTED_MARKER = '<!-- release-notifier: cloudlands-fe v2.150.0 -->';

// Stub gh:
//   api repos/*/pulls?...           -> the token-visibility probe; succeeds
//   api graphql -F number=N --jq F  -> like the real gh: applies the script's
//                                      filter F with `jq -r` to the raw GraphQL
//                                      response body in $STUB_ISSUES_DIR/N.json;
//                                      a missing file fails the call like an
//                                      API error would, and a call without
//                                      --jq fails loudly (the fixtures are
//                                      never served unprojected)
//   api repos/*/compare/T...S       -> $STUB_COMPARE_DIR/T...S verbatim (what
//                                      the call's `--jq .status` would leave);
//                                      missing => API error
//   api repos/*/issues/N/comments   -> no existing comments
// Anything else (pr view, issue comment, ...) fails loudly: the fixture range
// has no "(#N)" subjects, and a dry-run must never post.
const STUB_GH = [
  '#!/usr/bin/env bash',
  'set -euo pipefail',
  'case "$1 ${2:-}" in',
  '  "api graphql")',
  '    number="" filter=""',
  '    while (($#)); do',
  '      case "$1" in',
  '        number=*) number="${1#number=}" ;;',
  '        --jq) shift; filter="${1:-}" ;;',
  '        --jq=*) filter="${1#--jq=}" ;;',
  '      esac',
  '      shift',
  '    done',
  '    [[ -n "$number" ]] || { echo "stub gh: api graphql without -F number=N: $*" >&2; exit 1; }',
  '    if [[ -z "$filter" ]]; then',
  '      echo "stub gh: api graphql without --jq; the stub only serves fixtures through the script\'s projection" >&2',
  '      exit 1',
  '    fi',
  '    jq -r "$filter" "$STUB_ISSUES_DIR/$number.json"',
  '    ;;',
  '  "api repos/"*"/pulls?"*) ;;',
  '  "api repos/"*"/compare/"*)',
  '    cat "$STUB_COMPARE_DIR/${2##*/compare/}"',
  '    ;;',
  '  "api repos/"*"/issues/"*"/comments") ;;',
  '  *)',
  '    echo "stub gh: unhandled: $*" >&2',
  '    exit 1',
  '    ;;',
  'esac',
  '',
].join('\n');

interface LinkedPr {
  repo: string;
  number: number;
  state: 'OPEN' | 'MERGED' | 'CLOSED';
  sha?: string;
}

let root: string;
let repo: string;
let issuesDir: string;
let compareDir: string;
let env: NodeJS.ProcessEnv;

function git(...args: string[]) {
  const result = spawnSync(
    'git',
    [
      '-c',
      'user.name=test',
      '-c',
      'user.email=test@example.com',
      '-c',
      'commit.gpgsign=false',
      ...args,
    ],
    { cwd: repo, encoding: 'utf8' },
  );
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
  return result.stdout.trim();
}

// Writes the raw GraphQL response body for issue `n` in the shape GitHub
// returns for the script's gate query: the issue state, pageInfo.hasNextPage
// (false unless given), and one closedByPullRequestsReferences node per
// linked PR (`merged` follows from state; `mergeCommit` is null unless a sha
// is given).
function fixture(
  n: number,
  state: 'OPEN' | 'CLOSED',
  linked: LinkedPr[] = [],
  { hasNextPage = false }: { hasNextPage?: boolean } = {},
) {
  const nodes = linked.map((pr) => ({
    number: pr.number,
    state: pr.state,
    merged: pr.state === 'MERGED',
    mergeCommit: pr.sha === undefined ? null : { oid: pr.sha },
    repository: { nameWithOwner: pr.repo },
  }));
  const body = {
    data: {
      repository: {
        issue: {
          state,
          closedByPullRequestsReferences: { pageInfo: { hasNextPage }, nodes },
        },
      },
    },
  };
  writeFileSync(join(issuesDir, `${n}.json`), `${JSON.stringify(body)}\n`);
}

function compareStatus(tag: string, sha: string, status: string) {
  writeFileSync(join(compareDir, `${tag}...${sha}`), `${status}\n`);
}

function run() {
  const result = spawnSync(
    'bash',
    [SCRIPT, '--dry-run', 'cloudlands-fe', '2.150.0', 'v2.149.0', FE_TAG, '1.2.3'],
    { cwd: repo, env, encoding: 'utf8' },
  );
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function count(haystack: string, needle: string) {
  return haystack.split(needle).length - 1;
}

// Exactly `n` comment previews, each carrying the message and the marker.
function expectComments(stdout: string, n: number) {
  expect(count(stdout, '--- would comment on'), stdout).toBe(n);
  expect(count(stdout, EXPECTED_MESSAGE), stdout).toBe(n);
  expect(count(stdout, EXPECTED_MARKER), stdout).toBe(n);
}

// The #11 control posted and #10 did not.
function expectControlOnly(stdout: string) {
  expect(stdout).toContain(WOULD_COMMENT_11);
  expect(stdout).not.toContain(WOULD_COMMENT_10);
  expectComments(stdout, 1);
}

function expectGateSkip(stderr: string, detail: string) {
  expect(stderr).toContain(
    `issue #10: fix is not fully delivered by this release (${detail}); skipping — a later release picks it up`,
  );
}

function expectIndeterminate(stderr: string, detail: string) {
  expect(stderr).toContain(
    `warning: issue #10: completeness is indeterminate (${detail}); skipping to avoid a possibly-false claim`,
  );
}

beforeAll(() => {
  const jq = spawnSync('jq', ['--version'], { encoding: 'utf8' });
  if (jq.error || jq.status !== 0) {
    throw new Error(
      'notify-fixed-issues.test.ts needs the `jq` CLI on PATH: the stub gh applies the ' +
        "script's --jq projection to raw GraphQL fixtures with it. Install jq " +
        '(e.g. `apt install jq` / `brew install jq`; ubuntu-latest CI runners ship it).',
    );
  }

  root = mkdtempSync(join(tmpdir(), 'notify-fixed-issues-'));
  repo = join(root, 'repo');
  issuesDir = join(root, 'issues');
  compareDir = join(root, 'compare');
  const bin = join(root, 'bin');
  for (const dir of [repo, issuesDir, compareDir, bin]) mkdirSync(dir);
  writeFileSync(join(bin, 'gh'), STUB_GH);
  chmodSync(join(bin, 'gh'), 0o755);
  env = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH ?? ''}`,
    STUB_ISSUES_DIR: issuesDir,
    STUB_COMPARE_DIR: compareDir,
    ISSUES_GH_TOKEN: '',
    INTENTD_GH_TOKEN: '',
    GITHUB_ACTIONS: '',
  };

  // Fixture repo: v2.149.0..v2.150.0 holds one commit whose body references
  // issues #10 and #11 (a direct reference, not a "(#N)" squash suffix, so
  // the range scan needs no PR lookups).
  git('init', '-q', '-b', 'main');
  git('commit', '-q', '--allow-empty', '-m', 'chore: base');
  git('tag', 'v2.149.0');
  git(
    'commit',
    '-q',
    '--allow-empty',
    '-m',
    'fix: tighten the gate',
    '-m',
    'Refs intent-hq/intent#10 and intent-hq/intent#11.',
  );
  git('tag', FE_TAG);

  compareStatus(FE_TAG, CONTAINED_FE_SHA, 'behind');
  compareStatus(INTENTD_TAG, CONTAINED_INTENTD_SHA, 'identical');
  compareStatus(INTENTD_TAG, OUTSIDE_INTENTD_SHA, 'diverged');
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

beforeEach(() => {
  // Positive control: closed, with a merged fe fix PR contained in the tag.
  fixture(11, 'CLOSED', [
    { repo: SOURCE_REPO, number: 88, state: 'MERGED', sha: CONTAINED_FE_SHA },
  ]);
});

describe('notify-fixed-issues.sh completeness gate', () => {
  it('stays silent on a mention-only reference to a closed issue', () => {
    fixture(10, 'CLOSED');
    const { status, stdout, stderr } = run();
    expect(status, stderr).toBe(0);
    expectControlOnly(stdout);
    expectGateSkip(
      stderr,
      `no delivered linked fix PR on ${SOURCE_REPO}/${INTENTD_REPO}; mention-only reference`,
    );
  });

  it('stays silent on a mention-only reference to an open issue', () => {
    fixture(10, 'OPEN');
    const { status, stdout, stderr } = run();
    expect(status, stderr).toBe(0);
    expectControlOnly(stdout);
    expectGateSkip(stderr, 'issue is still open');
  });

  it('stays silent on an open issue even when its fix PR is merged and contained', () => {
    fixture(10, 'OPEN', [
      { repo: SOURCE_REPO, number: 77, state: 'MERGED', sha: CONTAINED_FE_SHA },
    ]);
    const { status, stdout, stderr } = run();
    expect(status, stderr).toBe(0);
    expectControlOnly(stdout);
    expectGateSkip(stderr, 'issue is still open');
  });

  it('comments on a closed issue whose fe fix PR is merged and contained in the tag', () => {
    fixture(10, 'CLOSED', [
      { repo: SOURCE_REPO, number: 77, state: 'MERGED', sha: CONTAINED_FE_SHA },
    ]);
    const { status, stdout, stderr } = run();
    expect(status, stderr).toBe(0);
    expect(stdout).toContain(WOULD_COMMENT_10);
    expect(stdout).toContain(WOULD_COMMENT_11);
    expectComments(stdout, 2);
    expect(stderr).toContain('issue #10: completeness gate passed');
  });

  it('comments on a closed issue whose intentd fix PR is contained in the bundled intentd tag', () => {
    fixture(10, 'CLOSED', [
      { repo: INTENTD_REPO, number: 77, state: 'MERGED', sha: CONTAINED_INTENTD_SHA },
    ]);
    const { status, stdout, stderr } = run();
    expect(status, stderr).toBe(0);
    expect(stdout).toContain(WOULD_COMMENT_10);
    expectComments(stdout, 2);
  });

  it('stays silent on a closed issue with an open fix PR', () => {
    fixture(10, 'CLOSED', [
      { repo: SOURCE_REPO, number: 77, state: 'OPEN' },
      { repo: SOURCE_REPO, number: 78, state: 'MERGED', sha: CONTAINED_FE_SHA },
    ]);
    const { status, stdout, stderr } = run();
    expect(status, stderr).toBe(0);
    expectControlOnly(stdout);
    expectGateSkip(stderr, `${SOURCE_REPO}#77 is still open`);
  });

  it('stays silent on a closed issue whose merged fix PR is outside the released tag', () => {
    fixture(10, 'CLOSED', [
      { repo: INTENTD_REPO, number: 77, state: 'MERGED', sha: OUTSIDE_INTENTD_SHA },
    ]);
    const { status, stdout, stderr } = run();
    expect(status, stderr).toBe(0);
    expectControlOnly(stdout);
    expectGateSkip(
      stderr,
      `${INTENTD_REPO}#77 is not contained in ${INTENTD_TAG} (compare status: diverged)`,
    );
  });

  it('treats an abandoned (closed, unmerged) fix PR as mention-only', () => {
    fixture(10, 'CLOSED', [{ repo: SOURCE_REPO, number: 77, state: 'CLOSED' }]);
    const { status, stdout, stderr } = run();
    expect(status, stderr).toBe(0);
    expectControlOnly(stdout);
    expectGateSkip(
      stderr,
      `no delivered linked fix PR on ${SOURCE_REPO}/${INTENTD_REPO}; mention-only reference`,
    );
  });

  it('ignores linked fix PRs in repos outside the gate', () => {
    fixture(10, 'CLOSED', [
      { repo: 'intent-hq/ios', number: 5, state: 'MERGED', sha: 'd'.repeat(40) },
    ]);
    const { status, stdout, stderr } = run();
    expect(status, stderr).toBe(0);
    expectControlOnly(stdout);
    expectGateSkip(
      stderr,
      `no delivered linked fix PR on ${SOURCE_REPO}/${INTENTD_REPO}; mention-only reference`,
    );
  });

  it('comments when an open linked PR in a repo outside the gate accompanies a delivered fe fix PR', () => {
    fixture(10, 'CLOSED', [
      { repo: 'intent-hq/ios', number: 5, state: 'OPEN' },
      { repo: SOURCE_REPO, number: 77, state: 'MERGED', sha: CONTAINED_FE_SHA },
    ]);
    const { status, stdout, stderr } = run();
    expect(status, stderr).toBe(0);
    expect(stdout).toContain(WOULD_COMMENT_10);
    expectComments(stdout, 2);
    expect(stderr).toContain('issue #10: completeness gate passed');
  });

  it('skips an issue whose linked PRs cannot be enumerated, with a warning', () => {
    rmSync(join(issuesDir, '10.json'), { force: true });
    const { status, stdout, stderr } = run();
    expect(status, stderr).toBe(0);
    expectControlOnly(stdout);
    expectIndeterminate(stderr, 'could not enumerate linked fix PRs on intent-hq/intent#10');
  });

  it.each(['CLOSED', 'OPEN'] as const)(
    'treats a truncated linked-PR list on a %s issue as indeterminate, with a warning',
    (state) => {
      fixture(
        10,
        state,
        [{ repo: SOURCE_REPO, number: 77, state: 'MERGED', sha: CONTAINED_FE_SHA }],
        { hasNextPage: true },
      );
      const { status, stdout, stderr } = run();
      expect(status, stderr).toBe(0);
      expectControlOnly(stdout);
      expectIndeterminate(stderr, 'issue has more than 100 linked PRs; enumeration truncated');
      expect(stderr).not.toContain('issue is still open');
    },
  );
});
