// @verify-changed-exempt: builds its own dist trees in temp directories.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { packageNameOf, scanMainRuntimeImports } from './verify-main-runtime-imports.mjs';

const roots: string[] = [];

function makeRoot(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'main-runtime-imports-'));
  roots.push(root);
  for (const [file, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), text);
  }
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

const ENTRY = 'dist/main/index.js';
const RUNTIME = { dependencies: ['zod', '@themislib/themis'], allowlist: {} };

function scan(files: Record<string, string>, options: Partial<typeof RUNTIME> = {}) {
  return scanMainRuntimeImports({
    root: makeRoot(files),
    entries: [ENTRY],
    ...RUNTIME,
    ...options,
  });
}

describe('main-process runtime import scan', () => {
  it('flags a devDependency reached through a relative chain (cloudlands-fe#654)', () => {
    const result = scan({
      [ENTRY]: "import { start } from '../features/agent/main/backend.js';\nstart();\n",
      'dist/features/agent/main/backend.js':
        "export { start } from '../../../shared/store-bridge.js';\n",
      'dist/shared/store-bridge.js':
        "import { writable } from 'svelte/store';\nexport const start = () => writable(0);\n",
    });
    expect(result.findings).toEqual([
      expect.objectContaining({
        kind: 'not-a-runtime-dependency',
        file: 'dist/shared/store-bridge.js',
        specifier: 'svelte/store',
        packageName: 'svelte',
        line: 1,
        chain: [ENTRY, 'dist/features/agent/main/backend.js', 'dist/shared/store-bridge.js'],
      }),
    ]);
  });

  it('fails when an entry point is missing instead of passing on an empty graph', () => {
    const result = scan({ 'dist/main/other.js': 'export {};\n' });
    expect(result.findings).toEqual([
      expect.objectContaining({ kind: 'missing-entry', file: ENTRY }),
    ]);
  });

  it('flags a relative import whose target was not built', () => {
    const result = scan({ [ENTRY]: "import './gone.js';\n" });
    expect(result.findings).toEqual([
      expect.objectContaining({ kind: 'missing-module', file: ENTRY, specifier: './gone.js' }),
    ]);
  });

  it('flags an alias the ESM import fixer left unresolved', () => {
    const result = scan({ [ENTRY]: "import { x } from '$shared/x.js';\nx();\n" });
    expect(result.findings).toEqual([
      expect.objectContaining({ kind: 'not-a-runtime-dependency', packageName: '$shared' }),
    ]);
  });

  it('accepts runtime dependencies, Node builtins, and electron', () => {
    const result = scan({
      [ENTRY]: [
        "import fs from 'node:fs';",
        "import path from 'path';",
        "import { app } from 'electron';",
        "import { ipcMain } from 'electron/main';",
        "import { z } from 'zod';",
        "import { Themis } from '@themislib/themis/runtime';",
        "import data from './data.json' with { type: 'json' };",
        "import addon from './addon.node';",
        'console.log(fs, path, app, ipcMain, z, Themis, data, addon);',
      ].join('\n'),
      'dist/main/data.json': '{}',
      'dist/main/addon.node': '',
    });
    expect(result.findings).toEqual([]);
    expect(result.visited).toEqual([ENTRY, 'dist/main/data.json', 'dist/main/addon.node']);
  });

  it('follows dynamic imports, re-exports, and createRequire calls', () => {
    const result = scan({
      [ENTRY]: [
        "import { createRequire } from 'node:module';",
        'const require = createRequire(import.meta.url);',
        "export * from './reexported.js';",
        "const lazy = () => import('./lazy.js');",
        "const cjs = require('./legacy.cjs');",
        'console.log(lazy, cjs);',
      ].join('\n'),
      'dist/main/reexported.js': "export * from 'svelte';\n",
      'dist/main/lazy.js': 'await import(`@sveltejs/kit`);\n',
      'dist/main/legacy.cjs': "module.exports = require('vitest');\n",
    });
    expect(result.findings.map((finding) => finding.packageName).sort()).toEqual([
      '@sveltejs/kit',
      'svelte',
      'vitest',
    ]);
  });

  it('ignores specifiers that only appear in comments or plain strings', () => {
    const result = scan({
      [ENTRY]: [
        "// import 'svelte';",
        "/* require('svelte') */",
        'const message = "import(\'svelte\')";',
        'console.log(message);',
      ].join('\n'),
    });
    expect(result.findings).toEqual([]);
  });

  it('terminates on import cycles and reports each finding once', () => {
    const result = scan({
      [ENTRY]: "import './a.js';\n",
      'dist/main/a.js': "import './b.js';\nimport 'svelte';\n",
      'dist/main/b.js': "import './a.js';\nimport './index.js';\n",
    });
    expect(result.visited).toEqual([ENTRY, 'dist/main/a.js', 'dist/main/b.js']);
    expect(result.findings).toHaveLength(1);
  });

  it('flags a named import that Node cannot detect in a CommonJS package (ssh2 utils)', async () => {
    const files = {
      [ENTRY]: [
        "import { Client, utils as sshUtils } from 'ssh2';",
        "export { Server } from 'ssh2';",
        'console.log(Client, sshUtils);',
      ].join('\n'),
      'node_modules/ssh2/package.json': JSON.stringify({ name: 'ssh2', main: './lib/index.js' }),
      'node_modules/ssh2/lib/client.js': 'module.exports = class Client {};\n',
      'node_modules/ssh2/lib/server.js': 'module.exports = class Server {};\n',
      'node_modules/ssh2/lib/keyParser.js': 'exports.parseKey = () => null;\n',
      // The shape of ssh2@1.17.0 lib/index.js: the lexer stops at the first
      // non-shorthand property after `Client: require(...)`.
      'node_modules/ssh2/lib/index.js': [
        "'use strict';",
        "const { parseKey } = require('./keyParser.js');",
        'const OpenSSHAgent = class {};',
        'module.exports = {',
        "  Client: require('./client.js'),",
        '  OpenSSHAgent,',
        "  Server: require('./server.js'),",
        '  utils: { parseKey },',
        '};',
      ].join('\n'),
    };
    const root = makeRoot(files);
    const result = scanMainRuntimeImports({
      root,
      entries: [ENTRY],
      dependencies: ['ssh2'],
      allowlist: {},
    });

    expect(result.findings).toEqual([
      expect.objectContaining({
        kind: 'missing-named-export',
        file: ENTRY,
        specifier: 'ssh2',
        line: 1,
        names: ['utils'],
      }),
      expect.objectContaining({
        kind: 'missing-named-export',
        file: ENTRY,
        specifier: 'ssh2',
        line: 2,
        names: ['Server'],
      }),
    ]);
    const loaded = await import(
      pathToFileURL(path.join(root, 'node_modules/ssh2/lib/index.js')).href
    );
    expect(Object.keys(loaded)).toContain('Client');
    expect(Object.keys(loaded)).not.toContain('utils');
    expect(Object.keys(loaded)).not.toContain('Server');
  });

  it('accepts named imports Node detects, default and namespace imports, and ESM packages', () => {
    const result = scanMainRuntimeImports({
      root: makeRoot({
        [ENTRY]: [
          "import ssh2, { Client } from 'ssh2';",
          "import * as everything from 'ssh2';",
          "import { parseKey } from 'ssh2/lib/keyParser.js';",
          "import { fromEsm } from 'dual';",
          "import { fromModule } from 'esm-only';",
          'console.log(ssh2, everything, Client, parseKey, fromEsm, fromModule);',
        ].join('\n'),
        'node_modules/ssh2/package.json': JSON.stringify({ name: 'ssh2' }),
        'node_modules/ssh2/index.js': "module.exports = require('./lib/impl.js');\n",
        'node_modules/ssh2/lib/impl.js': 'exports.Client = class {};\nexports.utils = {};\n',
        'node_modules/ssh2/lib/keyParser.js': 'exports.parseKey = () => null;\n',
        'node_modules/dual/package.json': JSON.stringify({
          name: 'dual',
          exports: { '.': { import: './esm.mjs', require: './cjs.cjs' } },
        }),
        'node_modules/dual/esm.mjs': 'export const fromEsm = 1;\n',
        'node_modules/dual/cjs.cjs': 'module.exports = { ...{ fromEsm: 1 } };\n',
        'node_modules/esm-only/package.json': JSON.stringify({
          name: 'esm-only',
          type: 'module',
          main: 'index.js',
        }),
        'node_modules/esm-only/index.js': 'export const fromModule = 1;\n',
      }),
      entries: [ENTRY],
      dependencies: ['ssh2', 'dual', 'esm-only'],
      allowlist: {},
    });
    expect(result.findings).toEqual([]);
  });

  it('suppresses an allowlisted import and reports allowlist entries that match nothing', () => {
    const files = {
      [ENTRY]: "try { await import('svelte'); } catch {}\n",
    };
    const result = scan(files, {
      allowlist: {
        'dist/main/index.js -> svelte': 'guarded optional import',
        'dist/main/index.js -> vitest': 'no longer imported',
      },
    });
    expect(result.findings).toEqual([
      expect.objectContaining({ kind: 'stale-allowlist', key: 'dist/main/index.js -> vitest' }),
    ]);
  });
});

describe('packageNameOf', () => {
  it.each([
    ['svelte', 'svelte'],
    ['svelte/store', 'svelte'],
    ['@sveltejs/kit', '@sveltejs/kit'],
    ['@sveltejs/kit/node', '@sveltejs/kit'],
    ['node:fs', null],
    ['fs/promises', null],
    ['./x.js', null],
    ['/abs/x.js', null],
  ])('%s -> %s', (specifier, name) => {
    expect(packageNameOf(specifier)).toBe(name);
  });
});
