import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  PARAGLIDE_INPUTS_HASH_FILE,
  canReuseGeneratedParaglide,
  compileWithInputsHash,
  ensureGeneratedParaglide,
  generateParaglide,
} from '../../scripts/paraglide-inputs-hash.mjs';

function readWsUrlDefine(mode: string, wsUrl: string): string {
  const configUrl = pathToFileURL(resolve('vite.config.mjs')).href;
  const script = `
    import createViteConfig from ${JSON.stringify(configUrl)};
    const config = createViteConfig({ mode: process.env.TEST_VITE_MODE });
    process.stdout.write(JSON.stringify(config.define));
  `;
  const output = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
    encoding: 'utf8',
    env: {
      ...process.env,
      INTENT_BUILD_TARGET: 'web',
      TEST_VITE_MODE: mode,
      VITE_INTENTD_WS_URL: wsUrl,
    },
  });
  return output;
}

/**
 * A throwaway package root that runs the real vite.config.mjs against fixture
 * i18n inputs and generated outputs, so the reuse decision never depends on the
 * state of the working tree's src/shared/paraglide.
 */
type FixturePaths = { projectDir: string; messagesDir: string; outdir: string };

function createParaglideFixtureRoot(): { root: string; paths: FixturePaths } {
  const root = mkdtempSync(join(tmpdir(), 'vite-paraglide-fixture-'));
  for (const shared of ['node_modules', 'scripts', 'package.json']) {
    symlinkSync(resolve(shared), join(root, shared));
  }
  copyFileSync(resolve('vite.config.mjs'), join(root, 'vite.config.mjs'));

  const paths = {
    projectDir: join(root, 'project.inlang'),
    messagesDir: join(root, 'messages'),
    outdir: join(root, 'src/shared/paraglide'),
  };
  for (const dir of Object.values(paths)) mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(paths.projectDir, 'settings.json'),
    JSON.stringify({ baseLocale: 'en', locales: ['en', 'ko'] }),
  );
  writeFileSync(join(paths.messagesDir, 'en.json'), JSON.stringify({ hello: 'Hello' }));
  writeFileSync(join(paths.messagesDir, 'ko.json'), JSON.stringify({ hello: '안녕하세요' }));
  writeFileSync(join(paths.outdir, 'messages.js'), 'export const m = {};\n');
  writeFileSync(join(paths.outdir, 'runtime.js'), 'export const baseLocale = "en";\n');
  return { root, paths };
}

function readPluginNames(uiPreview: boolean, configDir = resolve('.')): string[] {
  const configUrl = pathToFileURL(join(configDir, 'vite.config.mjs')).href;
  const script = `
    import createViteConfig from ${JSON.stringify(configUrl)};
    const config = createViteConfig({ command: 'serve', mode: 'development' });
    process.stdout.write(JSON.stringify(config.plugins.map((plugin) => plugin.name)));
  `;
  const output = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
    encoding: 'utf8',
    env: {
      ...process.env,
      INTENT_BUILD_TARGET: 'web',
      INTENT_UI_PREVIEW: uiPreview ? '1' : '0',
    },
  });
  return JSON.parse(output);
}

describe('production web Vite configuration', () => {
  it('does not expose the configured WebSocket URL through a static define', () => {
    const define = readWsUrlDefine(
      'production',
      'wss://user:password@daemon.example/rpc?token=build-secret#fragment',
    );

    expect(JSON.parse(define)['process.env.VITE_INTENTD_WS_URL']).toBe('""');
    expect(define).not.toContain('build-secret');
  });

  it('keeps the Vite URL fallback for local web development', () => {
    const define = JSON.parse(readWsUrlDefine('development', 'ws://127.0.0.1:5181/rpc'));

    expect(define['process.env.VITE_INTENTD_WS_URL']).toBe('"ws://127.0.0.1:5181/rpc"');
  });

  it('compiles messages with unplugin outside the UI preview', () => {
    expect(readPluginNames(false)).toContain('unplugin-paraglide-js');
  });
});

