// @verify-changed-triggers: scripts/type-check.ts, package.json
// @vitest-environment node

import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const TSX_CLI = createRequire(import.meta.url).resolve('tsx/cli');
const temporaryPaths: string[] = [];

function write(root: string, path: string, content: string) {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), content);
}

function tsconfig(files: string[]) {
  return JSON.stringify({
    compilerOptions: { strict: true, skipLibCheck: true, target: 'ES2022', types: [] },
    files,
  });
}

/**
 * The three app programs in miniature. The main and preload programs include a file that
 * only their generator creates, so a check that skips generation fails with TS6053.
 */
function fixtureRoot() {
  const root = mkdtempSync(join(tmpdir(), 'type-check-test-'));
  temporaryPaths.push(root);
  mkdirSync(join(root, 'scripts'));
  copyFileSync(resolve('scripts/type-check.ts'), join(root, 'scripts/type-check.ts'));
  symlinkSync(resolve('node_modules'), join(root, 'node_modules'), 'junction');
  write(root, 'package.json', JSON.stringify({ type: 'module' }));
  write(
    root,
    'scripts/generate-build-config.cjs',
    "require('fs').writeFileSync('src/main/build-config.generated.ts', 'export const BUILD_CONFIG = {};\\n');\n",
  );
  write(
    root,
    'scripts/inline-ipc-channels.ts',
    "import { writeFileSync } from 'fs';\nwriteFileSync('src/preload/index.ts', 'export const channels: string[] = [];\\n');\n",
  );
  write(root, 'tsconfig.json', tsconfig(['src/renderer/app.ts']));
  write(
    root,
    'tsconfig.main.json',
    tsconfig(['src/main/index.ts', 'src/main/build-config.generated.ts']),
  );
  write(root, 'tsconfig.preload.json', tsconfig(['src/preload/bridge.ts', 'src/preload/index.ts']));
  write(root, 'src/renderer/app.ts', 'export const app = 1;\n');
  write(root, 'src/main/index.ts', 'export const main = 1;\n');
  write(root, 'src/preload/bridge.ts', 'export const bridge = 1;\n');
  return root;
}

function typeCheck(root: string, ...args: string[]) {
  return spawnSync(process.execPath, [TSX_CLI, 'scripts/type-check.ts', ...args], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, NODE_COMPILE_CACHE: join(root, 'node-compile-cache') },
  });
}

afterEach(() => {
  for (const path of temporaryPaths.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe('type-check', { timeout: 60_000 }, () => {
  it('generates inputs and passes a clean tree silently in quiet mode', () => {
    const result = typeCheck(fixtureRoot(), '--quiet');
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(result.stdout + result.stderr).toBe('');
  });

  it.each([
    ['renderer', 'src/renderer/app.ts'],
    ['main', 'src/main/index.ts'],
    ['preload', 'src/preload/bridge.ts'],
  ])('fails on a %s type error and prints it in quiet mode', (name, file) => {
    const root = fixtureRoot();
    write(root, file, "export const broken: number = 'text';\n");
    const result = typeCheck(root, '--quiet');
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(file);
    expect(result.stderr).toContain('TS2322');
    expect(result.stderr).toContain(`Type check failed: ${name}`);
  });

  it('checks only the selected program with --project', () => {
    const root = fixtureRoot();
    write(root, 'src/main/index.ts', "export const broken: number = 'text';\n");
    const result = typeCheck(root, '--project=renderer');
    expect(result.status, result.stdout + result.stderr).toBe(0);
  });

  it.each([['--project=web'], ['--project'], ['validate']])('rejects %s', (arg) => {
    const result = typeCheck(fixtureRoot(), arg);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('Usage:');
  });
});
