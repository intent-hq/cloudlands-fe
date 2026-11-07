// @verify-changed-triggers: scripts/git-network-retry.sh, .github/actions/checkout-pinned/action.yml

/**
 * Regression tests for scripts/git-network-retry.sh (intent-hq/intent#8783):
 * merge-queue Unit Tests shards were ejected when github.com dropped a
 * connection during a pinned fixture checkout or the baseline fetch. The
 * script must retry transient network errors and still fail at once on a real
 * error such as a missing ref.
 *
 * Every scenario runs the real script against real git. The network failure
 * is real too: git connects to a closed loopback port. A stub git that fails
 * with that same error first and then defers to real git proves a retry
 * recovers.
 */
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const SCRIPT = resolve(process.cwd(), 'scripts/git-network-retry.sh');
const UNREACHABLE = 'https://127.0.0.1:9/intent-hq/intent';

let tmp: string;
let source: string;
let sourceUrl: string;
let headSha: string;

const git = (cwd: string, ...args: string[]) => {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')}: ${result.stderr}`);
  return result.stdout.trim();
};

function runScript(args: string[], options: { input?: string; env?: Record<string, string> } = {}) {
  const result = spawnSync('bash', [SCRIPT, ...args], {
    cwd: tmp,
    encoding: 'utf8',
    input: options.input ?? '',
    env: {
      ...process.env,
      GIT_TERMINAL_PROMPT: '0',
      GIT_RETRY_DELAYS: '0',
      ...options.env,
    },
  });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

// Fails like a dropped github.com connection for the first `failures` calls of
// `failOn` (a git subcommand), then runs real git.
function flakyGit(failOn: string, failures: number) {
  const counter = join(tmp, `${failOn}-calls`);
  const stub = join(tmp, `flaky-${failOn}.sh`);
  writeFileSync(counter, '0');
  writeFileSync(
    stub,
    `#!/usr/bin/env bash
for arg in "$@"; do
  if [ "$arg" = ${failOn} ]; then
    n=$(( $(cat "${counter}") + 1 )); echo "$n" > "${counter}"
    if [ "$n" -le ${failures} ]; then
      echo "fatal: unable to access 'https://github.com/intent-hq/intent/': Failed to connect to github.com port 443 after 133781 ms: Couldn't connect to server" >&2
      exit 128
    fi
    break
  fi
done
exec git "$@"
`,
  );
  chmodSync(stub, 0o755);
  return { stub, calls: () => Number(readFileSync(counter, 'utf8')) };
}

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), 'git-network-retry-'));
  source = join(tmp, 'source');
  git(tmp, 'init', '-q', '-b', 'main', source);
  for (const [key, value] of [
    ['user.email', 'ci@example.com'],
    ['user.name', 'CI'],
    ['uploadpack.allowFilter', 'true'],
    ['uploadpack.allowAnySHA1InWant', 'true'],
  ]) {
    git(source, 'config', key, value);
  }
  git(source, 'commit', '-q', '--allow-empty', '-m', 'old');
  const files: Record<string, string> = {
    'docs/protocol/fixtures/turn-start/turn-start-events.json': '{"v":1}\n',
    'docs/protocol/fixtures/other/skip.json': '{}\n',
    'scripts/turn-start-contract.mjs': 'export {};\n',
    'README.md': 'monorepo\n',
  };
  for (const [file, content] of Object.entries(files)) {
    spawnSync('mkdir', ['-p', join(source, file, '..')]);
    writeFileSync(join(source, file), content);
  }
  git(source, 'add', '.');
  git(source, 'commit', '-q', '-m', 'fixtures');
  headSha = git(source, 'rev-parse', 'HEAD');
  sourceUrl = `file://${source}`;
});

afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe.skipIf(process.platform === 'win32')('git-network-retry.sh', () => {
  describe('run', () => {
    it('retries a transient network error and succeeds once the network recovers', () => {
      const dest = join(tmp, 'run-recovers');
      git(tmp, 'init', '-q', dest);
      const flaky = flakyGit('fetch', 2);
      const { status, output } = runScript(
        ['run', '-C', dest, 'fetch', '--no-tags', '--depth=1', sourceUrl, headSha],
        { env: { GIT_RETRY_GIT: flaky.stub } },
      );
      expect(status, output).toBe(0);
      expect(flaky.calls()).toBe(3);
      expect(output).toContain('attempt 1/4');
      expect(output).toContain('attempt 2/4');
      expect(git(dest, 'rev-parse', 'FETCH_HEAD')).toBe(headSha);
    });

    it('gives up after the attempt budget when the network stays down', () => {
      const dest = join(tmp, 'run-down');
      git(tmp, 'init', '-q', dest);
      const { status, output } = runScript(['run', '-C', dest, 'fetch', UNREACHABLE, 'main'], {
        env: { GIT_RETRY_ATTEMPTS: '3' },
      });
      expect(status).toBe(128);
      expect(output).toMatch(/Failed to connect to 127\.0\.0\.1/);
      expect(output.match(/::warning::/g)).toHaveLength(2);
      expect(output).toContain('::error::');
      expect(output).toContain('after 3 attempts');
    });

    it('fails at once on a missing ref', () => {
      const dest = join(tmp, 'run-missing');
      git(tmp, 'init', '-q', dest);
      const { status, output } = runScript([
        'run',
        '-C',
        dest,
        'fetch',
        '--depth=1',
        sourceUrl,
        'refs/heads/no-such-branch',
      ]);
      expect(status).not.toBe(0);
      expect(output).toContain("couldn't find remote ref");
      expect(output).not.toContain('::warning::');
      expect(output).toContain('not a transient network error');
    });

    it('fails at once on a missing commit', () => {
      const dest = join(tmp, 'run-missing-sha');
      git(tmp, 'init', '-q', dest);
      const { status, output } = runScript([
        'run',
        '-C',
        dest,
        'fetch',
        '--depth=1',
        sourceUrl,
        'f'.repeat(40),
      ]);
      expect(status).not.toBe(0);
      expect(output).not.toContain('::warning::');
    });
  });

  describe('classify', () => {
    // Real git/curl/GnuTLS output; the first entry is from run 42396708869.
    const transient = [
      "fatal: unable to access 'https://github.com/intent-hq/intent/': Failed to connect to github.com port 443 after 141331 ms: Couldn't connect to server\nfatal: could not fetch c675bc2eccb320638212c1dcb650acdf216c4c47 from promisor remote",
      "fatal: unable to access 'https://github.com/intent-hq/intent/': GnuTLS recv error (-54): Error in the pull function.\nfatal: could not fetch c675bc2e from promisor remote",
      "fatal: unable to access 'https://github.com/intent-hq/intent/': GnuTLS recv error (-9): A TLS packet with unexpected length was received.",
      "fatal: unable to access 'https://github.com/intent-hq/intent/': Could not resolve host: github.com",
      "fatal: unable to access 'https://github.com/intent-hq/intent/': Operation too slow. Less than 1000 bytes/sec transferred the last 60 seconds",
      "fatal: unable to access 'https://github.com/intent-hq/intent/': The requested URL returned error: 502",
      "fatal: unable to access 'https://github.com/intent-hq/intent/': The requested URL returned error: 408",
      'error: RPC failed; curl 92 HTTP/2 stream 5 was not closed cleanly: CANCEL (err 8)\nfatal: early EOF',
    ];
    const permanent = [
      'fatal: remote error: upload-pack: not our ref ffffffffffffffffffffffffffffffffffffffff\nfatal: the remote end hung up unexpectedly',
      "fatal: couldn't find remote ref refs/heads/no-such-branch",
      "remote: Repository not found.\nfatal: repository 'https://github.com/intent-hq/nope/' not found",
      "fatal: could not read Username for 'https://github.com': terminal prompts disabled",
      "fatal: unable to access 'https://github.com/intent-hq/intent/': The requested URL returned error: 403",
      'fatal: could not fetch c675bc2eccb320638212c1dcb650acdf216c4c47 from promisor remote',
    ];
    it.each(transient.map((line) => [line]))('retries %s', (line) => {
      expect(runScript(['classify'], { input: line }).output.trim()).toBe('transient');
    });
    it.each(permanent.map((line) => [line]))('does not retry %s', (line) => {
      expect(runScript(['classify'], { input: line }).output.trim()).toBe('permanent');
    });
  });

  it('treats a blank delay list as no wait', () => {
    const dest = join(tmp, 'run-no-delays');
    git(tmp, 'init', '-q', dest);
    const { status, output } = runScript(['run', '-C', dest, 'fetch', UNREACHABLE, 'main'], {
      env: { GIT_RETRY_ATTEMPTS: '2', GIT_RETRY_DELAYS: ' ' },
    });
    expect(status).toBe(128);
    expect(output).toContain('after 2 attempts');
  });

  describe('sparse-checkout', () => {
    const patterns = '/docs/protocol/fixtures/turn-start/\n\n/scripts/turn-start-contract.mjs\n';

    it('checks out only the listed paths of a pinned commit', () => {
      const dest = join(tmp, 'sparse-pinned');
      const { status, output } = runScript(['sparse-checkout', sourceUrl, headSha, dest], {
        input: patterns,
      });
      expect(status, output).toBe(0);
      expect(git(dest, 'rev-parse', 'HEAD')).toBe(headSha);
      expect(existsSync(join(dest, 'docs/protocol/fixtures/turn-start/turn-start-events.json'))).toBe(true);
      expect(existsSync(join(dest, 'scripts/turn-start-contract.mjs'))).toBe(true);
      expect(existsSync(join(dest, 'docs/protocol/fixtures/other/skip.json'))).toBe(false);
      expect(existsSync(join(dest, 'README.md'))).toBe(false);
    });

    it('checks out a branch name and replaces a stale directory', () => {
      const dest = join(tmp, 'sparse-branch');
      runScript(['sparse-checkout', sourceUrl, headSha, dest], { input: '/README.md\n' });
      const { status, output } = runScript(['sparse-checkout', sourceUrl, 'main', dest], {
        input: patterns,
      });
      expect(status, output).toBe(0);
      expect(git(dest, 'rev-parse', 'HEAD')).toBe(headSha);
      expect(existsSync(join(dest, 'README.md'))).toBe(false);
    });

    it('retries a dropped connection while checkout downloads the files', () => {
      // A blob:none checkout downloads blobs lazily inside `git checkout`,
      // which actions/checkout never retried (the 2026-11-07 failures).
      const dest = join(tmp, 'sparse-recovers');
      const flaky = flakyGit('checkout', 1);
      const { status, output } = runScript(['sparse-checkout', sourceUrl, headSha, dest], {
        input: patterns,
        env: { GIT_RETRY_GIT: flaky.stub },
      });
      expect(status, output).toBe(0);
      expect(flaky.calls()).toBe(2);
      expect(existsSync(join(dest, 'scripts/turn-start-contract.mjs'))).toBe(true);
    });

    it('fails at once when the pinned commit does not exist', () => {
      const dest = join(tmp, 'sparse-missing');
      const { status, output } = runScript(['sparse-checkout', sourceUrl, 'e'.repeat(40), dest], {
        input: patterns,
      });
      expect(status).not.toBe(0);
      expect(output).not.toContain('::warning::');
    });

    it('rejects an empty ref instead of checking out a default branch', () => {
      const { status, output } = runScript(['sparse-checkout', sourceUrl, '', join(tmp, 'x')], {
        input: patterns,
      });
      expect(status).toBe(2);
      expect(output).toContain('usage');
    });

    it('rejects an empty pattern list', () => {
      const { status, output } = runScript(['sparse-checkout', sourceUrl, headSha, join(tmp, 'y')], {
        input: '\n',
      });
      expect(status).toBe(2);
      expect(output).toContain('no sparse-checkout patterns');
    });
  });
});
