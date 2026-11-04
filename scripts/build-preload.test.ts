// @vitest-environment node
// @verify-changed-triggers: scripts/build-preload.mjs, tsconfig.preload.json, tsconfig.main.json, package.json, src/shared/desktop-overlay.ts, src/preload/desktop-overlay.ts
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { expect, it, vi } from 'vitest';
import { buildPreload } from './build-preload.mjs';

const require = createRequire(import.meta.url);

it.each(['main-first', 'preload-first'])(
  'keeps main ESM and sandbox preload CommonJS separate (%s)',
  (order) => {
    const root = mkdtempSync(path.join(tmpdir(), 'intent-preload-test-'));
    vi.stubEnv('NODE_COMPILE_CACHE', path.join(root, 'node-compile-cache'));
    try {
      for (const dir of ['src/shared', 'src/preload', 'src/main'])
        mkdirSync(path.join(root, dir), { recursive: true });
      for (const file of ['src/shared/desktop-overlay.ts', 'src/preload/desktop-overlay.ts']) {
        copyFileSync(file, path.join(root, file));
      }
      writeFileSync(
        path.join(root, 'src/preload/electron.d.ts'),
        `declare module 'electron' {
      export const contextBridge: { exposeInMainWorld(name: string, value: unknown): void };
      export const ipcRenderer: { send(...args: unknown[]): void; on(...args: unknown[]): void; removeListener(...args: unknown[]): void };
    }`,
      );
      writeFileSync(path.join(root, 'package.json'), '{"type":"module"}');
      writeFileSync(
        path.join(root, 'src/main/index.ts'),
        "export { isDesktopOverlayRoute } from '../shared/desktop-overlay.js';",
      );
      for (const kind of ['main', 'preload']) {
        const config = ts.readConfigFile(`tsconfig.${kind}.json`, ts.sys.readFile).config;
        config.compilerOptions.types = [];
        config.compilerOptions.typeRoots = [];
        config.include =
          kind === 'main' ? ['src/main/**/*.ts', 'src/shared/**/*.ts'] : ['src/preload/**/*.ts'];
        writeFileSync(path.join(root, `tsconfig.${kind}.json`), JSON.stringify(config));
      }
      const buildMain = () =>
        execFileSync(
          process.execPath,
          [require.resolve('typescript/bin/tsc'), '-p', 'tsconfig.main.json'],
          { cwd: root },
        );
      if (order === 'main-first') {
        buildMain();
        buildPreload(root);
      } else {
        buildPreload(root);
        buildMain();
      }
      // Rebuilding preload must also be safe when main's incremental cache is warm.
      buildPreload(root);
      buildMain();
      execFileSync(
        process.execPath,
        [
          '--input-type=module',
          '-e',
          "import { isDesktopOverlayRoute } from './dist/main/index.js'; if (!isDesktopOverlayRoute('/desktop-overlay')) process.exit(1);",
        ],
        { cwd: root },
      );
      const bridges: Record<string, { ready(): void }> = {};
      const messages: string[] = [];
      runInNewContext(readFileSync(path.join(root, 'dist/preload/desktop-overlay.js'), 'utf8'), {
        exports: {},
        require: (name: string) => {
          expect(name).toBe('electron');
          return {
            contextBridge: {
              exposeInMainWorld: (name: string, value: { ready(): void }) => {
                bridges[name] = value;
              },
            },
            ipcRenderer: { send: (name: string) => messages.push(name) },
          };
        },
      });
      bridges.desktopOverlay.ready();
      expect(messages).toEqual(['desktop-overlay:ready']);
      const map = JSON.parse(
        readFileSync(path.join(root, 'dist/preload/desktop-overlay.js.map'), 'utf8'),
      );
      expect(path.resolve(root, 'dist/preload', map.sourceRoot, map.sources[0])).toBe(
        path.join(root, 'src/preload/desktop-overlay.ts'),
      );
    } finally {
      vi.unstubAllEnvs();
      rmSync(root, { recursive: true, force: true });
    }
  },
  30_000,
);
