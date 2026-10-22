// @vitest-environment node
// @verify-changed-triggers: vite.config.mjs
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { build, createLogger, normalizePath } from 'vite';
import configure from '../../vite.config.mjs';

const fixtures = [];

afterEach(() => {
  for (const root of fixtures.splice(0)) rmSync(root, { recursive: true, force: true });
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

function createFixture(target, source) {
  vi.stubEnv('INTENT_BUILD_TARGET', target);
  const config = configure({ command: 'build', mode: 'production' });
  const root = mkdtempSync(join(tmpdir(), 'production-missing-exports-'));
  fixtures.push(root);
  const entry = join(root, 'consumer.mjs');
  const exporter = join(root, 'messages.mjs');
  writeFileSync(
    exporter,
    `export const greet = (name) => 'Hello, ' + name + '!';
export const m = { greet };
`,
  );
  writeFileSync(entry, source);
  const logger = createLogger('warn', { allowClearScreen: false });
  const warnings = vi.spyOn(logger, 'warn');
  return {
    entry: normalizePath(entry),
    exporter: normalizePath(exporter),
    bundlePath: join(root, 'dist/consumer.js'),
    warnings,
    options: {
      configFile: false,
      root,
      mode: 'production',
      customLogger: logger,
      // Keep the actual production build options, including the shared Rollup
      // diagnostic policy, while replacing the app with a small executable entry.
      build: {
        ...config.build,
        outDir: join(root, 'dist'),
        sourcemap: false,
        minify: 'esbuild',
        lib: { entry, formats: ['iife'], name: 'Consumer', fileName: () => 'consumer.js' },
      },
    },
  };
}

async function buildConsumer(options) {
  const result = await build(options);
  const context = {};
  runInNewContext(result[0].output.find((output) => output.type === 'chunk').code, context);
  return context.Consumer;
}

describe.each(['electron', 'web'])('%s production missing-export policy', (target) => {
  it('rejects an absent namespace function before writing a bundle, with source context', async () => {
    const fixture = createFixture(
      target,
      `import * as messages from './messages.mjs';
export const label = () => messages.missing();
`,
    );

    await expect(build(fixture.options)).rejects.toMatchObject({
      code: 'MISSING_EXPORT',
      binding: 'missing',
      id: fixture.entry,
      exporter: fixture.exporter,
      loc: { file: fixture.entry, line: 2 },
      frame: expect.stringContaining('messages.missing()'),
      message: expect.stringContaining('"missing" is not exported by'),
    });
    expect(existsSync(fixture.bundlePath)).toBe(false);
  });

  it('builds and executes valid object, namespace, and named imports', async () => {
    const fixture = createFixture(
      target,
      `import { m, greet } from './messages.mjs';
import * as messages from './messages.mjs';
export const objectLabel = () => m.greet('Ada');
export const namespaceLabel = () => messages.greet('Ada');
export const namedLabel = () => greet('Ada');
`,
    );

    const consumer = await buildConsumer(fixture.options);
    expect(consumer.objectLabel()).toBe('Hello, Ada!');
    expect(consumer.namespaceLabel()).toBe('Hello, Ada!');
    expect(consumer.namedLabel()).toBe('Hello, Ada!');
  });

  it('keeps an unrelated eval warning visible and nonfatal', async () => {
    const fixture = createFixture(
      target,
      'export const evaluate = (expression) => eval(expression);\n',
    );

    const consumer = await buildConsumer(fixture.options);
    expect(consumer.evaluate('2 + 3')).toBe(5);
    expect(fixture.warnings.mock.calls.some(([message]) => message.includes('Use of eval'))).toBe(
      true,
    );
  });
});
