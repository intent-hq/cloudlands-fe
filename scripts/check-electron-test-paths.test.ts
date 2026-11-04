// @verify-changed-triggers: tsconfig.electron-tests.json, package.json

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ts from 'typescript';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ALLOWLIST,
  SCAN_PATTERNS,
  TSCONFIG_PATH,
  applyAllowlist,
  checkElectronTestPaths,
  collectHelperFiles,
  stubExports,
} from './check-electron-test-paths.mjs';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

/** A throwaway package root holding `files` (repo-relative path → lines). */
function tree(files: Record<string, string | string[]>) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'electron-test-paths-')));
  roots.push(root);
  const all: Record<string, string | string[]> = {
    'tsconfig.json': JSON.stringify({ compilerOptions: { paths: { '$lib/*': ['./src/lib/*'] } } }),
    ...files,
  };
  for (const [file, content] of Object.entries(all)) {
    const absolute = path.join(root, file);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, Array.isArray(content) ? content.join('\n') : content);
  }
  return root;
}

const messages = (root: string) => checkElectronTestPaths(root).map((finding) => finding.message);

/** A Vite build fixture whose `resolveId` / `load` hooks are the given lines. */
const harness = (entry: string, resolveId: string[], load: string[] = []) => [
  "import { build } from 'vite';",
  "import { resolve } from 'node:path';",
  'export async function run() {',
  `  const entry = resolve('${entry}');`,
  '  await build({',
  '    plugins: [{',
  '      name: "stub",',
  '      resolveId(id, importer) {',
  ...resolveId.map((line) => `        ${line}`),
  '      },',
  '      load(id) {',
  ...load.map((line) => `        ${line}`),
  '      },',
  '    }],',
  '    build: { ssr: entry },',
  '  });',
  '}',
];

