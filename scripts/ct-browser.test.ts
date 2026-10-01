// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { assertCtRuntime, assertCtSupplier, resolveCtBrowser } from './ct-browser.mjs';

const temporary: string[] = [];
afterEach(() =>
  temporary.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })),
);

function plan(env: Record<string, string> = {}, installed = false) {
  const output = execFileSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `
    import { resolveCtBrowser } from './scripts/ct-browser.mjs';
    console.log(JSON.stringify(resolveCtBrowser({ requireInstalled: ${installed} })));
  `,
    ],
    {
      cwd: resolve(__dirname, '..'),
      env: { ...process.env, ...env },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  return JSON.parse(output);
}

describe('CT browser supplier and provisioning identity', () => {
  it('resolves the exact independent supplier while keeping CT on 1.58.2', () => {
    const result = resolveCtBrowser({ requireInstalled: false });
    expect(result.identity).toEqual({
      runnerVersion: '1.58.2',
      supplierVersion: '1.63.0',
      chromiumVersion: '153.0.8010.12',
      revision: '1243',
    });
    expect(result.install.cliPath).toMatch(/playwright-core.*cli\.js$/);
    expect(result.install.args).toEqual(['install', 'chromium']);
    expect(result.osDeps.args).toEqual(['install-deps', '--dry-run', 'chromium']);
    expect(result.osDeps.cliPath).toBe(result.install.cliPath);
    expect(result.cacheKey).toBe('ct-1.58.2-pw-1.63.0-chromium-153.0.8010.12-r1243');
    expect(result.readinessMarker).toBe(join(result.cacheDir, `.with-deps-${result.cacheKey}`));
  });

  it('honors each runner cache and refuses an absent install without falling back', () => {
    const cache = mkdtempSync(join(os.tmpdir(), 'ct-browser-'));
    temporary.push(cache);
    const a = plan({ PLAYWRIGHT_BROWSERS_PATH: join(cache, 'slot-1') });
    const b = plan({ PLAYWRIGHT_BROWSERS_PATH: join(cache, 'slot-2') });
    expect(a.executablePath).toContain(join(cache, 'slot-1', 'chromium_headless_shell-1243'));
    expect(b.executablePath).toContain(join(cache, 'slot-2', 'chromium_headless_shell-1243'));
    expect(a.cacheKey).toBe(b.cacheKey);
    expect(() => plan({ PLAYWRIGHT_BROWSERS_PATH: join(cache, 'slot-1') }, true)).toThrow(
      /Missing CT browser.*--install-browsers/s,
    );
    mkdirSync(dirname(a.executablePath), { recursive: true });
    writeFileSync(a.executablePath, 'fake executable for resolution only', { mode: 0o755 });
    expect(plan({ PLAYWRIGHT_BROWSERS_PATH: join(cache, 'slot-1') }, true).executablePath).toBe(
      a.executablePath,
    );
  });

  it('honors relative and hermetic browser cache paths using the supplier registry', () => {
    const relative = plan({
      PLAYWRIGHT_BROWSERS_PATH: '.test-browser-cache',
      INIT_CWD: resolve(__dirname, '..'),
    });
    expect(relative.cacheDir).toBe(resolve(__dirname, '../.test-browser-cache'));
    const hermetic = plan({ PLAYWRIGHT_BROWSERS_PATH: '0' });
    expect(hermetic.cacheDir).toMatch(/playwright-core\/\.local-browsers$/);
    expect(hermetic.executablePath.startsWith(hermetic.cacheDir)).toBe(true);
  });

  it('selects the same pinned build for headed operation', () => {
    const result = resolveCtBrowser({ headless: false, requireInstalled: false });
    expect(result.executablePath).toContain('chromium-1243');
    expect(result.executablePath).not.toContain('chromium_headless_shell');
  });

  it('rejects a supplier package or manifest that disagrees with the pin', () => {
    expect(() => assertCtSupplier({ version: '1.62.1' }, [])).toThrow(/Wrong CT browser supplier/);
    expect(() =>
      assertCtSupplier({ version: '1.63.0' }, [
        { name: 'chromium', revision: '1242', browserVersion: '153.0.8010.12' },
      ]),
    ).toThrow(/Wrong CT chromium build/);
    expect(() =>
      assertCtSupplier({ version: '1.63.0' }, [
        { name: 'chromium', revision: '1243', browserVersion: '153.0.8010.12' },
      ]),
    ).toThrow(/Wrong CT chromium-headless-shell build/);
  });

  it.each(['Chrome/145.0.7632.6', 'Chrome/153.0.8010.11', '', 'Firefox/153.0.8010.12'])(
    'rejects actual runtime %s',
    (product) => {
      expect(() => assertCtRuntime({ product })).toThrow(/Wrong CT browser runtime/);
    },
  );

  it.each(['Chrome/153.0.8010.12', 'HeadlessChrome/153.0.8010.12'])(
    'accepts verified runtime %s',
    (product) => {
      expect(() => assertCtRuntime({ product })).not.toThrow();
    },
  );
});
