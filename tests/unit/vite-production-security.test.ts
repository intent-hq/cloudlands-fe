import { execFileSync, spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  PARAGLIDE_INPUTS_HASH_FILE,
  canReuseGeneratedParaglide,
  compileWithInputsHash,
  ensureGeneratedParaglide,
  generateParaglide,
  paraglideLockPath,
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

function readPluginNames({
  uiPreview,
  canReuse,
  mode = 'development',
  configDir = resolve('.'),
}: {
  uiPreview: boolean;
  canReuse?: boolean;
  mode?: string;
  configDir?: string;
}): string[] {
  const configUrl = pathToFileURL(join(configDir, 'vite.config.mjs')).href;
  const script = `
    import createViteConfig from ${JSON.stringify(configUrl)};
    const config = createViteConfig(
      { command: 'serve', mode: ${JSON.stringify(mode)} },
      ${canReuse === undefined ? '{}' : `{ canReuseGeneratedParaglide: () => ${JSON.stringify(canReuse)} }`},
    );
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

  it('reuses generated messages for the UI preview when the output is fresh', () => {
    expect(readPluginNames({ uiPreview: true, canReuse: true })).toContain(
      'reuse-generated-paraglide',
    );
  });

  it('never reuses stale generated messages even for the UI preview', () => {
    const plugins = readPluginNames({ uiPreview: true, canReuse: false });
    expect(plugins).not.toContain('reuse-generated-paraglide');
    expect(plugins).toContain('unplugin-paraglide-js');
  });

  it.each(['development', 'test'])('uses full compilation in %s mode outside preview', (mode) => {
    const plugins = readPluginNames({ uiPreview: false, canReuse: true, mode });
    expect(plugins).toContain('unplugin-paraglide-js');
    expect(plugins).not.toContain('reuse-generated-paraglide');
  });

  it('compiles messages with unplugin outside the UI preview', () => {
    expect(readPluginNames({ uiPreview: false })).toContain('unplugin-paraglide-js');
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

  it('reuses generated messages only while the recorded input hash matches', async () => {
    const { root, paths } = createParaglideFixtureRoot();
    fixtures.push(root);

    expect(readPluginNames({ uiPreview: true, configDir: root })).toContain(
      'unplugin-paraglide-js',
    );

    await expect(recordSidecar(paths)).resolves.toBe(true);
    expect(readPluginNames({ uiPreview: true, configDir: root })).toContain(
      'reuse-generated-paraglide',
    );
    expect(readPluginNames({ uiPreview: false, configDir: root })).toContain(
      'unplugin-paraglide-js',
    );

    // Touching an input without changing content must not invalidate the outputs.
    const koCatalog = join(paths.messagesDir, 'ko.json');
    writeFileSync(koCatalog, JSON.stringify({ hello: '안녕하세요' }));
    expect(readPluginNames({ uiPreview: true, configDir: root })).toContain(
      'reuse-generated-paraglide',
    );

    writeFileSync(koCatalog, JSON.stringify({ hello: '안녕' }));
    expect(readPluginNames({ uiPreview: true, configDir: root })).toContain(
      'unplugin-paraglide-js',
    );
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
