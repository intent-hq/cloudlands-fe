// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, unlinkSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — plain .mjs module without type declarations
import { evaluateFastPath } from './release-pr-fast-path.mjs';

const VERSION_A = '2.28.0';
const VERSION_B = '2.29.0';

const basePackageJson = (version: string, extra: Record<string, string> = {}) =>
  JSON.stringify(
    {
      name: 'intent',
      version,
      dependencies: { 'left-pad': '1.0.0', ...extra },
    },
    null,
    2,
  ) + '\n';

const baseManifest = (version: string) => `{\n  ".": "${version}"\n}\n`;

const tempDirs: string[] = [];

function initRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'release-pr-fast-path-'));
  tempDirs.push(dir);
  const git = (...args: string[]) =>
    execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'Test');
  writeFileSync(join(dir, 'package.json'), basePackageJson(VERSION_A));
  writeFileSync(join(dir, '.release-please-manifest.json'), baseManifest(VERSION_A));
  writeFileSync(join(dir, 'CHANGELOG.md'), '# Changelog\n\n## 2.28.0\n\n- old entry\n');
  writeFileSync(join(dir, 'src.ts'), 'export const value = 1;\n');
  git('add', '-A');
  git('commit', '-qm', 'base');
  git('branch', 'base');
  return dir;
}

function commit(dir: string, message = 'head'): void {
  execFileSync('git', ['add', '-A'], { cwd: dir });
  execFileSync('git', ['commit', '-qm', message], { cwd: dir });
}

function releaseBump(dir: string): void {
  writeFileSync(join(dir, 'package.json'), basePackageJson(VERSION_B));
  writeFileSync(join(dir, '.release-please-manifest.json'), baseManifest(VERSION_B));
  writeFileSync(join(dir, 'CHANGELOG.md'), '# Changelog\n\n## 2.29.0\n\n- new entry\n');
}

function evaluate(dir: string) {
  return evaluateFastPath('base', 'HEAD', dir) as { fastPath: boolean; reason?: string };
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('release-pr-fast-path', () => {
  it('matches a true release-shaped diff (version + manifest + changelog)', () => {
    const dir = initRepo();
    releaseBump(dir);
    commit(dir);
    expect(evaluate(dir)).toEqual({ fastPath: true });
  });

  it('matches without a manifest change (files are a subset of the allowed set)', () => {
    const dir = initRepo();
    releaseBump(dir);
    writeFileSync(join(dir, '.release-please-manifest.json'), baseManifest(VERSION_A));
    commit(dir);
    expect(evaluate(dir)).toEqual({ fastPath: true });
  });

  it('rejects when an extra file changed alongside the release bump', () => {
    const dir = initRepo();
    releaseBump(dir);
    writeFileSync(join(dir, 'src.ts'), 'export const value = 2;\n');
    commit(dir);
    expect(evaluate(dir)).toEqual({
      fastPath: false,
      reason: 'disallowed file: src.ts',
    });
  });

  it('rejects a dependency bump riding along in package.json', () => {
    const dir = initRepo();
    releaseBump(dir);
    writeFileSync(
      join(dir, 'package.json'),
      basePackageJson(VERSION_B).replace('"left-pad": "1.0.0"', '"left-pad": "1.3.0"'),
    );
    commit(dir);
    expect(evaluate(dir)).toEqual({
      fastPath: false,
      reason: 'non-version change in package.json',
    });
  });

  it('rejects a version mismatch between package.json and the manifest', () => {
    const dir = initRepo();
    releaseBump(dir);
    writeFileSync(join(dir, '.release-please-manifest.json'), baseManifest('9.9.9'));
    commit(dir);
    expect(evaluate(dir)).toEqual({
      fastPath: false,
      reason: `manifest "." at head is not '${VERSION_B}'`,
    });
  });

  it('rejects an added file', () => {
    const dir = initRepo();
    releaseBump(dir);
    writeFileSync(join(dir, 'NEW.md'), 'new\n');
    commit(dir);
    const result = evaluate(dir);
    expect(result.fastPath).toBe(false);
    expect(result.reason).toMatch(/non-modification change \(A NEW\.md\)|disallowed file: NEW\.md/);
  });

  it('rejects a deleted file', () => {
    const dir = initRepo();
    releaseBump(dir);
    unlinkSync(join(dir, 'src.ts'));
    commit(dir);
    const result = evaluate(dir);
    expect(result.fastPath).toBe(false);
    expect(result.reason).toContain('src.ts');
  });

  it('rejects a rename', () => {
    const dir = initRepo();
    releaseBump(dir);
    renameSync(join(dir, 'src.ts'), join(dir, 'renamed.ts'));
    commit(dir);
    expect(evaluate(dir).fastPath).toBe(false);
  });

  it('rejects a changelog-only diff (no version delta)', () => {
    const dir = initRepo();
    writeFileSync(join(dir, 'CHANGELOG.md'), '# Changelog\n\n- tweak\n');
    commit(dir);
    expect(evaluate(dir)).toEqual({
      fastPath: false,
      reason: 'package.json unchanged (no version delta)',
    });
  });

  it('rejects an empty diff', () => {
    const dir = initRepo();
    expect(evaluate(dir)).toEqual({ fastPath: false, reason: 'empty diff' });
  });
});
