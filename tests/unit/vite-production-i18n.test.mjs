// @vitest-environment node
// @verify-changed-triggers: vite.config.mjs, scripts/build-i18n-bundle.mjs, messages/*.json, src/**/*.svelte, src/**/*.ts
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

let root;
let bundledMessages;
let consumer;

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'production-i18n-'));
  // Exercise the real scanner and bundler without overwriting a concurrent app build.
  for (const name of ['node_modules', 'scripts', 'src', 'messages', 'package.json']) {
    symlinkSync(resolve(name), join(root, name));
  }
  mkdirSync(join(root, 'build-script'));
  const bundler = join(root, 'build-script/build-i18n-bundle.mjs');
  copyFileSync(resolve('scripts/build-i18n-bundle.mjs'), bundler);
  execFileSync(process.execPath, [bundler], { cwd: root, stdio: 'pipe' });
  bundledMessages = readFileSync(join(root, 'static/generated/paraglide.js'), 'utf8');

  copyFileSync(resolve('vite.config.mjs'), join(root, 'vite.config.mjs'));
  const { default: configure } = await import(pathToFileURL(join(root, 'vite.config.mjs')).href);
  const config = configure({ command: 'build', mode: 'production' });
  const entry = join(root, 'entry.mjs');
  writeFileSync(
    entry,
    `
    import { m } from '$shared/paraglide/messages.js';
    import * as messages from '$shared/paraglide/messages.js';
    export const objectLabel = (locale) => m.ui_menu_actions_ariaLabel({}, { locale });
    export const namespaceLabel = (locale) => messages.ui_menu_actions_ariaLabel({}, { locale });
  `,
  );
  const result = await build({
    configFile: false,
    root,
    logLevel: 'warn',
    plugins: config.plugins.filter((plugin) => plugin.name === 'use-production-paraglide-bundle'),
    build: {
      write: false,
      minify: 'esbuild',
      lib: { entry, formats: ['iife'], name: 'Consumer' },
    },
  });
  const context = {};
  runInNewContext(bundledMessages, context);
  runInNewContext(result[0].output.find((output) => output.type === 'chunk').code, context);
  consumer = context.Consumer;
});

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
  }
});
