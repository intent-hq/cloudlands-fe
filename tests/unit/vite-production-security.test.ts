// @vitest-environment node
// Importing vitest.config.ts pulls in vite/esbuild, which refuses jsdom's TextEncoder.
import { execFileSync, spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  PARAGLIDE_INPUTS_HASH_FILE,
  PARAGLIDE_IS_SERVER,
  PARAGLIDE_STALE_MESSAGE,
  canReuseGeneratedParaglide,
  compileWithInputsHash,
  ensureGeneratedParaglide,
  ensureRepoParaglide,
  generateParaglide,
  paraglideLockPath,
  publishOrder,
} from '../../scripts/paraglide-inputs-hash.mjs';
import { generatedParaglidePlugin } from '../../vitest.config';

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

/**
 * `realProject` writes an inlang project the real `@inlang/paraglide-js`
 * compiler accepts (message-format plugin resolved through the symlinked
 * node_modules) and no placeholder outputs; the default is a shape-only
 * project for tests that inject a fake compiler.
 */
function createParaglideFixtureRoot({ realProject = false } = {}): {
  root: string;
  paths: FixturePaths;
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
    JSON.stringify({
      baseLocale: 'en',
      locales: ['en', 'ko'],
      ...(realProject
        ? {
            modules: ['./node_modules/@inlang/plugin-message-format/dist/index.js'],
            'plugin.inlang.messageFormat': { pathPattern: './messages/{locale}.json' },
          }
        : {}),
    }),
  );
  writeFileSync(join(paths.messagesDir, 'en.json'), JSON.stringify({ hello: 'Hello' }));
  writeFileSync(join(paths.messagesDir, 'ko.json'), JSON.stringify({ hello: '안녕하세요' }));
  if (!realProject) {
    writeFileSync(join(paths.outdir, 'messages.js'), 'export const m = {};\n');
    writeFileSync(join(paths.outdir, 'runtime.js'), 'export const baseLocale = "en";\n');
  }
  return { root, paths };
}

