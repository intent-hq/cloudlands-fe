// @vitest-environment node
// @verify-changed-triggers: vite.config.mjs, scripts/build-i18n-bundle.mjs, scripts/i18n-used-message-keys.mjs, messages/*.json, src/**/*.svelte, src/**/*.ts
import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runInNewContext } from 'node:vm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { build } from 'vite';
import { defaultTestTimeoutMs } from '../../scripts/vitest-timeouts.mjs';

let root;
let bundledMessages;
let consumer;
let config;

// The setup scans every file under src/ for message keys and runs the i18n bundler
// and a Vite production build, far more work than the default hook budget assumes.
// At host load average 50-70 it took ~75 s and hit the 30 s local default three
// times in a row, which stopped verify:changed before its later checks. Ten
// default budgets (300 s locally, 600 s on CI) leave ~4x headroom over that.
const SETUP_BUDGET_MS = defaultTestTimeoutMs() * 10;

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'production-i18n-'));
  // Exercise the real scanner and bundler without overwriting a concurrent app build.
  for (const name of ['node_modules', 'scripts', 'src', 'messages', 'package.json']) {
    symlinkSync(resolve(name), join(root, name));
  }
  mkdirSync(join(root, 'build-script'));
  const bundler = join(root, 'build-script/build-i18n-bundle.mjs');
  copyFileSync(resolve('scripts/build-i18n-bundle.mjs'), bundler);
  copyFileSync(
    resolve('scripts/i18n-used-message-keys.mjs'),
    join(root, 'build-script/i18n-used-message-keys.mjs'),
  );
  execFileSync(process.execPath, [bundler], { cwd: root, stdio: 'pipe' });
  bundledMessages = readFileSync(join(root, 'static/generated/paraglide.js'), 'utf8');

  copyFileSync(resolve('vite.config.mjs'), join(root, 'vite.config.mjs'));
  const { default: configure } = await import(pathToFileURL(join(root, 'vite.config.mjs')).href);
  config = configure({ command: 'build', mode: 'production' });
  const result = await buildConsumer(
    'entry.mjs',
    `
    import { m } from '$shared/paraglide/messages.js';
    import * as messages from '$shared/paraglide/messages.js';
    export const objectLabel = (locale) => m.ui_menu_actions_ariaLabel({}, { locale });
    export const namespaceLabel = (locale) => messages.ui_menu_actions_ariaLabel({}, { locale });
    // Shapes with no \`m.<key>\` text on one line, which a source regex misses.
    const { ui_menu_actions_ariaLabel: destructured } = m;
    export const destructuredLabel = (locale) => destructured({}, { locale });
    export const splitLabel = (locale) =>
      m
        .ui_menu_actions_ariaLabel({}, { locale });
  `,
  );
  const context = {};
  runInNewContext(bundledMessages, context);
  runInNewContext(result[0].output.find((output) => output.type === 'chunk').code, context);
  consumer = context.Consumer;
}, SETUP_BUDGET_MS);

/** Production-builds `source` with the real Paraglide plugin against the prebuilt bundle. */
function buildConsumer(name, source) {
  const entry = join(root, name);
  writeFileSync(entry, source);
  return build({
    configFile: false,
    root,
    logLevel: 'silent',
    plugins: config.plugins.filter((plugin) => plugin.name === 'use-production-paraglide-bundle'),
    build: {
      ...config.build,
      write: false,
      sourcemap: false,
      minify: 'esbuild',
      lib: { entry, formats: ['iife'], name: 'Consumer' },
    },
  });
}

afterAll(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

describe('production Paraglide module contract', () => {
  for (const locale of ['en', 'fr']) {
    it(`preserves the message-object import in ${locale}`, () => {
      const catalog = JSON.parse(readFileSync(resolve(`messages/${locale}.json`), 'utf8'));
      expect(consumer.objectLabel(locale)).toBe(catalog.ui_menu_actions_ariaLabel);
    });

    it(`preserves the namespace import used by the context-menu default in ${locale}`, () => {
      const catalog = JSON.parse(readFileSync(resolve(`messages/${locale}.json`), 'utf8'));
      expect(consumer.namespaceLabel(locale)).toBe(catalog.ui_menu_actions_ariaLabel);
    });

    it(`ships destructured and line-split message reads in ${locale}`, () => {
      const catalog = JSON.parse(readFileSync(resolve(`messages/${locale}.json`), 'utf8'));
      expect(consumer.destructuredLabel(locale)).toBe(catalog.ui_menu_actions_ariaLabel);
      expect(consumer.splitLabel(locale)).toBe(catalog.ui_menu_actions_ariaLabel);
    });
  }
});

describe('production Paraglide gap check', () => {
  // The prebuilt bundle only holds keys found under src/; a read the scan
  // missed must fail the release build rather than crash the packaged app
  // with "is not a function" (cloudlands-fe#2865, #4034).
  function unbundledKey() {
    const bundled = new Set(
      JSON.parse(
        readFileSync(join(root, '.svelte-kit/i18n-bundle/used-message-keys.json'), 'utf8'),
      ),
    );
    const catalog = JSON.parse(readFileSync(resolve('messages/en.json'), 'utf8'));
    const key = Object.keys(catalog).find(
      (candidate) => /^[a-z]\w*$/.test(candidate) && !bundled.has(candidate),
    );
    expect(key, 'catalog should hold a key no source reads').toBeDefined();
    return key;
  }

  it('fails the build when a destructured message is missing from the bundle', async () => {
    const key = unbundledKey();
    await expect(
      buildConsumer(
        'destructured-gap.mjs',
        `import { m } from '$shared/paraglide/messages.js';
        const {
          ${key}: label,
        } = m;
        export const text = () => label();`,
      ),
    ).rejects.toThrow(new RegExp(`destructured-gap\\.mjs: not in the bundle — ${key}`));
  });

  it('fails the build when a message is looked up by a computed key', async () => {
    await expect(
      buildConsumer(
        'computed-gap.mjs',
        `import * as messages from '$shared/paraglide/messages.js';
        export const text = (key) => messages[key]();`,
      ),
    ).rejects.toThrow(/computed-gap\.mjs: computed message lookup/);
  });
});
