import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  PARAGLIDE_INPUTS_HASH_FILE,
  canReuseGeneratedParaglide,
  writeParaglideInputsHash,
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
function createParaglideFixtureRoot(): {
  root: string;
  paths: { projectDir: string; messagesDir: string; outdir: string };
} {
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

  it('reuses generated messages only while the recorded input hash matches', () => {
    const { root, paths } = createParaglideFixtureRoot();
    fixtures.push(root);

    expect(readPluginNames(true, root)).toContain('unplugin-paraglide-js');

    writeParaglideInputsHash(paths);
    expect(readPluginNames(true, root)).toContain('reuse-generated-paraglide');
    expect(readPluginNames(false, root)).toContain('unplugin-paraglide-js');

    // Touching an input without changing content must not invalidate the outputs.
    const koCatalog = join(paths.messagesDir, 'ko.json');
    writeFileSync(koCatalog, JSON.stringify({ hello: '안녕하세요' }));
    expect(readPluginNames(true, root)).toContain('reuse-generated-paraglide');

    writeFileSync(koCatalog, JSON.stringify({ hello: '안녕' }));
    expect(readPluginNames(true, root)).toContain('unplugin-paraglide-js');
  });

  it('requires both the sidecar and the generated outputs', () => {
    const { root, paths } = createParaglideFixtureRoot();
    fixtures.push(root);

    expect(canReuseGeneratedParaglide(paths)).toBe(false);
    writeParaglideInputsHash(paths);
    expect(canReuseGeneratedParaglide(paths)).toBe(true);

    writeFileSync(
      join(paths.projectDir, 'settings.json'),
      JSON.stringify({ baseLocale: 'en', locales: ['en', 'ko', 'fr'] }),
    );
    expect(canReuseGeneratedParaglide(paths)).toBe(false);

    writeParaglideInputsHash(paths);
    rmSync(join(paths.outdir, 'runtime.js'));
    expect(canReuseGeneratedParaglide(paths)).toBe(false);

    writeFileSync(join(paths.outdir, 'runtime.js'), 'export const baseLocale = "en";\n');
    writeFileSync(join(paths.outdir, PARAGLIDE_INPUTS_HASH_FILE), '');
    expect(canReuseGeneratedParaglide(paths)).toBe(false);
  });
});
