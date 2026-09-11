import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { INSTALL_COMMAND, checkDepsFresh } from './check-deps-fresh.mjs';

const temporaryPaths: string[] = [];

function fixtureRoot(files: Record<string, string>) {
  const root = join(tmpdir(), `check-deps-fresh-test-${process.pid}-${temporaryPaths.length}`);
  mkdirSync(root, { recursive: true });
  temporaryPaths.push(root);
  for (const [file, content] of Object.entries(files)) {
    const path = join(root, file);
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, content);
  }
  return root;
}

const LOCKFILE = "lockfileVersion: '9.0'\nimporters:\n  .:\n    dependencies:\n      a: 1.0.0\n";

afterEach(() => {
  for (const path of temporaryPaths.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe('check-deps-fresh', () => {
  it('passes when the installed lockfile copy matches pnpm-lock.yaml', () => {
    const root = fixtureRoot({
      'pnpm-lock.yaml': LOCKFILE,
      'node_modules/.pnpm/lock.yaml': LOCKFILE,
    });
    expect(checkDepsFresh(root)).toEqual({ ok: true, status: 'fresh', reason: null });
  });

  it('reports a stale install when pnpm-lock.yaml changed without a reinstall', () => {
    const root = fixtureRoot({
      'pnpm-lock.yaml': LOCKFILE.replace('a: 1.0.0', 'a: 1.0.1'),
      'node_modules/.pnpm/lock.yaml': LOCKFILE,
    });
    const result = checkDepsFresh(root);
    expect(result.ok).toBe(false);
    expect(result.status).toBe('stale');
    expect(result.reason).toContain('out of sync with pnpm-lock.yaml');
    expect(result.reason).toContain(INSTALL_COMMAND);
    expect(result.reason).not.toContain('\n');
  });

  it('reports a missing install when node_modules has no lockfile copy', () => {
    const root = fixtureRoot({ 'pnpm-lock.yaml': LOCKFILE });
    const result = checkDepsFresh(root);
    expect(result.ok).toBe(false);
    expect(result.status).toBe('missing');
    expect(result.reason).toContain('node_modules is missing');
    expect(result.reason).toContain(INSTALL_COMMAND);
    expect(result.reason).not.toContain('\n');
  });
});
