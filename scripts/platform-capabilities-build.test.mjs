// @vitest-environment node
// @verify-changed-triggers: src/lib/utils/platform-capabilities.ts, vite.config.mjs
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { transformWithEsbuild } from 'vite';
import { afterEach, describe, expect, it, vi } from 'vitest';

const ELECTRON_UA = 'Mozilla/5.0 Chrome/136.0.0.0 Electron/36.4.0 Safari/537.36';
const CHROME_UA = 'Mozilla/5.0 Chrome/136.0.0.0 Safari/537.36';
const sourcePath = fileURLToPath(
  new URL('../src/lib/utils/platform-capabilities.ts', import.meta.url),
);

afterEach(() => vi.unstubAllEnvs());

describe('compiled preload detection without Node globals', () => {
  it.each([
    { target: 'web', expectsPreload: false },
    { target: 'electron', expectsPreload: true },
    { target: undefined, expectsPreload: true },
  ])('$target build preserves its preload contract', async ({ target, expectsPreload }) => {
    vi.stubEnv('INTENT_BUILD_TARGET', target);
    const { default: configure } = await import('../vite.config.mjs');
    const config = configure({ command: 'build', mode: 'production', isPreview: false });
    const { code } = await transformWithEsbuild(await readFile(sourcePath, 'utf8'), sourcePath, {
      loader: 'ts',
      format: 'cjs',
      define: {
        'process.env.INTENT_BUILD_TARGET': config.define['process.env.INTENT_BUILD_TARGET'],
      },
    });
    const context = { module: { exports: {} }, navigator: { userAgent: ELECTRON_UA }, window: {} };
    runInNewContext(code, context);
    const { expectsElectronPreloadBridge } = context.module.exports;

    expect(expectsElectronPreloadBridge()).toBe(expectsPreload);
    expect(expectsElectronPreloadBridge(ELECTRON_UA)).toBe(expectsPreload);
    expect(expectsElectronPreloadBridge(CHROME_UA)).toBe(false);
  });
});
