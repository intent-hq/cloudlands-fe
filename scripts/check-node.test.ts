// @verify-changed-triggers: package.json
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  REMEDIATION_HINT,
  REPO_ROOT,
  checkNodeSupport,
  readNodeRange,
  satisfiesNodeRange,
  unsupportedNodeMessage,
} from './check-node.mjs';

const SCRIPTS_DIR = resolve(process.cwd(), 'scripts');
const RANGE = '^22.22.2 || ^24.15.0 || >=26';

const temporaryPaths: string[] = [];

function fixtureRoot(files: Record<string, string>) {
  const root = join(tmpdir(), `check-node-test-${process.pid}-${temporaryPaths.length}`);
  mkdirSync(root, { recursive: true });
  temporaryPaths.push(root);
  for (const [file, content] of Object.entries(files)) writeFileSync(join(root, file), content);
  return root;
}

afterEach(() => {
  for (const path of temporaryPaths.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe('satisfiesNodeRange', () => {
  it.each([
    ['20.19.0', false],
    ['22.22.1', false],
    ['22.22.2', true],
    ['22.23.2', true],
    ['23.11.0', false],
    ['24.14.9', false],
    ['24.15.0', true],
    ['24.19.0', true],
    ['25.9.0', false],
    ['26.0.0', true],
    ['27.1.0', true],
  ])('decides %s against the supported range → %s', (version, expected) => {
    expect(satisfiesNodeRange(version, RANGE)).toBe(expected);
  });

  it('accepts a leading v and ignores prerelease/build suffixes', () => {
    expect(satisfiesNodeRange('v24.15.0', RANGE)).toBe(true);
    expect(satisfiesNodeRange('26.0.0-nightly20260901', RANGE)).toBe(true);
    expect(satisfiesNodeRange('24.14.9+build', RANGE)).toBe(false);
  });

  it('supports >= clauses with one, two, or three components', () => {
    expect(satisfiesNodeRange('24.0.0', '>=24')).toBe(true);
    expect(satisfiesNodeRange('23.99.99', '>=24')).toBe(false);
    expect(satisfiesNodeRange('24.15.0', '>=24.15')).toBe(true);
    expect(satisfiesNodeRange('24.14.9', '>=24.15')).toBe(false);
    expect(satisfiesNodeRange('24.15.0', '>=24.15.1')).toBe(false);
  });

  it('rejects clauses outside the ^X.Y.Z / >=X grammar instead of admitting every version', () => {
    expect(() => satisfiesNodeRange('24.15.0', '~24.15.0')).toThrow(
      /unsupported engines.node clause/,
    );
    expect(() => satisfiesNodeRange('24.15.0', '^24')).toThrow(/unsupported engines.node clause/);
    expect(() => satisfiesNodeRange('24.15.0', '24.x')).toThrow(/unsupported engines.node clause/);
    expect(() => satisfiesNodeRange('24.15.0', '')).toThrow(/range is empty/);
    expect(() => satisfiesNodeRange('twenty-four', RANGE)).toThrow(/invalid Node version/);
  });
});

describe('readNodeRange', () => {
  it('returns the exact engines.node string committed in package.json', () => {
    expect(readNodeRange(REPO_ROOT)).toBe(RANGE);
  });

  it('fails loudly when engines.node is missing or blank', () => {
    expect(() => readNodeRange(fixtureRoot({ 'package.json': '{}' }))).toThrow(
      /declares no engines.node range/,
    );
    const blank = fixtureRoot({ 'package.json': JSON.stringify({ engines: { node: ' ' } }) });
    expect(() => readNodeRange(blank)).toThrow(/declares no engines.node range/);
  });
});

describe('checkNodeSupport', () => {
  it('passes a supported version silently', () => {
    const root = fixtureRoot({ 'package.json': JSON.stringify({ engines: { node: RANGE } }) });
    expect(checkNodeSupport({ root, version: '24.15.0' })).toEqual({
      ok: true,
      version: '24.15.0',
      range: RANGE,
      reason: null,
    });
  });

  it('reports one line naming the version, the range, and the doctor/bootstrap hint', () => {
    const root = fixtureRoot({ 'package.json': JSON.stringify({ engines: { node: RANGE } }) });
    const result = checkNodeSupport({ root, version: 'v20.19.0' });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe(
      `Unsupported Node v20.19.0 — cloudlands-fe requires Node ${RANGE} (from the monorepo root run: make doctor, then make bootstrap-dev-host).`,
    );
    expect(result.reason).toBe(unsupportedNodeMessage('20.19.0', RANGE));
    expect(result.reason).toContain(REMEDIATION_HINT);
    expect(result.reason).not.toContain('\n');
  });

  it('checks the running Node against the committed range by default', () => {
    expect(checkNodeSupport()).toMatchObject({
      ok: true,
      version: process.versions.node,
      range: RANGE,
    });
  });
});

describe('check-node CLI', () => {
  function runCli(root: string) {
    mkdirSync(join(root, 'scripts'), { recursive: true });
    copyFileSync(join(SCRIPTS_DIR, 'check-node.mjs'), join(root, 'scripts', 'check-node.mjs'));
    const result = spawnSync(process.execPath, [join(root, 'scripts', 'check-node.mjs')], {
      cwd: root,
      encoding: 'utf8',
    });
    return { status: result.status, stdout: result.stdout, stderr: result.stderr };
  }

  it('exits 0 silently when the running Node satisfies engines.node', () => {
    const root = fixtureRoot({
      'package.json': JSON.stringify({ engines: { node: `>=${process.versions.node}` } }),
    });
    expect(runCli(root)).toEqual({ status: 0, stdout: '', stderr: '' });
  });

  it('exits 1 with exactly one stderr line when the running Node is unsupported', () => {
    const range = `>=${Number(process.versions.node.split('.')[0]) + 1}`;
    const root = fixtureRoot({ 'package.json': JSON.stringify({ engines: { node: range } }) });
    const result = runCli(root);
    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr.trimEnd().split('\n')).toEqual([
      unsupportedNodeMessage(process.versions.node, range),
    ]);
  });
});
