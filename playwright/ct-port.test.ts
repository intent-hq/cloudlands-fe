import { mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  ctLockKey,
  ctPort,
  DEFAULT_CT_PORT,
  WORKTREE_CT_PORT_BASE,
  WORKTREE_CT_PORT_COUNT,
  worktreeCtPort,
} from '../scripts/verification-lock.mjs';
import { resolveCtPortConfig } from './ct-port';

const scratch = mkdtempSync(path.join(tmpdir(), 'ct-port-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const rootA = '/work/a/intent/packages/cloudlands-fe';
const rootB = '/work/b/intent/packages/cloudlands-fe';

describe('worktreeCtPort', () => {
  it('is stable for one root and inside the per-worktree range', () => {
    const port = worktreeCtPort(rootA);
    expect(worktreeCtPort(rootA)).toBe(port);
    expect(port).toBeGreaterThanOrEqual(WORKTREE_CT_PORT_BASE);
    expect(port).toBeLessThan(WORKTREE_CT_PORT_BASE + WORKTREE_CT_PORT_COUNT);
    expect(port).not.toBe(DEFAULT_CT_PORT);
  });

  it('gives separate worktrees separate ports', () => {
    expect(worktreeCtPort(rootA)).not.toBe(worktreeCtPort(rootB));
    const roots = Array.from({ length: 10 }, (_, i) => `/work/changed-verify-${i}/intent`);
    expect(new Set(roots.map((root) => worktreeCtPort(root))).size).toBe(roots.length);
  });

  it('keys on the canonical path, so a symlinked checkout shares its port', () => {
    const link = path.join(scratch, 'link');
    symlinkSync(scratch, link);
    expect(worktreeCtPort(link)).toBe(worktreeCtPort(scratch));
  });

  it('defaults to this package root', () => {
    expect(worktreeCtPort()).toBe(worktreeCtPort(path.resolve(__dirname, '..')));
  });
});

describe('ctPort defaults', () => {
  it('uses the per-worktree port locally when CT_PORT is unset or blank', () => {
    for (const env of [{}, { CT_PORT: '' }, { CT_PORT: ' ' }]) {
      expect(ctPort(env, { root: rootA })).toBe(worktreeCtPort(rootA));
      expect(ctLockKey(env, { root: rootA })).toBe(`ct-${worktreeCtPort(rootA)}`);
    }
    expect(ctLockKey({}, { root: rootA })).not.toBe(ctLockKey({}, { root: rootB }));
  });

  it.each(['true', '1', 'TRUE'])('keeps 3100 on CI (CI=%j)', (ci) => {
    expect(ctPort({ CI: ci }, { root: rootA })).toBe(DEFAULT_CT_PORT);
    expect(ctLockKey({ CI: ci }, { root: rootB })).toBe('ct-3100');
  });

  it.each(['', 'false', '0'])('treats CI=%j as a local run', (ci) => {
    expect(ctPort({ CI: ci }, { root: rootA })).toBe(worktreeCtPort(rootA));
  });

  it('honors an explicit CT_PORT everywhere, including CI', () => {
    expect(ctPort({ CT_PORT: '3100' }, { root: rootA })).toBe(3100);
    expect(ctPort({ CT_PORT: '3101' }, { root: rootA })).toBe(3101);
    expect(ctPort({ CT_PORT: ' 03102 ', CI: 'true' }, { root: rootB })).toBe(3102);
  });
});

describe('resolveCtPortConfig', () => {
  it('uses the per-worktree port and the default cache when CT_PORT is unset', () => {
    const expected = { port: worktreeCtPort(rootA), cacheDir: 'playwright/.cache' };
    expect(resolveCtPortConfig({ env: {}, root: rootA })).toEqual(expected);
    expect(resolveCtPortConfig({ env: { CT_PORT: undefined }, root: rootA })).toEqual(expected);
  });

  it("returns Playwright's defaults on CI when CT_PORT is unset", () => {
    expect(resolveCtPortConfig({ env: { CI: 'true' }, root: rootA })).toEqual({
      port: 3100,
      cacheDir: 'playwright/.cache',
    });
  });

  it('derives the port and the cache dir from CT_PORT when it is set', () => {
    expect(resolveCtPortConfig({ env: { CT_PORT: '3101' } })).toEqual({
      port: 3101,
      cacheDir: 'playwright/.cache-3101',
    });
    expect(resolveCtPortConfig({ env: { CT_PORT: '3100' } })).toEqual({
      port: 3100,
      cacheDir: 'playwright/.cache-3100',
    });
  });

  it.each(['', ' ', '\t', ' \n '])('treats blank CT_PORT %j as unset', (raw) => {
    expect(resolveCtPortConfig({ env: { CT_PORT: raw }, root: rootA })).toEqual({
      port: worktreeCtPort(rootA),
      cacheDir: 'playwright/.cache',
    });
    expect(resolveCtPortConfig({ env: { CT_PORT: raw, CI: 'true' } })).toEqual({
      port: 3100,
      cacheDir: 'playwright/.cache',
    });
  });

  it('trims surrounding whitespace and normalizes the numeric port', () => {
    expect(resolveCtPortConfig({ env: { CT_PORT: ' 3102 ' } })).toEqual({
      port: 3102,
      cacheDir: 'playwright/.cache-3102',
    });
    expect(resolveCtPortConfig({ env: { CT_PORT: '03101' } })).toEqual({
      port: 3101,
      cacheDir: 'playwright/.cache-3101',
    });
  });

  it.each([{}, { CI: 'true' }, { CT_PORT: ' ' }, { CT_PORT: '3101' }, { CT_PORT: ' 03102 ' }])(
    'agrees with the verification-lock port and lock key for env %j',
    (env) => {
      const { port } = resolveCtPortConfig({ env });
      expect(ctPort(env)).toBe(port);
      expect(ctLockKey(env)).toBe(`ct-${port}`);
    },
  );
});
