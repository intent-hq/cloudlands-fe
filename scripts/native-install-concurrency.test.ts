// @verify-changed-triggers: .npmrc
// @vitest-environment node

import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, it } from 'vitest';
import { pnpmInvocation } from './pnpm-launcher.mjs';

it('finishes each dependency build before another can overwrite shared Node headers', () => {
  const root = mkdtempSync(join(tmpdir(), 'native-install-concurrency-'));
  try {
    copyFileSync(resolve('.npmrc'), join(root, '.npmrc'));
    const packages = ['header-consumer-a', 'header-consumer-b'];
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({
        private: true,
        dependencies: Object.fromEntries(packages.map((name) => [name, `file:./${name}`])),
        pnpm: { onlyBuiltDependencies: packages },
      }),
    );
    for (const name of packages) {
      const directory = join(root, name);
      mkdirSync(directory);
      writeFileSync(
        join(directory, 'package.json'),
        JSON.stringify({ name, version: '1.0.0', scripts: { install: 'node install.cjs' } }),
      );
      // Hold the shared resource across an asynchronous build phase. Concurrent
      // hooks fail at exclusive creation, instead of relying on a timing assertion.
      writeFileSync(
        join(directory, 'install.cjs'),
        `const fs = require('node:fs');
const path = require('node:path');
const root = process.env.NATIVE_INSTALL_FIXTURE;
const lock = path.join(root, 'headers-in-use');
try { fs.mkdirSync(lock); } catch { throw new Error('Concurrent native header consumer'); }
fs.appendFileSync(path.join(root, 'events'), ${JSON.stringify(`start ${name}\n`)});
setTimeout(() => {
  fs.appendFileSync(path.join(root, 'events'), ${JSON.stringify(`end ${name}\n`)});
  fs.rmdirSync(lock);
}, 500);
`,
      );
    }
    const env = {
      ...process.env,
      NATIVE_INSTALL_FIXTURE: root,
      CI: 'true',
      TMPDIR: root,
      TEMP: root,
      TMP: root,
      XDG_CACHE_HOME: join(root, 'cache'),
      npm_config_cache: join(root, 'npm-cache'),
    };
    const install = (args: string[]) => {
      const command = pnpmInvocation([...args, '--store-dir', join(root, 'store')], { env });
      const result = spawnSync(command.executable, command.args, {
        cwd: root,
        env,
        shell: command.shell,
        encoding: 'utf8',
        timeout: 20_000,
      });
      expect(result.error, result.stderr).toBeUndefined();
      expect(result.status, result.stdout + result.stderr).toBe(0);
    };
    install(['install', '--offline', '--lockfile-only', '--ignore-scripts']);
    install(['install', '--offline', '--frozen-lockfile']);
    const events = readFileSync(join(root, 'events'), 'utf8').trim().split('\n');
    expect(events).toHaveLength(4);
    expect(events[0]).toMatch(/^start /);
    expect(events[1]).toBe(events[0].replace('start ', 'end '));
    expect(events[2]).toMatch(/^start /);
    expect(events[3]).toBe(events[2].replace('start ', 'end '));
    expect(new Set([events[0], events[2]]).size).toBe(2);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
