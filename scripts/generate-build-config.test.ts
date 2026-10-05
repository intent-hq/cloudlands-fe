// @verify-changed-triggers: scripts/generate-build-config.cjs, package.json, scripts/pnpm-run.mjs, scripts/pnpm-launcher.mjs, scripts/type-check.ts, vitest.config.ts, tests/integration/vitest.integration.config.ts
// @vitest-environment node

import { execFileSync, spawnSync } from 'node:child_process';
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
import { generatedBuildConfigPlugin } from '../vitest.config';

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

describe('cold unit configuration', () => {
  it('generates the actual main-process input before unit imports and preserves an existing identity', () => {
    const root = fixtureRoot();
    vi.stubEnv('INTENT_ISOLATED_TEST_BUILD_ID', 'manual-123-1');
    vi.stubEnv('INTENT_ISOLATED_TEST_BACKEND_SHA', 'a'.repeat(40));
    const plugin = generatedBuildConfigPlugin({ rootDir: root });
    expect(existsSync(outputPath(root))).toBe(false);
    plugin.buildStart();
    const original = readFileSync(outputPath(root), 'utf8');
    expect(original).toContain('manual-123-1');
    vi.stubEnv('INTENT_ISOLATED_TEST_BUILD_ID', 'manual-456-1');
    plugin.buildStart();
    expect(readFileSync(outputPath(root), 'utf8')).toBe(original);
  });

  it('fails unit preparation when the original build identity cannot be generated', () => {
    const root = fixtureRoot();
    vi.stubEnv('INTENT_ISOLATED_TEST_BUILD_ID', 'manual-123-1');
    vi.stubEnv('INTENT_ISOLATED_TEST_BACKEND_SHA', '');
    expect(() => generatedBuildConfigPlugin({ rootDir: root }).buildStart()).toThrow();
    expect(existsSync(outputPath(root))).toBe(false);
  });
});

