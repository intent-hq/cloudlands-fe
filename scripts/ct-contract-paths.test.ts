// @vitest-environment node
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CT_CONTRACT_PATHS,
  changedFiles,
  ctRequired,
  isCtContractPath,
  main,
} from './ct-contract-paths.mjs';

const CLI = resolve('scripts/ct-contract-paths.mjs');

const temporaryPaths: string[] = [];

function git(root: string, ...args: string[]) {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function commitFile(root: string, file: string, content = '') {
  const path = join(root, file);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
  git(root, 'add', file);
  git(root, 'commit', '-q', '-m', `add ${file}`);
}

function gitRepository() {
  const root = mkdtempSync(join(tmpdir(), 'ct-contract-paths-'));
  temporaryPaths.push(root);
  git(root, 'init', '-q');
  git(root, 'symbolic-ref', 'HEAD', 'refs/heads/main');
  git(root, 'config', 'user.name', 'ct-contract-paths test');
  git(root, 'config', 'user.email', 'ct-contract-paths@example.invalid');
  git(root, 'config', 'commit.gpgsign', 'false');
  git(root, 'config', 'core.quotePath', 'true');
  git(root, 'config', 'diff.renames', 'true');
  commitFile(root, 'src/base.ts');
  commitFile(root, 'src/lib/styles/tokens.css', ':root { --a: 1; }');
  return root;
}

function branch(root: string, name: string, ...files: string[]) {
  git(root, 'checkout', '-q', '-b', name, 'main');
  for (const file of files) commitFile(root, file, `// ${name}`);
}

function runCli(cwd: string, ...args: string[]) {
  const result = spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8' });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

afterEach(() => {
  for (const path of temporaryPaths.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe('isCtContractPath', () => {
  it.each([
    'src/app.css',
    'src/lib/styles/tokens.css',
    'src/lib/styles/nested/theme.css',
    'playwright-ct.config.ts',
    'playwright/index.ts',
    'playwright/app-stubs/stores.ts',
    'scripts/run-ct-tests.mjs',
    'src/lib/component-catalog/capture-stability.ts',
    'src/lib/component-catalog/geometry-probe.ts',
    'src/lib/component-catalog/preview-definition.ts',
    'package.json',
    'pnpm-lock.yaml',
    './src/app.css',
  ])('matches %s', (file) => {
    expect(isCtContractPath(file)).toBe(true);
  });

  it.each([
    'src/foo.test.ts',
    'src/lib/example.ts',
    'src/lib/styles-legacy/tokens.css',
    'src/app.css.map',
    'src/lib/component-catalog/catalog.ts',
    'src/lib/component-catalog/geometry-probe.test.ts',
    'src/lib/component-catalog/nested/preview-definition.ts',
    'playwright.config.ts',
    'scripts/verify-changed.mjs',
    'scripts/ct-contract-paths.mjs',
    'packages/cloudlands-fe/package.json',
    'e2e/playwright/index.ts',
    '.github/workflows/intent-pr.yml',
  ])('does not match %s', (file) => {
    expect(isCtContractPath(file)).toBe(false);
  });

  it('exports exactly the ten paths the CT harness depends on', () => {
    expect([...CT_CONTRACT_PATHS].sort()).toEqual([
      'package.json',
      'playwright-ct.config.ts',
      'playwright/**',
      'pnpm-lock.yaml',
      'scripts/run-ct-tests.mjs',
      'src/app.css',
      'src/lib/component-catalog/capture-stability.ts',
      'src/lib/component-catalog/geometry-probe.ts',
      'src/lib/component-catalog/preview-definition.ts',
      'src/lib/styles/**',
    ]);
  });
});

describe('ctRequired and main', () => {
  it('requires CT when any changed file is a contract path', () => {
    expect(ctRequired(['src/lib/example.ts', 'src/lib/styles/tokens.css'])).toBe(true);
    expect(ctRequired(['src/lib/example.ts', 'scripts/verify-changed.mjs'])).toBe(false);
    expect(ctRequired([])).toBe(false);
  });

  it('prints one ct_required line from the injected diff', () => {
    const calls: string[][] = [];
    const io = (files: string[]) => {
      const logs: string[] = [];
      const code = main(['--diff', 'base', 'head'], {
        diff: (base: string, head: string) => {
          calls.push([base, head]);
          return files;
        },
        log: (line: string) => logs.push(line),
        warn: () => {},
      });
      return { code, logs };
    };
    expect(io(['src/app.css'])).toEqual({ code: 0, logs: ['ct_required=true'] });
    expect(io(['src/foo.test.ts'])).toEqual({ code: 0, logs: ['ct_required=false'] });
    expect(calls).toEqual([
      ['base', 'head'],
      ['base', 'head'],
    ]);
  });

  it('fails safe to ct_required=true on a diff error or bad usage', () => {
    for (const argv of [['--diff', 'base', 'head'], ['--diff', 'base'], [], ['--list']]) {
      const logs: string[] = [];
      const warnings: string[] = [];
      const code = main(argv, {
        diff: () => {
          throw new Error('git exploded');
        },
        log: (line: string) => logs.push(line),
        warn: (line: string) => warnings.push(line),
      });
      expect(code, argv.join(' ')).toBe(0);
      expect(logs, argv.join(' ')).toEqual(['ct_required=true']);
      expect(warnings.join('\n'), argv.join(' ')).toContain('fail-safe');
    }
  });
});

describe('--diff against a git repository', () => {
  it('lists added, modified and deleted files between two refs', () => {
    const root = gitRepository();
    branch(root, 'feature', 'src/lib/styles/theme.css', 'src/base.ts');
    git(root, 'rm', '-q', 'src/lib/styles/tokens.css');
    git(root, 'commit', '-q', '-m', 'remove tokens');
    expect(changedFiles('main', 'feature', { cwd: root }).sort()).toEqual([
      'src/base.ts',
      'src/lib/styles/theme.css',
      'src/lib/styles/tokens.css',
    ]);
  });

  it('prints ct_required=false when the diff only touches scripts and tests', () => {
    const root = gitRepository();
    branch(root, 'scripts-only', 'scripts/verify-changed.mjs', 'src/foo.test.ts');
    expect(runCli(root, '--diff', 'main', 'scripts-only')).toEqual({
      status: 0,
      stdout: 'ct_required=false\n',
      stderr: '',
    });
  });

  it('prints ct_required=true when a contract path is in the diff', () => {
    const root = gitRepository();
    branch(root, 'tokens', 'scripts/verify-changed.mjs', 'src/lib/styles/tokens.css');
    expect(runCli(root, '--diff', 'main', 'tokens')).toEqual({
      status: 0,
      stdout: 'ct_required=true\n',
      stderr: '',
    });
    branch(root, 'deleted', 'src/other.ts');
    git(root, 'rm', '-q', 'src/lib/styles/tokens.css');
    git(root, 'commit', '-q', '-m', 'remove tokens');
    expect(runCli(root, '--diff', 'main', 'deleted').stdout).toBe('ct_required=true\n');
  });

  it('keeps non-ASCII paths verbatim instead of the quoted form git prints by default', () => {
    const root = gitRepository();
    branch(root, 'unicode', 'src/lib/styles/thème.css');
    expect(changedFiles('main', 'unicode', { cwd: root })).toEqual(['src/lib/styles/thème.css']);
    expect(runCli(root, '--diff', 'main', 'unicode')).toEqual({
      status: 0,
      stdout: 'ct_required=true\n',
      stderr: '',
    });
  });

  it('reports both sides of a rename so a contract file moved away still requires CT', () => {
    const root = gitRepository();
    branch(root, 'renamed');
    git(root, 'mv', 'src/lib/styles/tokens.css', 'src/moved.css');
    git(root, 'commit', '-q', '-m', 'move tokens');
    expect(git(root, 'diff', '--name-status', '-M', 'main', 'renamed')).toMatch(/^R100\t/);
    expect(changedFiles('main', 'renamed', { cwd: root }).sort()).toEqual([
      'src/lib/styles/tokens.css',
      'src/moved.css',
    ]);
    expect(runCli(root, '--diff', 'main', 'renamed')).toEqual({
      status: 0,
      stdout: 'ct_required=true\n',
      stderr: '',
    });
  });

  it('exits 0 with ct_required=true when git cannot resolve the refs', () => {
    const root = gitRepository();
    const result = runCli(root, '--diff', 'main', 'no-such-ref');
    expect(result.status).toBe(0);
    expect(result.stdout).toBe('ct_required=true\n');
    expect(result.stderr).toContain('fail-safe');
  });
});
