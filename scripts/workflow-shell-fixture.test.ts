// @verify-changed-exempt: exercises disposable shell fixtures, not repository files
// @vitest-environment node

import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { spawnWorkflowBash } from './workflow-shell-fixture';

const directories: string[] = [];
afterEach(() => {
  vi.unstubAllEnvs();
  for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'workflow-shell-'));
  directories.push(dir);
  const startup = join(dir, 'startup');
  const marker = join(dir, 'startup-ran');
  for (const file of ['startup', '.bashrc', '.bash_profile', '.bash_login', '.profile']) {
    writeFileSync(join(dir, file), 'touch "$STARTUP_MARKER"\nexit 91\n');
  }
  writeFileSync(join(dir, 'fixture-command'), '#!/usr/bin/env bash\nprintf "nested:%s\\n" "$1"\n', {
    mode: 0o755,
  });
  return { dir, startup, marker };
}

describe('workflow Bash isolation', () => {
  it.each(['1', '0'])('ignores startup files with SHLVL=%s', (shellLevel) => {
    const { dir, startup, marker } = fixture();
    const env = Object.freeze({
      ...process.env,
      HOME: dir,
      PATH: `${dir}:${process.env.PATH}`,
      SHLVL: shellLevel,
      SSH_CLIENT: '127.0.0.1 1234 22',
      SSH2_CLIENT: '127.0.0.1 1234 22',
      BASH_ENV: startup,
      ENV: startup,
      STARTUP_MARKER: marker,
      FIXTURE_VALUE: 'retained value',
    });
    const parentEnv = { ...process.env };
    const args = ['two words', 'literal $HOME; *', ''];
    for (const flags of [[], ['-l']]) {
      const result = spawnWorkflowBash(
        [
          ...flags,
          '-c',
          'printf "%s\\n" "$FIXTURE_VALUE" "$PWD" "$@"; cat; fixture-command "child argument"; printf "fixture error\\n" >&2; exit 37',
          'workflow-step',
          ...args,
        ],
        { cwd: dir, env, encoding: 'utf8', input: 'fixture input\n' },
      );
      expect(result.error).toBeUndefined();
      expect(result.status, result.stderr).toBe(37);
      expect(result.stdout).toBe(
        ['retained value', dir, ...args, 'fixture input', 'nested:child argument', ''].join('\n'),
      );
      expect(result.stderr).toBe('fixture error\n');
      expect(existsSync(marker)).toBe(false);
    }
    expect(env.BASH_ENV).toBe(startup);
    expect(env.ENV).toBe(startup);
    expect(process.env).toEqual(parentEnv);
  });

  it('sanitizes inherited startup variables without changing the parent environment', () => {
    const { startup, marker } = fixture();
    vi.stubEnv('SHLVL', '0');
    vi.stubEnv('BASH_ENV', startup);
    vi.stubEnv('ENV', startup);
    vi.stubEnv('STARTUP_MARKER', marker);
    vi.stubEnv('FIXTURE_VALUE', 'inherited value');
    const result = spawnWorkflowBash(['-c', 'printf "%s" "$FIXTURE_VALUE"'], {
      encoding: 'utf8',
    });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toBe('inherited value');
    expect(existsSync(marker)).toBe(false);
    expect(process.env.BASH_ENV).toBe(startup);
    expect(process.env.ENV).toBe(startup);
    expect(process.env.SHLVL).toBe('0');
  });

  it('preserves the caller’s error and pipeline options', () => {
    const code = 'false | true; printf reached';
    const strict = spawnWorkflowBash(['-e', '-o', 'pipefail', '-c', code], {
      encoding: 'utf8',
    });
    expect(strict.status).toBe(1);
    expect(strict.stdout).toBe('');
    const ordinary = spawnWorkflowBash(['-c', code], { encoding: 'utf8' });
    expect(ordinary.status).toBe(0);
    expect(ordinary.stdout).toBe('reached');
  });
});