describe.each([
  ['lint:dead-code', 'check-dead-code.mjs'],
  ['check', 'run-svelte-check.mjs'],
])('cold %s gate', (command, scanner) => {
  function scannerRoot() {
    const root = fixtureRoot();
    symlinkSync(resolve(process.cwd(), 'node_modules'), join(root, 'node_modules'), 'junction');
    const { scripts } = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8'));
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({
        name: 'cold-check-fixture',
        private: true,
        type: 'module',
        scripts: { [command]: scripts[command] },
      }),
    );
    // The scanners are independent of this prerequisite: require their generated
    // input at the scanner boundary and record whether scanning was reached.
    writeFileSync(join(root, 'scripts', 'paraglide-inputs-hash.mjs'), '');
    writeFileSync(join(root, 'scripts', 'check-deps-fresh.mjs'), '');
    writeFileSync(
      join(root, 'scripts', scanner),
      "import { readFileSync, writeFileSync } from 'node:fs';\n" +
        "import { runInNewContext } from 'node:vm';\n" +
        "import ts from 'typescript';\n" +
        "writeFileSync('scanner-started', '1');\n" +
        "const input = readFileSync('src/main/build-config.generated.ts', 'utf8');\n" +
        'const emitted = ts.transpileModule(input, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;\n' +
        'const exports = {};\n' +
        'runInNewContext(emitted, { exports });\n' +
        "writeFileSync('scanner-result.json', JSON.stringify(exports.BUILD_CONFIG));\n",
    );
    return root;
  }

  it('prepares the cold check and preserves the baked identity on another scan', () => {
    const root = scannerRoot();
    vi.stubEnv('INTENT_ISOLATED_TEST_BUILD_ID', 'manual-123-1');
    vi.stubEnv('INTENT_ISOLATED_TEST_BACKEND_SHA', 'a'.repeat(40));
    const scan = () =>
      spawnSync('pnpm', ['run', command], {
        cwd: root,
        encoding: 'utf8',
        env: { ...process.env, NODE_COMPILE_CACHE: join(root, 'node-compile-cache') },
      });
    expect(existsSync(outputPath(root))).toBe(false);
    const cold = scan();
    expect(cold.status, cold.stdout + cold.stderr).toBe(0);
    const observed = () => JSON.parse(readFileSync(join(root, 'scanner-result.json'), 'utf8'));
    const expectedIdentity = {
      ISOLATED_TEST_BUILD_ID: 'manual-123-1',
      ISOLATED_TEST_BACKEND_SHA: 'a'.repeat(40),
    };
    expect(observed()).toMatchObject(expectedIdentity);
    vi.stubEnv('INTENT_ISOLATED_TEST_BUILD_ID', 'manual-456-1');
    const warm = scan();
    expect(warm.status, warm.stdout + warm.stderr).toBe(0);
    expect(observed()).toMatchObject(expectedIdentity);
  });

  it('rejects an incomplete identity before running the scanner', () => {
    const root = scannerRoot();
    vi.stubEnv('INTENT_ISOLATED_TEST_BUILD_ID', 'manual-123-1');
    vi.stubEnv('INTENT_ISOLATED_TEST_BACKEND_SHA', '');
    const result = spawnSync('pnpm', ['run', command], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, NODE_COMPILE_CACHE: join(root, 'node-compile-cache') },
    });
    expect(result.status).not.toBe(0);
    expect(existsSync(outputPath(root))).toBe(false);
    expect(existsSync(join(root, 'scanner-started'))).toBe(false);
    expect(existsSync(join(root, 'scanner-result.json'))).toBe(false);
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

describe('generate-build-config --if-stale', () => {
  function config(root: string) {
    const emitted = ts.transpileModule(readFileSync(outputPath(root), 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS },
    }).outputText;
    const exports: { BUILD_CONFIG?: Record<string, string> } = {};
    runInNewContext(emitted, { exports });
    return exports.BUILD_CONFIG!;
  }

  it('creates missing output and repairs the historical single-field shape', () => {
    const root = fixtureRoot();
    expect(runGenerator(root, '--if-stale').status).toBe(0);
    expect(config(root)).toMatchObject({
      ISOLATED_TEST_BUILD_ID: '',
      ISOLATED_TEST_BACKEND_SHA: '',
    });
    writeFileSync(
      outputPath(root),
      'export const BUILD_CONFIG = { GIT_COMMIT_HASH: "1515d8f61" } as const;',
    );
    expect(runGenerator(root, '--if-stale').status).toBe(0);
    expect(config(root)).toMatchObject({
      ISOLATED_TEST_BUILD_ID: '',
      ISOLATED_TEST_BACKEND_SHA: '',
    });
  });

  it('keeps fresh bytes and mtime including the original timestamp', () => {
    const root = fixtureRoot();
    expect(runGenerator(root, '--if-stale').status).toBe(0);
    const before = readFileSync(outputPath(root), 'utf8');
    const mtime = statSync(outputPath(root)).mtimeMs;
    expect(runGenerator(root, '--if-stale').status).toBe(0);
    expect(readFileSync(outputPath(root), 'utf8')).toBe(before);
    expect(statSync(outputPath(root)).mtimeMs).toBe(mtime);
  });

  it('refreshes when generator identity changes even if its config values do not', () => {
    const root = fixtureRoot();
    expect(runGenerator(root, '--if-stale').status).toBe(0);
    const before = readFileSync(outputPath(root), 'utf8');
    const script = join(root, 'scripts', SCRIPT);
    writeFileSync(
      script,
      readFileSync(script, 'utf8') + '\n// Revised generator schema identity\n',
    );
    expect(runGenerator(root, '--if-stale').status).toBe(0);
    const changed = readFileSync(outputPath(root), 'utf8');
    const stable = (text: string) => text.replace(/^ \* Generated at: .*$/m, '');
    expect(stable(changed)).not.toBe(stable(before));
    expect(runGenerator(root, '--if-stale').status).toBe(0);
    expect(readFileSync(outputPath(root), 'utf8')).toBe(changed);
  });

  it('refreshes actual isolated inputs and clears them for an ordinary build', () => {
    const root = fixtureRoot();
    expect(runGenerator(root, '--if-stale').status).toBe(0);
    vi.stubEnv('INTENT_ISOLATED_TEST_BUILD_ID', 'manual-123-1');
    vi.stubEnv('INTENT_ISOLATED_TEST_BACKEND_SHA', 'a'.repeat(40));
    expect(runGenerator(root, '--if-stale').status).toBe(0);
    expect(config(root)).toMatchObject({
      ISOLATED_TEST_BUILD_ID: 'manual-123-1',
      ISOLATED_TEST_BACKEND_SHA: 'a'.repeat(40),
    });
    vi.stubEnv('INTENT_ISOLATED_TEST_BACKEND_SHA', 'b'.repeat(40));
    expect(runGenerator(root, '--if-stale').status).toBe(0);
    expect(config(root).ISOLATED_TEST_BACKEND_SHA).toBe('b'.repeat(40));
    vi.stubEnv('INTENT_ISOLATED_TEST_BUILD_ID', '');
    vi.stubEnv('INTENT_ISOLATED_TEST_BACKEND_SHA', '');
    expect(runGenerator(root, '--if-stale').status).toBe(0);
    expect(config(root)).toMatchObject({
      ISOLATED_TEST_BUILD_ID: '',
      ISOLATED_TEST_BACKEND_SHA: '',
    });
  });

  it('refreshes the current Git commit input', () => {
    const root = fixtureRoot();
    const git = (...args: string[]) =>
      execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
    git('init', '-q');
    git(
      '-c',
      'user.name=Fixture',
      '-c',
      'user.email=fixture@example.com',
      'commit',
      '--allow-empty',
      '-qm',
      'first',
    );
    expect(runGenerator(root, '--if-stale').status).toBe(0);
    const original = config(root).GIT_COMMIT_HASH;
    git(
      '-c',
      'user.name=Fixture',
      '-c',
      'user.email=fixture@example.com',
      'commit',
      '--allow-empty',
      '-qm',
      'second',
    );
    expect(runGenerator(root, '--if-stale').status).toBe(0);
    expect(config(root).GIT_COMMIT_HASH).toBe(git('rev-parse', '--short', 'HEAD'));
    expect(config(root).GIT_COMMIT_HASH).not.toBe(original);
  });

  it('rejects invalid current inputs even when generated output already exists', () => {
    const root = fixtureRoot();
    expect(runGenerator(root, '--if-stale').status).toBe(0);
    const before = readFileSync(outputPath(root), 'utf8');
    vi.stubEnv('INTENT_ISOLATED_TEST_BUILD_ID', 'manual-123-1');
    vi.stubEnv('INTENT_ISOLATED_TEST_BACKEND_SHA', '');
    expect(runGenerator(root, '--if-stale').status).not.toBe(0);
    expect(readFileSync(outputPath(root), 'utf8')).toBe(before);
  });
});
