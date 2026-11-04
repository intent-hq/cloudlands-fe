// @verify-changed-triggers: tsconfig.main.json, tsconfig.preload.json, scripts/prepare-preload-output.mjs, scripts/fix-esm-imports.ts, package.json
import { execFile } from 'node:child_process';
import { copyFileSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import ts from 'typescript';
import { afterEach, describe, expect, it } from 'vitest';
import { fixImports } from './fix-esm-imports';
import { preparePreloadOutput } from './prepare-preload-output.mjs';

const exec = promisify(execFile);
const require = createRequire(import.meta.url);
const tsc = require.resolve('typescript/bin/tsc');
const alias = require.resolve('tsc-alias/dist/bin/index.js');
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'preload-output-'));
  roots.push(root);
  writeFileSync(join(root, 'package.json'), '{"type":"module"}');
  for (const project of ['main', 'preload']) {
    const filename = `tsconfig.${project}.json`;
    const config = ts.readConfigFile(resolve(filename), ts.sys.readFile).config;
    // The fixture needs no ambient packages; retain the production emit options.
    config.compilerOptions.types = [];
    writeFileSync(join(root, filename), JSON.stringify(config));
    mkdirSync(join(root, 'src', project), { recursive: true });
    writeFileSync(
      join(root, 'src', project, 'index.ts'),
      "export { isDesktopOverlayRoute } from '$shared/desktop-overlay';\n",
    );
  }
  mkdirSync(join(root, 'src/shared'), { recursive: true });
  copyFileSync('src/shared/desktop-overlay.ts', join(root, 'src/shared/desktop-overlay.ts'));
  preparePreloadOutput(root);
  return root;
}

async function compile(root: string, project: string) {
  await exec(process.execPath, [tsc, '-p', `tsconfig.${project}.json`], {
    cwd: root,
    env: { ...process.env, NODE_DISABLE_COMPILE_CACHE: '1' },
  });
}

async function finish(root: string) {
  await exec(process.execPath, [alias, '-p', 'tsconfig.preload.json'], { cwd: root });
  await fixImports({ distDir: join(root, 'dist') });
}

async function assertLoadable(root: string) {
  const { stdout } = await exec(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `import { isDesktopOverlayRoute } from './dist/main/index.js';
       import { createRequire } from 'node:module';
       const preload = createRequire(import.meta.url)('./dist/preload-build/preload/index.js');
       console.log(JSON.stringify([isDesktopOverlayRoute, preload.isDesktopOverlayRoute]
         .map(matches => [matches('/desktop-overlay'), matches('/desktop-overlay/glow'), matches('/workspace')])));`,
    ],
    { cwd: root },
  );
  expect(JSON.parse(stdout)).toEqual([
    [true, true, false],
    [true, true, false],
  ]);
}

describe('main and preload output isolation', () => {
  it.each(['main-first', 'preload-first', 'concurrent'])(
    'loads ESM and CommonJS after %s builds and incremental rebuilds',
    async (order) => {
      const root = fixture();
      if (order === 'concurrent') {
        await Promise.all([compile(root, 'main'), compile(root, 'preload')]);
      } else {
        const projects = order === 'main-first' ? ['main', 'preload'] : ['preload', 'main'];
        for (const project of projects) await compile(root, project);
      }
      await finish(root);
      await assertLoadable(root);

      await Promise.all([compile(root, 'main'), compile(root, 'preload')]);
      await finish(root);
      await assertLoadable(root);
    },
  );

  it('repairs main output overwritten by the old preload build despite its incremental cache', async () => {
    const root = fixture();
    const mainPath = join(root, 'tsconfig.main.json');
    const preloadPath = join(root, 'tsconfig.preload.json');
    const main = readFileSync(mainPath, 'utf8');
    const preload = readFileSync(preloadPath, 'utf8');
    const oldMain = JSON.parse(main);
    oldMain.compilerOptions.tsBuildInfoFile = './dist/tsconfig.main.tsbuildinfo';
    const oldPreload = JSON.parse(preload);
    oldPreload.compilerOptions.outDir = './dist';
    oldPreload.compilerOptions.tsBuildInfoFile = './dist/tsconfig.preload.tsbuildinfo';
    writeFileSync(mainPath, JSON.stringify(oldMain));
    writeFileSync(preloadPath, JSON.stringify(oldPreload));
    await compile(root, 'main');
    await compile(root, 'preload');
    await finish(root);
    await expect(assertLoadable(root)).rejects.toThrow();

    writeFileSync(mainPath, main);
    writeFileSync(preloadPath, preload);
    await Promise.all([compile(root, 'main'), compile(root, 'preload')]);
    await finish(root);
    await assertLoadable(root);
  });
});
