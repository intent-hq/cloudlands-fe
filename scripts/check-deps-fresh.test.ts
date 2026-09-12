import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { INSTALL_COMMAND, checkDepsFresh, ensureI18nFresh } from './check-deps-fresh.mjs';
import {
  PARAGLIDE_INPUTS_HASH_FILE,
  PARAGLIDE_STALE_MESSAGE,
  hashParaglideInputs,
  repoParaglidePaths,
} from './paraglide-inputs-hash.mjs';

const SCRIPTS_DIR = resolve(process.cwd(), 'scripts');
const CLI_SCRIPTS = ['check-deps-fresh.mjs', 'paraglide-inputs-hash.mjs'];

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

/** i18n inputs plus generated outputs whose recorded hash matches, so --if-stale compiles nothing. */
function writeCurrentI18nBundle(root: string) {
  const paths = repoParaglidePaths(root);
  for (const dir of Object.values(paths)) mkdirSync(dir, { recursive: true });
  writeFileSync(join(paths.projectDir, 'settings.json'), JSON.stringify({ baseLocale: 'en' }));
  writeFileSync(join(paths.messagesDir, 'en.json'), JSON.stringify({ hello: 'Hello' }));
  writeFileSync(join(paths.outdir, 'messages.js'), 'export const m = {};\n');
  writeFileSync(join(paths.outdir, 'runtime.js'), 'export const baseLocale = "en";\n');
  writeFileSync(join(paths.outdir, PARAGLIDE_INPUTS_HASH_FILE), `${hashParaglideInputs(paths)}\n`);
}

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

  it('reports an unreadable install with the remediation when the lockfile copy cannot be read', () => {
    const root = fixtureRoot({ 'pnpm-lock.yaml': LOCKFILE });
    mkdirSync(join(root, 'node_modules', '.pnpm', 'lock.yaml'), { recursive: true });
    const result = checkDepsFresh(root);
    expect(result.ok).toBe(false);
    expect(result.status).toBe('unreadable');
    expect(result.reason).toContain('could not be read (EISDIR)');
    expect(result.reason).toContain(INSTALL_COMMAND);
    expect(result.reason).not.toContain('\n');
  });
});

describe('ensureI18nFresh', () => {
  it('provisions the bundle for the given root only while it is stale', async () => {
    const calls: unknown[] = [];
    const result = await ensureI18nFresh('/pkg', {
      ensure: async (options) => {
        calls.push(options);
        return true;
      },
    });
    expect(calls).toEqual([{ rootDir: '/pkg', ifStale: true }]);
    expect(result).toEqual({ ok: true, reason: null });
  });

  it('reports the generate:i18n remediation when the compile never settles', async () => {
    const result = await ensureI18nFresh('/pkg', { ensure: async () => false });
    expect(result).toEqual({ ok: false, reason: PARAGLIDE_STALE_MESSAGE });
    expect(result.reason).toContain('generate:i18n');
  });
});

describe('check-deps-fresh CLI', () => {
  function runCli(root: string) {
    mkdirSync(join(root, 'scripts'), { recursive: true });
    for (const file of CLI_SCRIPTS)
      copyFileSync(join(SCRIPTS_DIR, file), join(root, 'scripts', file));
    const script = join(root, 'scripts', 'check-deps-fresh.mjs');
    const result = spawnSync(process.execPath, [script], { cwd: root, encoding: 'utf8' });
    return { status: result.status, stdout: result.stdout, stderr: result.stderr };
  }

  it('exits 0 silently on a fresh install with a current i18n bundle', () => {
    const root = fixtureRoot({
      'pnpm-lock.yaml': LOCKFILE,
      'node_modules/.pnpm/lock.yaml': LOCKFILE,
    });
    writeCurrentI18nBundle(root);
    const sidecar = join(repoParaglidePaths(root).outdir, PARAGLIDE_INPUTS_HASH_FILE);
    const before = statSync(sidecar).mtimeMs;
    expect(runCli(root)).toEqual({ status: 0, stdout: '', stderr: '' });
    expect(statSync(sidecar).mtimeMs).toBe(before);
  });

  it('reports a missing i18n bundle under the generate:i18n prefix once deps are fresh', () => {
    const root = fixtureRoot({
      'pnpm-lock.yaml': LOCKFILE,
      'node_modules/.pnpm/lock.yaml': LOCKFILE,
    });
    const result = runCli(root);
    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toMatch(/^\[generate:i18n\] /);
    expect(result.stderr).not.toContain('[deps:check]');
  });

  it('exits 1 with a single prefixed stderr line on a stale install', () => {
    const root = fixtureRoot({
      'pnpm-lock.yaml': LOCKFILE.replace('a: 1.0.0', 'a: 1.0.1'),
      'node_modules/.pnpm/lock.yaml': LOCKFILE,
    });
    const result = runCli(root);
    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr.trimEnd().split('\n')).toEqual([
      `[deps:check] node_modules is out of sync with pnpm-lock.yaml — run: ${INSTALL_COMMAND}`,
    ]);
  });

  it('exits 1 with a single prefixed stderr line on a missing install', () => {
    const root = fixtureRoot({ 'pnpm-lock.yaml': LOCKFILE });
    const result = runCli(root);
    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr.trimEnd().split('\n')).toEqual([
      `[deps:check] node_modules is missing (no node_modules/.pnpm/lock.yaml) — run: ${INSTALL_COMMAND}`,
    ]);
  });

  it('exits 1 with a single prefixed stderr line when the lockfile copy is unreadable', () => {
    const root = fixtureRoot({ 'pnpm-lock.yaml': LOCKFILE });
    mkdirSync(join(root, 'node_modules', '.pnpm', 'lock.yaml'), { recursive: true });
    const result = runCli(root);
    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr.trimEnd().split('\n')).toEqual([
      `[deps:check] node_modules/.pnpm/lock.yaml could not be read (EISDIR) — run: ${INSTALL_COMMAND}`,
    ]);
  });
});