describe('Electron helper path check', () => {
  it('scans the Electron helpers and fixtures, not other root specs', () => {
    const root = tree({
      'test/electron-app.fixture.ts': '',
      'test/electron-close.ts': '',
      'test/fixtures/native/main.ts': '',
      'test/fixtures/native/deep/harness.ts': '',
      'test/fixtures/native/page.svelte': '',
      'test/catalog-shell.spec.ts': '',
    });
    expect(collectHelperFiles(root)).toEqual([
      'test/electron-app.fixture.ts',
      'test/electron-close.ts',
      'test/fixtures/native/deep/harness.ts',
      'test/fixtures/native/main.ts',
    ]);
  });

  it('keeps the tsconfig include and the scanned helpers in sync', () => {
    const { config } = ts.readConfigFile(TSCONFIG_PATH, ts.sys.readFile);
    for (const pattern of SCAN_PATTERNS) expect(config.include).toContain(pattern);
  });

  it('runs from lint:architecture with the tsc pass first', () => {
    const scripts = JSON.parse(fs.readFileSync('package.json', 'utf8')).scripts;
    expect(scripts['lint:architecture']).toContain('pnpm-run.mjs lint:electron-test-paths');
    expect(scripts['lint:electron-test-paths']).toMatch(
      new RegExp(`tsc -p ${TSCONFIG_PATH} && node scripts/check-electron-test-paths\\.mjs$`),
    );
  });

  it('ships with no allowlisted exceptions', () => {
    expect(ALLOWLIST).toEqual({});
  });

  describe('repository path literals', () => {
    it('flags a path that no longer exists and accepts files, directories and bare stems', () => {
      const root = tree({
        'src/main/dock-window.ts': '',
        'test/fixtures/native/harness.ts': [
          "import { resolve } from 'node:path';",
          "export const entries = [resolve('src/main/dock-window.ts'), 'src/main/dock-window'];",
          "export const dir = resolve('src/main');",
          "export const gone = resolve('src/main/connections-store.ts');",
          "export const list = ['test/fixtures/native/harness.ts', 'test/fixtures/old'];",
        ],
      });
      expect(checkElectronTestPaths(root)).toEqual([
        expect.objectContaining({
          file: 'test/fixtures/native/harness.ts',
          line: 4,
          key: 'test/fixtures/native/harness.ts: src/main/connections-store.ts',
        }),
        expect.objectContaining({
          line: 5,
          key: 'test/fixtures/native/harness.ts: test/fixtures/old',
        }),
      ]);
    });

    it('evaluates the join base: repo roots are checked, runtime directories are not', () => {
      const root = tree({
        'test/fixtures/native/review.ts': [
          "import { join, resolve, dirname } from 'node:path';",
          "import { fileURLToPath } from 'node:url';",
          "import { mkdtemp } from 'node:fs/promises';",
          "const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');",
          "const cwd = resolve('.');",
          'export async function run(scaffold: string) {',
          "  const temp = await mkdtemp('x');",
          "  join(scaffold, 'src/hooks.server');",
          "  join(temp, 'src/bootstrap.ts');",
          "  join(repo, 'src/missing-from-repo.ts');",
          "  join(process.cwd(), 'src/missing-from-cwd.ts');",
          "  join(cwd, 'src/missing-from-resolve.ts');",
          '}',
        ],
      });
      expect(messages(root)).toEqual([
        "'src/missing-from-repo.ts' names src/missing-from-repo.ts, which does not exist",
        "'src/missing-from-cwd.ts' names src/missing-from-cwd.ts, which does not exist",
        "'src/missing-from-resolve.ts' names src/missing-from-resolve.ts, which does not exist",
      ]);
    });

    it('ignores object keys and globs', () => {
      const root = tree({
        'test/fixtures/native/review.ts': [
          "export const generated = { 'src/bootstrap.ts': 'code', 'src/app.html': '<html>' };",
          "export const pattern = 'src/**/*.ts';",
        ],
      });
      expect(messages(root)).toEqual([]);
    });
  });

  describe('resolveId stubs', () => {
    it('flags an exact stub that matches no reachable import (the capture fixture)', () => {
      const files = {
        'src/backend/desktop-connections-store.ts': 'export async function getActiveId() {}',
        'src/backend/connections-store.ts': 'export function createConnectionsStore() {}',
        'src/browser/capture.ts': [
          "import { getActiveId } from '../backend/desktop-connections-store';",
          'export const capture = () => getActiveId();',
        ],
      };
      const stale = tree({
        ...files,
        'test/electron-capture.fixture.ts': harness(
          'src/browser/capture.ts',
          ["if (id === '../backend/connections-store') return '\\0backend';"],
          ["if (id === '\\0backend') return 'export async function getActiveId() {}';"],
        ),
      });
      expect(messages(stale)).toEqual([
        "resolveId stub === '../backend/connections-store' matches no import reachable from src/browser/capture.ts",
      ]);
      const fixed = tree({
        ...files,
        'test/electron-capture.fixture.ts': harness(
          'src/browser/capture.ts',
          ["if (id === '../backend/desktop-connections-store') return '\\0backend';"],
          ["if (id === '\\0backend') return 'export async function getActiveId() {}';"],
        ),
      });
      expect(messages(fixed)).toEqual([]);
    });

    it('flags a suffix stub that now intercepts a different module (the dock fixture)', () => {
      const files = {
        'src/backend/connections-store.ts': [
          'export function createConnectionsStore() {}',
          'export const LOCAL_CONNECTION_ID = "local";',
          'export interface ConnectionRecord { id: string }',
        ],
        'src/backend/desktop-connections-store.ts': [
          "import { createConnectionsStore, type ConnectionRecord } from './connections-store';",
          "export { LOCAL_CONNECTION_ID } from './connections-store';",
          "export type { ConnectionRecord } from './connections-store';",
          'const store = createConnectionsStore();',
          'export async function getActiveId(): Promise<ConnectionRecord | undefined> { return store; }',
        ],
        'src/main/dock-window.ts': [
          "import { getActiveId } from '../backend/desktop-connections-store';",
          'export const open = () => getActiveId();',
        ],
      };
      const load = [
        "if (id === '\\0backend') return 'export async function getActiveId() {}\\nexport async function list() { return []; }';",
      ];
      const stale = tree({
        ...files,
        'test/fixtures/dock/harness.ts': harness(
          'src/main/dock-window.ts',
          ["if (id.endsWith('/connections-store')) return '\\0backend';"],
          load,
        ),
      });
      expect(messages(stale)).toEqual([
        "resolveId stub .endsWith('/connections-store') intercepts './connections-store' in src/backend/desktop-connections-store.ts:1, which needs createConnectionsStore — not exported by the stub module",
        "resolveId stub .endsWith('/connections-store') intercepts './connections-store' in src/backend/desktop-connections-store.ts:2, which needs LOCAL_CONNECTION_ID — not exported by the stub module",
      ]);
      const fixed = tree({
        ...files,
        'test/fixtures/dock/harness.ts': harness(
          'src/main/dock-window.ts',
          ["if (/\\/(desktop-)?connections-store$/.test(id)) return '\\0backend';"],
          load,
        ),
      });
      expect(messages(fixed)).toEqual([]);
    });

    it('follows $aliases and does not descend into a stubbed module', () => {
      const root = tree({
        'src/lib/logger.ts': "export { write } from './sink';",
        'src/lib/sink.ts': 'export function write() {}',
        'src/main/entry.ts': ["import { Logger } from '$lib/logger';", 'new Logger();'],
        'test/electron-entry.fixture.ts': harness(
          'src/main/entry.ts',
          [
            "if (id === '$lib/logger') return '\\0logger';",
            "if (id === './sink') return '\\0sink';",
          ],
          [
            "if (id === '\\0logger') return 'export class Logger {}';",
            "if (id === '\\0sink') return 'export function write() {}';",
          ],
        ),
      });
      expect(messages(root)).toEqual([
        "resolveId stub === './sink' matches no import reachable from src/main/entry.ts",
      ]);
    });

    it('only requires a conditional matcher to match, and skips virtual ids', () => {
      const root = tree({
        'src/backend/backend-connection.ts': 'export function connect() {}',
        'src/backend/json-rpc-client.ts': [
          "import { connect, other } from './backend-connection';",
          'connect(); other();',
        ],
        'test/fixtures/review/review.electron.ts': harness(
          'src/backend/json-rpc-client.ts',
          [
            "if (importer?.endsWith('/json-rpc-client.ts') && id === './backend-connection') return '\\0socket';",
            "if (id === 'fixture-renderer') return '\\0renderer';",
          ],
          ["if (id === '\\0socket') return 'export const nothing = 1;';"],
        ),
      });
      expect(messages(root)).toEqual([]);
    });

    it('follows an import used only as a class base, which the build keeps', () => {
      const root = tree({
        'src/main/base.ts': [
          "import { log } from './logger';",
          'export class Base { run() { log(); } }',
        ],
        'src/main/logger.ts': 'export function log() {}',
        'src/main/entry.ts': [
          "import { Base } from './base';",
          "import type { Shape } from './shape';",
          'export class Tool extends Base implements Shape {}',
        ],
        'test/fixtures/native/harness.ts': harness(
          'src/main/entry.ts',
          ["if (id === './logger') return '\\0logger';"],
          ["if (id === '\\0logger') return 'export function write() {}';"],
        ),
      });
      expect(messages(root)).toEqual([
        "resolveId stub === './logger' intercepts './logger' in src/main/base.ts:1, which needs log — not exported by the stub module",
      ]);
    });

    it('skips virtual-module prefixes and pass-through matchers of any kind', () => {
      const root = tree({
        'src/main/entry.ts': 'export const entry = 1;',
        'test/fixtures/native/harness.ts': harness('src/main/entry.ts', [
          "if (id.startsWith('\\0fixture:')) return id;",
          "if (id.startsWith('virtual:fixture')) return '\\0fixture:virtual';",
          'if (/^node:/.test(id)) return { id, external: true };',
          "if (id.endsWith('.css')) return id;",
        ]),
      });
      expect(messages(root)).toEqual([]);
    });

    it('reports a stub plugin whose build entry it cannot find', () => {
      const root = tree({
        'test/fixtures/native/harness.ts': harness('dist/entry.ts', [
          "if (id.endsWith('/backend.ipc')) return '\\0daemon';",
        ]),
      });
      expect(messages(root)).toEqual([
        expect.stringContaining('no build entry found for this resolveId plugin'),
      ]);
    });
  });

  it('reads the value exports of literal stub code', () => {
    expect([
      ...stubExports(
        [
          'export async function getActiveId() {}',
          'export const a = 1, b = 2;',
          'export class Logger {}',
          'const c = 3; export { c as renamed };',
          'export default {};',
        ].join('\n'),
      )!,
    ]).toEqual(['getActiveId', 'a', 'b', 'Logger', 'renamed', 'default']);
    expect(stubExports("export * from './elsewhere';")).toBeNull();
  });

  it('drops allowlisted findings and reports stale allowlist keys', () => {
    const findings = [
      { key: 'test/a.ts: src/x', file: 'test/a.ts', line: 1, message: 'm' },
      { key: 'test/b.ts: src/y', file: 'test/b.ts', line: 2, message: 'm' },
    ];
    expect(
      applyAllowlist(findings, { 'test/a.ts: src/x': 'reason', 'test/c.ts: src/z': 'reason' }),
    ).toEqual({ hits: [findings[1]], stale: ['test/c.ts: src/z'] });
  });
});