function readPluginNames({
  uiPreview,
  mode = 'development',
  command = 'serve',
  configDir = resolve('.'),
}: {
  uiPreview: boolean;
  mode?: string;
  command?: string;
  configDir?: string;
}): string[] {
  const configUrl = pathToFileURL(join(configDir, 'vite.config.mjs')).href;
  const script = `
    import createViteConfig from ${JSON.stringify(configUrl)};
    const config = createViteConfig({ command: ${JSON.stringify(command)}, mode: ${JSON.stringify(mode)} });
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

type BuildStartRun = {
  ensureCalls: unknown[];
  watched: string[];
  error: string | null;
};

/**
 * Runs the Paraglide plugin's `buildStart` from the real vite.config.mjs in a
 * child process. `ensureResult` injects a recording stand-in for the locked
 * ensure; omitted, the plugin runs the real `ensureRepoParaglide` against the
 * project at `configDir`.
 */
function runParaglideBuildStart({
  configDir = resolve('.'),
  ensureResult,
  times = 1,
}: {
  configDir?: string;
  ensureResult?: boolean;
  times?: number;
}): BuildStartRun {
  const configUrl = pathToFileURL(join(configDir, 'vite.config.mjs')).href;
  const script = `
    import createViteConfig from ${JSON.stringify(configUrl)};
    const ensureCalls = [];
    const overrides = ${
      ensureResult === undefined
        ? '{}'
        : `{ ensureRepoParaglide: async (options) => { ensureCalls.push(options); return ${JSON.stringify(ensureResult)}; } }`
    };
    const config = createViteConfig({ command: 'serve', mode: 'development' }, overrides);
    const plugin = config.plugins.find((plugin) => plugin.name === 'reuse-generated-paraglide');
    const watched = [];
    let error = null;
    for (let run = 0; run < ${times}; run += 1) {
      try {
        await plugin.buildStart.call({ addWatchFile: (file) => watched.push(file) });
      } catch (caught) {
        error = caught.message;
      }
    }
    process.stdout.write(JSON.stringify({ ensureCalls, watched, error }));
  `;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    encoding: 'utf8',
    env: { ...process.env, INTENT_BUILD_TARGET: 'web' },
  });
  expect(result.status, result.stderr).toBe(0);
  return JSON.parse(result.stdout);
}

/** Every file under `dir` with its mtime and content, for "nothing was rewritten" checks. */
function snapshotDir(dir: string): Record<string, { mtimeMs: number; content: string }> {
  const snapshot: Record<string, { mtimeMs: number; content: string }> = {};
  const walk = (current: string, prefix: string) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(join(current, entry.name), relative);
      else {
        const file = join(current, entry.name);
        snapshot[relative] = {
          mtimeMs: statSync(file).mtimeMs,
          content: readFileSync(file, 'utf8'),
        };
      }
    }
  };
  walk(dir, '');
  return snapshot;
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

  it.each([
    { uiPreview: true, mode: 'development', command: 'serve' },
    { uiPreview: false, mode: 'development', command: 'serve' },
    { uiPreview: false, mode: 'test', command: 'serve' },
    { uiPreview: false, mode: 'production', command: 'build' },
  ])(
    'routes Paraglide through the locked publisher, never upstream (preview=$uiPreview, $mode, $command)',
    (options) => {
      const plugins = readPluginNames(options);
      expect(plugins).toContain('reuse-generated-paraglide');
      expect(plugins).not.toContain('unplugin-paraglide-js');
    },
  );

  it('buildStart ensures the outdir through the locked publisher and watches the inputs', () => {
    const run = runParaglideBuildStart({ ensureResult: true });
    expect(run.ensureCalls).toEqual([{ rootDir: resolve('.'), ifStale: true }]);
    expect(run.watched).toEqual([resolve('messages'), resolve('project.inlang/settings.json')]);
    expect(run.error).toBeNull();
  });

  it('buildStart fails the build when the messages never settle', () => {
    const run = runParaglideBuildStart({ ensureResult: false });
    expect(run.error).toContain(PARAGLIDE_STALE_MESSAGE);
  });
});

describe('Vitest Paraglide plugin', () => {
  it('does not use upstream paraglideVitePlugin', async () => {
    const createConfig = (await import('../../vitest.config')).default as (env: {
      command: string;
      mode: string;
    }) => Promise<{ plugins: unknown[] }>;
    const config = await createConfig({ command: 'serve', mode: 'test' });
    const names = config.plugins.flat().map((plugin) => (plugin as { name: string }).name);
    expect(names).toContain('ensure-generated-paraglide');
    expect(names).not.toContain('unplugin-paraglide-js');
  });

  it('buildStart runs the locked if-stale ensure for the package root', async () => {
    const calls: unknown[] = [];
    const plugin = generatedParaglidePlugin({
      ensure: async (options) => {
        calls.push(options);
        return true;
      },
    });
    await plugin.buildStart();
    expect(calls).toEqual([{ rootDir: resolve('.'), ifStale: true }]);
  });

  it('buildStart throws the stale message when the ensure gives up', async () => {
    const plugin = generatedParaglidePlugin({ ensure: async () => false });
    await expect(plugin.buildStart()).rejects.toThrow(PARAGLIDE_STALE_MESSAGE);
  });
});

/** What the locale-modules compiler leaves in the outdir it is handed. */
const GENERATED_OUTPUTS = ['messages.js', 'runtime.js'];
const OUTPUT_CONTENT: Record<string, string> = {
  'messages.js': 'export const m = {};\n',
  'runtime.js': 'export const baseLocale = "en";\n',
};

function writeGeneratedOutputs(outdir: string, contents = OUTPUT_CONTENT) {
  mkdirSync(join(outdir, 'messages'), { recursive: true });
  for (const [file, content] of Object.entries(contents))
    writeFileSync(join(outdir, file), content);
  writeFileSync(join(outdir, 'messages', 'en.js'), 'export const hello = () => "Hello";\n');
}

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

describe('generated Paraglide reuse in the UI preview', () => {
  const fixtures: string[] = [];
  afterEach(() => {
    for (const root of fixtures.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  // A fake compiler that emits the generated outputs into the directory it is
  // handed, the way generate:i18n / watchChange do with the real compiler.
  const fakeCompile = async ({ outdir }: { outdir: string }) => writeGeneratedOutputs(outdir);
  const recordSidecar = (paths: FixturePaths) =>
    compileWithInputsHash({ ...paths, compile: fakeCompile });

  it('a startup after generate:i18n writes nothing and keeps the sidecar (real compiler)', async () => {
    // What vitest.config.ts / vite.config.mjs run from buildStart: the locked
    // if-stale ensure over output the CLI published. Upstream's plugin in this
    // spot rewrote outputs in place and unlinked the sidecar on every start.
    const { root, paths } = createParaglideFixtureRoot({ realProject: true });
    fixtures.push(root);
    await expect(ensureRepoParaglide({ rootDir: root })).resolves.toBe(true);
    expect(readFileSync(join(paths.outdir, 'runtime.js'), 'utf8')).toContain(PARAGLIDE_IS_SERVER);
    const published = snapshotDir(paths.outdir);
    expect(Object.keys(published)).toContain(PARAGLIDE_INPUTS_HASH_FILE);

    await expect(ensureRepoParaglide({ rootDir: root, ifStale: true })).resolves.toBe(true);

    expect(snapshotDir(paths.outdir)).toEqual(published);
    expect(canReuseGeneratedParaglide(paths)).toBe(true);
  });

  it('vite.config.mjs buildStart produces a missing outdir once and leaves a current one alone', () => {
    const { root, paths } = createParaglideFixtureRoot({ realProject: true });
    fixtures.push(root);

    const first = runParaglideBuildStart({ configDir: root });
    expect(first.error).toBeNull();
    expect(canReuseGeneratedParaglide(paths)).toBe(true);
    expect(readFileSync(join(paths.outdir, 'runtime.js'), 'utf8')).toContain(PARAGLIDE_IS_SERVER);
    const published = snapshotDir(paths.outdir);

    const again = runParaglideBuildStart({ configDir: root, times: 2 });
    expect(again.error).toBeNull();
    expect(snapshotDir(paths.outdir)).toEqual(published);
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
    const racedCompile = async ({ outdir }: { outdir: string }) => {
      writeGeneratedOutputs(outdir, {
        ...OUTPUT_CONTENT,
        'messages.js': 'export const m = { stale: true };\n',
      });
      writeFileSync(koCatalog, JSON.stringify({ hello: '안녕' }));
    };
    await expect(compileWithInputsHash({ ...paths, compile: racedCompile })).resolves.toBe(false);
    expect(existsSync(sidecar)).toBe(false);
    expect(canReuseGeneratedParaglide(paths)).toBe(false);

    // A content-preserving rewrite mid-compile is not a change.
    const touchingCompile = async ({ outdir }: { outdir: string }) => {
      writeGeneratedOutputs(outdir);
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
    const settlesOnSecondRun = async ({ outdir }: { outdir: string }) => {
      attempts += 1;
      writeGeneratedOutputs(outdir);
      if (attempts === 1) writeFileSync(koCatalog, JSON.stringify({ hello: '안녕' }));
    };
    await expect(generateParaglide({ ...paths, compile: settlesOnSecondRun })).resolves.toBe(true);
    expect(attempts).toBe(2);
    expect(canReuseGeneratedParaglide(paths)).toBe(true);

    let edits = 0;
    const neverSettles = async ({ outdir }: { outdir: string }) => {
      edits += 1;
      writeGeneratedOutputs(outdir);
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
    const compile = async ({ outdir }: { outdir: string }) => {
      compiles += 1;
      writeGeneratedOutputs(outdir);
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

describe('generated Paraglide output under concurrent generators', () => {
  const fixtures: string[] = [];
  afterEach(() => {
    for (const root of fixtures.splice(0)) {
      rmSync(paraglideLockPath(join(root, 'src/shared/paraglide')), {
        recursive: true,
        force: true,
      });
      rmSync(root, { recursive: true, force: true });
    }
  });

  /** A compiler that behaves like `cleanOutdir: true`: wipes its outdir, then writes slowly. */
  const slowCompile = async ({ outdir }: { outdir: string }) => {
    rmSync(outdir, { recursive: true, force: true });
    mkdirSync(outdir, { recursive: true });
    for (const file of GENERATED_OUTPUTS) {
      await sleep(40);
      writeFileSync(join(outdir, file), OUTPUT_CONTENT[file]);
    }
    await sleep(40);
    mkdirSync(join(outdir, 'messages'));
    writeFileSync(join(outdir, 'messages', 'en.js'), 'export const hello = () => "Hello";\n');
  };

  const expectCompleteOutdir = (paths: FixturePaths) => {
    for (const file of GENERATED_OUTPUTS) {
      expect(readFileSync(join(paths.outdir, file), 'utf8')).toBe(OUTPUT_CONTENT[file]);
    }
    expect(existsSync(join(paths.outdir, 'messages', 'en.js'))).toBe(true);
    expect(canReuseGeneratedParaglide(paths)).toBe(true);
  };

  it('publishes every generated module after the modules it imports', () => {
    const locales = ['en', 'de', 'fr', 'zh-CN'];
    const staged: Record<string, string> = {
      '.gitignore': '*\n',
      'README.md': '# generated\n',
      'messages.js': [
        "export * from './messages/_index.js'",
        "export * as m from './messages/_index.js'",
        '',
      ].join('\n'),
      'messages/_index.js': [
        'import { getLocale, experimentalStaticLocale } from "../runtime.js"',
        ...locales.map(
          (locale) => `import * as __${locale.replace('-', '_')} from "./${locale}.js"`,
        ),
        'export const hello = (inputs = {}, options = {}) => __en.hello(inputs)',
        '',
      ].join('\n'),
      ...Object.fromEntries(
        locales.map((locale) => [
          `messages/${locale}.js`,
          `export const hello = () => "hello ${locale}";\n`,
        ]),
      ),
      'registry.js': 'export const registry = {};\n',
      'runtime.js':
        'export const getLocale = () => "en";\nexport const experimentalStaticLocale = undefined;\n',
      'server.js':
        'import * as runtime from "./runtime.js";\nexport const paraglideMiddleware = runtime;\n',
    };
    const files = Object.keys(staged).sort(() => 0.5 - Math.random());
    const ordered = publishOrder(files, (file) => staged[file]);
    const at = (file: string) => ordered.indexOf(file);

    expect([...ordered].sort()).toEqual(Object.keys(staged).sort());
    for (const locale of locales) {
      expect(at(`messages/${locale}.js`)).toBeLessThan(at('messages/_index.js'));
    }
    expect(at('runtime.js')).toBeLessThan(at('messages/_index.js'));
    expect(at('messages/_index.js')).toBeLessThan(at('messages.js'));
    expect(at('runtime.js')).toBeLessThan(at('server.js'));
  });

  it('a reader importing the graph mid-publish never pairs a new index with an old locale module', async () => {
    // Old output: `messages/_index.js` calls into `messages/en.js`; the new
    // compile adds a message to both. Load the graph in a fresh module instance
    // at every intermediate publish state (each prefix of the publish order) and
    // check that calling every message the loaded index exports never throws —
    // i.e. an index only ever lands over locale modules that already carry
    // what it calls.
    const root = mkdtempSync(join(tmpdir(), 'paraglide-publish-order-'));
    fixtures.push(root);
    const version = (added: boolean) => ({
      'messages/en.js': `export const hello = () => "Hello";\n${added ? 'export const added = () => "Added";\n' : ''}`,
      'messages/_index.js': [
        'import * as __en from "./en.js"',
        'export const hello = (inputs = {}) => __en.hello(inputs)',
        added ? 'export const added = (inputs = {}) => __en.added(inputs)' : '',
        '',
      ].join('\n'),
      'messages.js': "export * as m from './messages/_index.js'\n",
      'runtime.js': OUTPUT_CONTENT['runtime.js'],
    });
    const write = (dir: string, files: Record<string, string>) => {
      for (const [file, content] of Object.entries(files)) {
        mkdirSync(dirname(join(dir, file)), { recursive: true });
        writeFileSync(join(dir, file), content);
      }
    };
    const oldFiles = version(false);
    const newFiles = version(true);
    const order = publishOrder(Object.keys(newFiles), (file) => newFiles[file]);
    const loadAndCallAll = (dir: string, tag: string) => {
      const entry = pathToFileURL(join(dir, 'messages.js')).href;
      const script = `import { m } from ${JSON.stringify(entry)}; for (const key of Object.keys(m)) m[key]();`;
      const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
        encoding: 'utf8',
      });
      expect(result.status, `${tag}: ${result.stderr}`).toBe(0);
    };

    for (let published = 0; published <= order.length; published += 1) {
      const stateDir = join(root, `state-${published}`);
      write(stateDir, oldFiles);
      write(stateDir, Object.fromEntries(order.slice(0, published).map((f) => [f, newFiles[f]])));
      loadAndCallAll(
        stateDir,
        `after publishing ${order.slice(0, published).join(', ') || 'nothing'}`,
      );
    }

    // The reverse order is exactly the broken interleaving: a new index over the old locale module.
    const brokenDir = join(root, 'state-broken');
    write(brokenDir, oldFiles);
    write(brokenDir, { 'messages/_index.js': newFiles['messages/_index.js'] });
    const broken = spawnSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `import { m } from ${JSON.stringify(pathToFileURL(join(brokenDir, 'messages.js')).href)}; m.added();`,
      ],
      { encoding: 'utf8' },
    );
    expect(broken.status).not.toBe(0);
    expect(broken.stderr).toContain('is not a function');
  });

  it('N concurrent --if-stale generators share one compile and all see current output', async () => {
    const { root, paths } = createParaglideFixtureRoot();
    fixtures.push(root);
    let compiles = 0;
    const compile = async (target: { outdir: string }) => {
      compiles += 1;
      await slowCompile(target);
    };

    const results = await Promise.all(
      Array.from({ length: 6 }, () =>
        ensureGeneratedParaglide({ ...paths, ifStale: true, compile }),
      ),
    );

    expect(results).toEqual([true, true, true, true, true, true]);
    expect(compiles).toBe(1);
    expectCompleteOutdir(paths);
    expect(readdirSync(dirname(paths.outdir)).filter((entry) => entry !== 'paraglide')).toEqual([]);
  });

  it('readers never observe a partially published outdir while a compile is in flight', async () => {
    const { root, paths } = createParaglideFixtureRoot();
    fixtures.push(root);
    await compileWithInputsHash({ ...paths, compile: slowCompile });
    expectCompleteOutdir(paths);

    const sidecar = join(paths.outdir, PARAGLIDE_INPUTS_HASH_FILE);
    const violations: string[] = [];
    let compiling = true;
    const reader = (async () => {
      while (compiling) {
        const entries = readdirSync(paths.outdir);
        for (const file of [...GENERATED_OUTPUTS, PARAGLIDE_INPUTS_HASH_FILE]) {
          if (!entries.includes(file)) violations.push(`missing ${file}`);
          else if (readFileSync(join(paths.outdir, file), 'utf8').length === 0)
            violations.push(`empty ${file}`);
        }
        if (!existsSync(join(paths.outdir, 'messages', 'en.js'))) violations.push('missing en.js');
        await sleep(2);
      }
    })();

    const recompiled = compileWithInputsHash({
      ...paths,
      compile: async (target) => {
        await slowCompile(target);
        // The sidecar of the previous, still-current output survives the in-flight compile.
        expect(existsSync(sidecar)).toBe(true);
        expect(canReuseGeneratedParaglide(paths)).toBe(true);
      },
    });
    await expect(recompiled).resolves.toBe(true);
    compiling = false;
    await reader;

    expect(violations).toEqual([]);
    expectCompleteOutdir(paths);
  });

  it('publishes the new output set, drops stale files, and writes the sidecar last', async () => {
    const { root, paths } = createParaglideFixtureRoot();
    fixtures.push(root);
    // A previous compile (e.g. with an extra locale) left outputs the next one no longer emits.
    await compileWithInputsHash({
      ...paths,
      compile: async ({ outdir }) => {
        writeGeneratedOutputs(outdir);
        writeFileSync(join(outdir, 'server.js'), 'export const stale = true;\n');
        writeFileSync(join(outdir, 'messages', 'fr.js'), 'export const stale = true;\n');
      },
    });
    expect(existsSync(join(paths.outdir, 'server.js'))).toBe(true);
    expect(existsSync(join(paths.outdir, 'messages', 'fr.js'))).toBe(true);

    let sidecarWhileCompiling: boolean | undefined;
    await expect(
      compileWithInputsHash({
        ...paths,
        compile: async (target) => {
          await slowCompile(target);
          sidecarWhileCompiling = existsSync(join(paths.outdir, PARAGLIDE_INPUTS_HASH_FILE));
        },
      }),
    ).resolves.toBe(true);

    expect(sidecarWhileCompiling).toBe(true);
    expect(readdirSync(paths.outdir).sort()).toEqual(
      [PARAGLIDE_INPUTS_HASH_FILE, ...GENERATED_OUTPUTS, 'messages'].sort(),
    );
    expect(readdirSync(join(paths.outdir, 'messages'))).toEqual(['en.js']);
    expectCompleteOutdir(paths);
  });

  it('a mid-compile edit publishes no sidecar and generate:i18n still retries', async () => {
    const { root, paths } = createParaglideFixtureRoot();
    fixtures.push(root);
    const koCatalog = join(paths.messagesDir, 'ko.json');
    await compileWithInputsHash({ ...paths, compile: slowCompile });

    let attempts = 0;
    const editedOnce = async (target: { outdir: string }) => {
      attempts += 1;
      await slowCompile(target);
      if (attempts === 1) writeFileSync(koCatalog, JSON.stringify({ hello: '안녕' }));
    };
    await expect(compileWithInputsHash({ ...paths, compile: editedOnce })).resolves.toBe(false);
    expect(existsSync(join(paths.outdir, PARAGLIDE_INPUTS_HASH_FILE))).toBe(false);

    await expect(
      generateParaglide({ ...paths, compile: editedOnce, maxAttempts: 3 }),
    ).resolves.toBe(true);
    expect(attempts).toBe(2);
    expectCompleteOutdir(paths);
  });

  it('cleans up its staging directory when the compiler throws', async () => {
    const { root, paths } = createParaglideFixtureRoot();
    fixtures.push(root);
    await compileWithInputsHash({ ...paths, compile: slowCompile });

    await expect(
      compileWithInputsHash({
        ...paths,
        compile: async ({ outdir }) => {
          writeFileSync(join(outdir, 'messages.js'), 'broken');
          throw new Error('compiler failed');
        },
      }),
    ).rejects.toThrow('compiler failed');

    expect(readdirSync(dirname(paths.outdir))).toEqual(['paraglide']);
    expectCompleteOutdir(paths);
    // The lock was released: a follow-up compile proceeds immediately.
    await expect(compileWithInputsHash({ ...paths, compile: slowCompile })).resolves.toBe(true);
  });

  it('a stale lock left by a dead process does not block a new generator', async () => {
    const { root, paths } = createParaglideFixtureRoot();
    fixtures.push(root);
    const deadPid = spawnSync(process.execPath, ['-e', '0']).pid;
    const lockPath = paraglideLockPath(paths.outdir);
    mkdirSync(lockPath, { recursive: true });
    writeFileSync(join(lockPath, 'owner.json'), JSON.stringify({ pid: deadPid, token: 'gone' }));

    let compiles = 0;
    const compile = async (target: { outdir: string }) => {
      compiles += 1;
      await slowCompile(target);
    };
    await expect(ensureGeneratedParaglide({ ...paths, ifStale: true, compile })).resolves.toBe(
      true,
    );
    expect(compiles).toBe(1);
    expect(existsSync(lockPath)).toBe(false);
    expectCompleteOutdir(paths);
  });
});
