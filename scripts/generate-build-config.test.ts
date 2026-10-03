// @verify-changed-triggers: scripts/generate-build-config.cjs, package.json, scripts/pnpm-run.mjs, scripts/pnpm-launcher.mjs, scripts/type-check.ts

import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { afterEach, describe, expect, it, vi } from 'vitest';

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
  vi.unstubAllEnvs();
  for (const path of temporaryPaths.splice(0)) rmSync(path, { recursive: true, force: true });
});

it('bakes an exact isolated identity only from the build environment', () => {
  const root = fixtureRoot();
  vi.stubEnv('INTENT_ISOLATED_TEST_BUILD_ID', 'manual-123-1');
  vi.stubEnv('INTENT_ISOLATED_TEST_BACKEND_SHA', 'a'.repeat(40));
  expect(runGenerator(root).status).toBe(0);
  const emitted = ts.transpileModule(readFileSync(outputPath(root), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText;
  const exports: Record<string, unknown> = {};
  runInNewContext(emitted, { exports });
  expect(exports.BUILD_CONFIG).toMatchObject({
    ISOLATED_TEST_BUILD_ID: 'manual-123-1',
    ISOLATED_TEST_BACKEND_SHA: 'a'.repeat(40),
  });
});

it.each([
  ['manual-123-1', ''],
  ['', 'a'.repeat(40)],
  ['../normal', 'a'.repeat(40)],
  ['manual-123-1', 'main'],
])('rejects incomplete or ambiguous isolated build identity %s / %s', (id, sha) => {
  const root = fixtureRoot();
  vi.stubEnv('INTENT_ISOLATED_TEST_BUILD_ID', id);
  vi.stubEnv('INTENT_ISOLATED_TEST_BACKEND_SHA', sha);
  expect(runGenerator(root).status).not.toBe(0);
  expect(existsSync(outputPath(root))).toBe(false);
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

describe('cold prebuild configuration', () => {
  function prebuildRoot(source: string) {
    const root = fixtureRoot();
    for (const script of ['pnpm-run.mjs', 'pnpm-launcher.mjs', 'type-check.ts']) {
      copyFileSync(join(SCRIPTS_DIR, script), join(root, 'scripts', script));
    }
    symlinkSync(resolve(process.cwd(), 'node_modules'), join(root, 'node_modules'), 'junction');
    const { scripts } = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8'));
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({
        name: 'cold-prebuild-fixture',
        private: true,
        type: 'module',
        scripts: {
          prebuild: scripts.prebuild,
          'generate:build-config': scripts['generate:build-config'],
          'type-check:quiet': scripts['type-check:quiet'],
          // Catalog and IPC generation are independent of this compiler input.
          'generate:i18n': 'node -e ""',
          'generate:ipc-types': 'node -e ""',
        },
      }),
    );
    writeFileSync(
      join(root, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          strict: true,
          noEmit: true,
          skipLibCheck: true,
          target: 'ES2022',
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
          types: [],
        },
        files: ['probe.ts'],
      }),
    );
    writeFileSync(join(root, 'probe.ts'), source);
    return root;
  }

  it.each([
    ['normal', '', ''],
    ['isolated', 'manual-123-1', 'a'.repeat(40)],
  ])('type-checks a cold %s build using its generated configuration', (_mode, id, sha) => {
    vi.stubEnv('INTENT_ISOLATED_TEST_BUILD_ID', id);
    vi.stubEnv('INTENT_ISOLATED_TEST_BACKEND_SHA', sha);
    const root = prebuildRoot(
      "import { BUILD_CONFIG } from './src/main/build-config.generated.js';\n" +
        'const identity: string = BUILD_CONFIG.ISOLATED_TEST_BUILD_ID;\n' +
        'const backend: string = BUILD_CONFIG.ISOLATED_TEST_BACKEND_SHA;\n',
    );
    expect(existsSync(outputPath(root))).toBe(false);

    const result = spawnSync('pnpm', ['run', 'prebuild'], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, NODE_COMPILE_CACHE: join(root, 'node-compile-cache') },
    });

    expect(result.status, result.stdout + result.stderr).toBe(0);
    const emitted = ts.transpileModule(readFileSync(outputPath(root), 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS },
    }).outputText;
    const exports: Record<string, unknown> = {};
    runInNewContext(emitted, { exports });
    expect(exports.BUILD_CONFIG).toMatchObject({
      ISOLATED_TEST_BUILD_ID: id,
      ISOLATED_TEST_BACKEND_SHA: sha,
    });
  });

  it('still rejects a compiler error after generating the cold input', () => {
    vi.stubEnv('INTENT_ISOLATED_TEST_BUILD_ID', '');
    vi.stubEnv('INTENT_ISOLATED_TEST_BACKEND_SHA', '');
    const root = prebuildRoot(
      "import { BUILD_CONFIG } from './src/main/build-config.generated.js';\n" +
        'const invalid: number = BUILD_CONFIG.ISOLATED_TEST_BUILD_ID;\n',
    );

    const result = spawnSync('pnpm', ['run', 'prebuild'], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, NODE_COMPILE_CACHE: join(root, 'node-compile-cache') },
    });

    expect(existsSync(outputPath(root))).toBe(true);
    expect(result.status).toBe(1);
  });
});
