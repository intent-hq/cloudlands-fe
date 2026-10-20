// @verify-changed-exempt: runs actionlint only over temporary repositories created by the suite

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ACTIONLINT_SHA256,
  ACTIONLINT_VERSION,
  archiveName,
  binaryVersion,
  installFromArchive,
  main,
  platformKey,
  resolveActionlint,
  resolveShellcheck,
  runActionlint,
  verifyChecksum,
} from './check-workflows.mjs';

const temps: string[] = [];
const tempDir = (prefix: string) => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  temps.push(dir);
  return dir;
};

afterEach(() => {
  delete process.env.ACTIONLINT_SHELLCHECK;
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const repoWithWorkflow = (name: string, content: string) => {
  const root = tempDir('check-workflows-repo-');
  execFileSync('git', ['init', '-q', root]);
  mkdirSync(join(root, '.github', 'workflows'), { recursive: true });
  writeFileSync(join(root, '.github', 'workflows', name), content);
  return root;
};

const BROKEN_WORKFLOW = [
  'on: push',
  'jobs:',
  '  build:',
  '    runs-on: ubuntu-24.04',
  '    steps:',
  '      - run: echo $UNQUOTED_VALUE',
  '      - run: echo done',
  '        if: ${{ github.nonexistent_property }}',
  '',
].join('\n');

const CLEAN_WORKFLOW = [
  'on: push',
  'jobs:',
  '  build:',
  '    runs-on: ubuntu-24.04',
  '    steps:',
  '      - run: echo "$GITHUB_SHA"',
  '',
].join('\n');

describe('check-workflows pinned download', () => {
  it('maps supported hosts to a pinned release archive', () => {
    expect(platformKey('linux', 'x64')).toBe('linux-amd64');
    expect(platformKey('darwin', 'arm64')).toBe('darwin-arm64');
    expect(archiveName('linux-arm64')).toBe(`actionlint_${ACTIONLINT_VERSION}_linux_arm64.tar.gz`);
    expect(() => platformKey('win32', 'x64')).toThrow(/no pinned release/);
  });

  it('rejects an archive whose checksum does not match the pin', () => {
    const tampered = Buffer.from('not the actionlint release');
    expect(() => verifyChecksum(tampered, ACTIONLINT_SHA256['linux-amd64'], 'archive')).toThrow(
      /SHA-256 mismatch/,
    );
    const cacheDir = tempDir('check-workflows-cache-');
    expect(() => installFromArchive(tampered, { key: 'linux-amd64', cacheDir })).toThrow(
      /SHA-256 mismatch/,
    );
    expect(existsSync(join(cacheDir, ACTIONLINT_VERSION, 'actionlint'))).toBe(false);
  });

  it('reads release and go-install version banners, and null for a broken binary', () => {
    const dir = tempDir('check-workflows-bin-');
    const fake = (name: string, body: string) => {
      const file = join(dir, name);
      writeFileSync(file, `#!/bin/sh\n${body}\n`);
      chmodSync(file, 0o755);
      return file;
    };
    expect(binaryVersion(fake('release', 'printf "1.7.12\\ninstalled by downloading\\n"'))).toBe(
      '1.7.12',
    );
    expect(binaryVersion(fake('go-install', 'echo v1.7.12'))).toBe('1.7.12');
    expect(binaryVersion(fake('broken', 'exit 1'))).toBeNull();
    expect(binaryVersion(join(dir, 'missing'))).toBeNull();
  });

  it('accepts a buffer whose digest matches', () => {
    const buffer = Buffer.from('payload');
    const digest = createHash('sha256').update(buffer).digest('hex');
    expect(() => verifyChecksum(buffer, digest, 'payload')).not.toThrow();
  });
});

describe('check-workflows shellcheck requirement', () => {
  it('fails instead of letting actionlint skip the shell pass', async () => {
    expect(() => resolveShellcheck('/nonexistent/shellcheck')).toThrow(/would skip every run/);
    process.env.ACTIONLINT_SHELLCHECK = '/nonexistent/shellcheck';
    await expect(
      main({
        cwd: repoWithWorkflow('ok.yml', CLEAN_WORKFLOW),
        cacheDir: tempDir('check-workflows-cache-'),
      }),
    ).resolves.toBe(2);
  });
});

describe('check-workflows actionlint run', () => {
  it('fails on a broken workflow and reports shellcheck and expression findings', async () => {
    const actionlint = await resolveActionlint();
    const shellcheck = resolveShellcheck();
    const root = repoWithWorkflow('broken.yml', BROKEN_WORKFLOW);
    const result = runActionlint({ actionlint, shellcheck, cwd: root, stdio: 'pipe' });
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('SC2086');
    expect(result.stdout).toContain('property "nonexistent_property" is not defined');
  }, 120_000);

  it('passes a clean workflow', async () => {
    const actionlint = await resolveActionlint();
    const root = repoWithWorkflow('clean.yml', CLEAN_WORKFLOW);
    const result = runActionlint({
      actionlint,
      shellcheck: resolveShellcheck(),
      cwd: root,
      stdio: 'pipe',
    });
    expect(result.stdout).toBe('');
    expect(result.status).toBe(0);
  }, 120_000);
});
