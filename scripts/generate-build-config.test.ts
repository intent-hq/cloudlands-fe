// @verify-changed-triggers: scripts/generate-build-config.cjs

import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const SCRIPT = 'generate-build-config.cjs';
const SCRIPTS_DIR = resolve(process.cwd(), 'scripts');

const temporaryPaths: string[] = [];

/** A bare package root (scripts/ + src/main/) with the generator copied in, so it writes under the fixture. */
function fixtureRoot() {
  const root = join(tmpdir(), `generate-build-config-test-${process.pid}-${temporaryPaths.length}`);
  mkdirSync(join(root, 'scripts'), { recursive: true });
  mkdirSync(join(root, 'src', 'main'), { recursive: true });
  temporaryPaths.push(root);
  copyFileSync(join(SCRIPTS_DIR, SCRIPT), join(root, 'scripts', SCRIPT));
  return root;
}

function outputPath(root: string) {
  return join(root, 'src', 'main', 'build-config.generated.ts');
}

function runGenerator(root: string, ...args: string[]) {
  const result = spawnSync(process.execPath, [join(root, 'scripts', SCRIPT), ...args], {
    cwd: root,
    encoding: 'utf8',
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

afterEach(() => {
  for (const path of temporaryPaths.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe('generate-build-config --if-missing', () => {
  it('creates the output when it is missing', () => {
    const root = fixtureRoot();
    expect(existsSync(outputPath(root))).toBe(false);

    const result = runGenerator(root, '--if-missing');

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Generated build config');
    expect(readFileSync(outputPath(root), 'utf8')).toContain('export const BUILD_CONFIG');
  });

  it('leaves an existing output untouched and prints nothing', () => {
    const root = fixtureRoot();
    expect(runGenerator(root).status).toBe(0);
    const before = readFileSync(outputPath(root), 'utf8');
    const mtime = statSync(outputPath(root)).mtimeMs;

    const result = runGenerator(root, '--if-missing');

    expect(result).toEqual({ status: 0, stdout: '', stderr: '' });
    expect(readFileSync(outputPath(root), 'utf8')).toBe(before);
    expect(statSync(outputPath(root)).mtimeMs).toBe(mtime);
  });

  it('still regenerates an existing output without the flag', async () => {
    const root = fixtureRoot();
    expect(runGenerator(root).status).toBe(0);
    const before = readFileSync(outputPath(root), 'utf8');
    await new Promise((done) => setTimeout(done, 20));

    const result = runGenerator(root);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Generated build config');
    expect(readFileSync(outputPath(root), 'utf8')).not.toBe(before);
  });
});