describe('generated Paraglide reuse in the UI preview', () => {
  const fixtures: string[] = [];
  afterEach(() => {
    for (const root of fixtures.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  // The fixture already holds generated outputs; a no-op compile records the
  // sidecar the way generate:i18n / watchChange do after a real compile.
  const recordSidecar = (paths: FixturePaths) =>
    compileWithInputsHash({ ...paths, compile: async () => {} });

  it('reuses generated messages only while the recorded input hash matches', async () => {
    const { root, paths } = createParaglideFixtureRoot();
    fixtures.push(root);

    expect(readPluginNames(true, root)).toContain('unplugin-paraglide-js');

    await expect(recordSidecar(paths)).resolves.toBe(true);
    expect(readPluginNames(true, root)).toContain('reuse-generated-paraglide');
    expect(readPluginNames(false, root)).toContain('unplugin-paraglide-js');

    // Touching an input without changing content must not invalidate the outputs.
    const koCatalog = join(paths.messagesDir, 'ko.json');
    writeFileSync(koCatalog, JSON.stringify({ hello: '안녕하세요' }));
    expect(readPluginNames(true, root)).toContain('reuse-generated-paraglide');

    writeFileSync(koCatalog, JSON.stringify({ hello: '안녕' }));
    expect(readPluginNames(true, root)).toContain('unplugin-paraglide-js');
  });

  it('requires both the sidecar and the generated outputs', async () => {
    const { root, paths } = createParaglideFixtureRoot();
    fixtures.push(root);

    expect(canReuseGeneratedParaglide(paths)).toBe(false);
    await recordSidecar(paths);
    expect(canReuseGeneratedParaglide(paths)).toBe(true);

    writeFileSync(
      join(paths.projectDir, 'settings.json'),
      JSON.stringify({ baseLocale: 'en', locales: ['en', 'ko', 'fr'] }),
    );
    expect(canReuseGeneratedParaglide(paths)).toBe(false);

    await recordSidecar(paths);
    rmSync(join(paths.outdir, 'runtime.js'));
    expect(canReuseGeneratedParaglide(paths)).toBe(false);

    writeFileSync(join(paths.outdir, 'runtime.js'), 'export const baseLocale = "en";\n');
    writeFileSync(join(paths.outdir, PARAGLIDE_INPUTS_HASH_FILE), '');
    expect(canReuseGeneratedParaglide(paths)).toBe(false);
  });

  it('does not record a sidecar when an input changes while compiling', async () => {
    const { root, paths } = createParaglideFixtureRoot();
    fixtures.push(root);
    const sidecar = join(paths.outdir, PARAGLIDE_INPUTS_HASH_FILE);
    const koCatalog = join(paths.messagesDir, 'ko.json');
    await recordSidecar(paths);
    expect(existsSync(sidecar)).toBe(true);

    // The compiler read the old ko.json; the edit lands before it finishes
    // writing, so the outputs may or may not reflect it.
    const racedCompile = async () => {
      writeFileSync(join(paths.outdir, 'messages.js'), 'export const m = { stale: true };\n');
      writeFileSync(koCatalog, JSON.stringify({ hello: '안녕' }));
    };
    await expect(compileWithInputsHash({ ...paths, compile: racedCompile })).resolves.toBe(false);
    expect(existsSync(sidecar)).toBe(false);
    expect(canReuseGeneratedParaglide(paths)).toBe(false);

    // A content-preserving rewrite mid-compile is not a change.
    const touchingCompile = async () => {
      writeFileSync(koCatalog, JSON.stringify({ hello: '안녕' }));
    };
    await expect(compileWithInputsHash({ ...paths, compile: touchingCompile })).resolves.toBe(true);
    expect(canReuseGeneratedParaglide(paths)).toBe(true);
  });

  it('generate:i18n retries a raced compile and gives up after the attempt budget', async () => {
    const { root, paths } = createParaglideFixtureRoot();
    fixtures.push(root);
    const koCatalog = join(paths.messagesDir, 'ko.json');

    let attempts = 0;
    const settlesOnSecondRun = async () => {
      attempts += 1;
      if (attempts === 1) writeFileSync(koCatalog, JSON.stringify({ hello: '안녕' }));
    };
    await expect(generateParaglide({ ...paths, compile: settlesOnSecondRun })).resolves.toBe(true);
    expect(attempts).toBe(2);
    expect(canReuseGeneratedParaglide(paths)).toBe(true);

    let edits = 0;
    const neverSettles = async () => {
      edits += 1;
      writeFileSync(koCatalog, JSON.stringify({ hello: `edit ${edits}` }));
    };
    await expect(
      generateParaglide({ ...paths, compile: neverSettles, maxAttempts: 2 }),
    ).resolves.toBe(false);
    expect(edits).toBe(2);
    expect(canReuseGeneratedParaglide(paths)).toBe(false);
  });

  it('generate:i18n --if-stale compiles only while the outputs are missing or stale', async () => {
    const { root, paths } = createParaglideFixtureRoot();
    fixtures.push(root);
    let compiles = 0;
    const compile = async () => {
      compiles += 1;
    };

    // No sidecar yet: the outputs cannot be trusted, so the first run compiles.
    await expect(ensureGeneratedParaglide({ ...paths, ifStale: true, compile })).resolves.toBe(
      true,
    );
    expect(compiles).toBe(1);
    await expect(ensureGeneratedParaglide({ ...paths, ifStale: true, compile })).resolves.toBe(
      true,
    );
    expect(compiles).toBe(1);

    writeFileSync(join(paths.messagesDir, 'ko.json'), JSON.stringify({ hello: '안녕' }));
    await expect(ensureGeneratedParaglide({ ...paths, ifStale: true, compile })).resolves.toBe(
      true,
    );
    expect(compiles).toBe(2);

    rmSync(join(paths.outdir, 'messages.js'));
    await expect(ensureGeneratedParaglide({ ...paths, ifStale: true, compile })).resolves.toBe(
      true,
    );
    expect(compiles).toBe(3);

    // Without the flag, generate:i18n always compiles.
    await expect(ensureGeneratedParaglide({ ...paths, compile })).resolves.toBe(true);
    expect(compiles).toBe(4);
  });
});
