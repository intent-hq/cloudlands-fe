import { afterEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as net from 'node:net';
import { spawnSync } from 'node:child_process';
import { isolatedProfileHome } from '../test/fixtures/isolated-profile-home';
import * as path from 'node:path';
import { isolatedTestEnvironment, prepareIsolatedTestProfile } from './isolated-test-profile';

const roots: string[] = [];
const backend = '1234567890123456789012345678901234567890';
function home(): string {
  const root = isolatedProfileHome('manual-123-1');
  roots.push(root);
  return root;
}
afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe('isolated manual package state', () => {
  it('discovers a host-installed Claude executable with a GUI PATH while retaining private state', () => {
    const original = home();
    const bin = path.join(original, '.local', 'bin');
    fs.mkdirSync(bin, { recursive: true });
    fs.writeFileSync(path.join(bin, 'claude'), '#!/bin/sh\nprintf "%s" "$HOME"\n', {
      mode: 0o700,
    });
    const profile = prepareIsolatedTestProfile(original, 'manual-152-1', backend);
    const env = isolatedTestEnvironment(profile, {
      HOME: original,
      PATH: '/usr/bin:/bin',
      CLAUDE_CONFIG_DIR: path.join(original, '.claude'),
      ANTHROPIC_API_KEY: 'normal-profile-sentinel',
    });
    const result = spawnSync('claude', ['--version'], { env, encoding: 'utf8' });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(result.stdout).toBe(profile.home);
    expect(env.CLAUDE_CONFIG_DIR).toBeUndefined();
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(fs.readdirSync(original)).toEqual(expect.arrayContaining(['.local', '.intent-tests']));
    expect(fs.existsSync(path.join(original, '.claude'))).toBe(false);
  });

  it('resolves symlinked CLI and sibling node/npx from a concrete nvm installation', () => {
    const original = home();
    const native = path.join(original, '.local', 'bin');
    const nodeBin = path.join(original, '.nvm', 'versions', 'node', 'v24.10.0', 'bin');
    fs.mkdirSync(native, { recursive: true });
    fs.mkdirSync(nodeBin, { recursive: true });
    fs.symlinkSync(process.execPath, path.join(nodeBin, 'node'));
    const script = path.join(original, 'fixture-cli');
    fs.writeFileSync(
      script,
      '#!/usr/bin/env node\nconsole.log(JSON.stringify({home:process.env.HOME,entry:process.argv[1]}));\n',
      { mode: 0o700 },
    );
    fs.symlinkSync(script, path.join(native, 'claude'));
    fs.symlinkSync(script, path.join(nodeBin, 'npx'));
    const profile = prepareIsolatedTestProfile(original, 'manual-152-1', backend);
    const env = isolatedTestEnvironment(profile, { PATH: '/nonexistent-gui-tools' });
    for (const [command, entry] of [
      ['claude', path.join(native, 'claude')],
      ['npx', path.join(nodeBin, 'npx')],
    ]) {
      const result = spawnSync(command, ['--version'], { env, encoding: 'utf8' });
      expect(result.error).toBeUndefined();
      expect(result.status).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual({ home: profile.home, entry });
    }
    expect(fs.readlinkSync(path.join(native, 'claude'))).toBe(script);
  });

  it('keeps inherited PATH precedence, deduplicates and excludes HOME-dependent shims', () => {
    const original = home();
    const names = [
      '.local/bin',
      '.npm-global/bin',
      '.npm-packages/bin',
      '.nvm/versions/node/v9.0.0/bin',
      '.nvm/versions/node/v24.10.0/bin',
      '.nvm/versions/node/not-a-version/bin',
      '.volta/bin',
      '.asdf/shims',
    ];
    for (const name of names) fs.mkdirSync(path.join(original, name), { recursive: true });
    const profile = prepareIsolatedTestProfile(original, 'manual-152-1', backend);
    const inherited = `/usr/bin:${path.join(original, '.npm-global/bin')}`;
    const env = isolatedTestEnvironment(profile, { PATH: inherited, HOME: '/untrusted-home' });
    expect(env.PATH?.split(path.delimiter)).toEqual([
      '/usr/bin',
      path.join(original, '.npm-global/bin'),
      path.join(original, '.local/bin'),
      path.join(original, '.npm-packages/bin'),
      path.join(original, '.nvm/versions/node/v24.10.0/bin'),
      path.join(original, '.nvm/versions/node/v9.0.0/bin'),
    ]);
    expect(env.HOME).toBe(profile.home);
  });

  it('uses unique private canonical homes and real sockets even below a long temp root', async () => {
    const parent = home();
    const longTemp = path.join(parent, 'long-temporary-directory-'.repeat(4));
    fs.mkdirSync(longTemp);
    const first = isolatedProfileHome('manual-123-1', longTemp);
    roots.push(first);
    const second = isolatedProfileHome('manual-123-1', longTemp);
    roots.push(second);
    expect(first).not.toBe(second);
    expect(fs.realpathSync(first)).toBe(first);
    expect(fs.statSync(first).mode & 0o777).toBe(0o700);
    expect(fs.readdirSync(longTemp)).toEqual([]);
    const profile = prepareIsolatedTestProfile(first, 'manual-123-1', backend);
    const server = net.createServer((socket) => socket.end('private socket'));
    try {
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(profile.socket, resolve);
      });
      const received = await new Promise<string>((resolve, reject) => {
        const client = net.connect(profile.socket);
        let data = '';
        client.on('data', (chunk) => {
          data += chunk.toString();
        });
        client.once('end', () => resolve(data));
        client.once('error', reject);
      });
      expect(received).toBe('private socket');
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      fs.rmSync(first, { recursive: true, force: true });
      fs.rmSync(second, { recursive: true, force: true });
    }
    expect(fs.existsSync(first)).toBe(false);
    expect(fs.existsSync(second)).toBe(false);
  });

  it('still rejects an oversized canonical home before creating profile state', () => {
    const original = path.join(home(), 'oversized-home-'.repeat(8));
    fs.mkdirSync(original);
    expect(() => prepareIsolatedTestProfile(original, 'manual-123-1', backend)).toThrow(
      'socket path is too long',
    );
    expect(fs.readdirSync(original)).toEqual([]);
  });

  it('leaves normal state untouched and binds both processes to private paths on relaunch', () => {
    const original = home();
    const normal = path.join(original, 'Library', 'Application Support', 'intentd');
    fs.mkdirSync(normal, { recursive: true });
    fs.writeFileSync(path.join(normal, 'intentd.db'), 'normal database sentinel');
    const before = fs.statSync(path.join(normal, 'intentd.db'));
    const profile = prepareIsolatedTestProfile(original, 'manual-123-1', backend);
    expect(profile.data).not.toBe(normal);
    expect(profile.userData).toBe(path.join(original, '.intent-tests/manual-123-1/desktop'));
    expect(profile.socket).toBe(path.join(profile.data, 'intentd.sock'));
    expect(fs.statSync(profile.data).mode & 0o777).toBe(0o700);
    expect(fs.statSync(profile.config).mode & 0o777).toBe(0o600);
    fs.writeFileSync(path.join(profile.data, 'intentd.db'), 'private database');
    expect(prepareIsolatedTestProfile(original, 'manual-123-1', backend)).toEqual(profile);
    expect(fs.readFileSync(path.join(normal, 'intentd.db'), 'utf8')).toBe(
      'normal database sentinel',
    );
    expect(fs.statSync(path.join(normal, 'intentd.db')).mtimeMs).toBe(before.mtimeMs);
    expect(fs.readFileSync(path.join(profile.data, 'intentd.db'), 'utf8')).toBe('private database');
    expect(() => prepareIsolatedTestProfile(original, 'manual-123-1', 'a'.repeat(40))).toThrow(
      'different backend',
    );
  });

  it('discards ambient credentials, transport/binary overrides, injection and legacy roots', () => {
    const profile = prepareIsolatedTestProfile(home(), 'manual-124-1', backend);
    const inherited = {
      PATH: '/usr/bin',
      HOME: '/normal',
      INTENTD_BIN: '/normal/daemon',
      INTENTD_SOCKET: '/normal/socket',
      INTENTD_WS_URL: 'wss://normal',
      INTENTD_TCP: 'normal:123',
      INTENTD_CONFIG: '/normal/config',
      INTENTD_LEGACY_IMPORT_ROOTS: '/normal/workspaces',
      GH_TOKEN: 'not-a-real-credential',
      SSH_AUTH_SOCK: '/normal/agent',
      NODE_OPTIONS: '--require=/normal/injection',
      DYLD_INSERT_LIBRARIES: '/normal/injection',
    };
    const env = isolatedTestEnvironment(profile, inherited);
    expect(env).toMatchObject({
      HOME: profile.home,
      INTENTD_DATA_DIR: profile.data,
      INTENTD_CONFIG: profile.config,
      INTENTD_LEGACY_IMPORT_ROOTS: '',
      INTENTD_LEGACY_APP_DIR: '',
      INTENTD_DISABLE_GH_CREDENTIALS: '1',
      INTENTD_PRIVATE_TEST_PROFILE: '1',
      INTENTD_SIDECAR: '1',
      PATH: '/usr/bin',
    });
    for (const key of [
      'INTENTD_BIN',
      'INTENTD_SOCKET',
      'INTENTD_WS_URL',
      'INTENTD_TCP',
      'GH_TOKEN',
      'SSH_AUTH_SOCK',
      'NODE_OPTIONS',
      'DYLD_INSERT_LIBRARIES',
    ]) {
      expect(env[key]).toBeUndefined();
    }
    expect(inherited.HOME).toBe('/normal');
  });

  it.each(['', '../normal', 'manual-0-1', 'manual-123-0', 'manual-123-1/elsewhere'])(
    'rejects invalid build identity %j before creating test state',
    (id) => {
      const original = home();
      expect(() => prepareIsolatedTestProfile(original, id, backend)).toThrow('identity');
      expect(fs.readdirSync(original)).toEqual([]);
    },
  );

  it('refuses links and shared permissions while preserving ordinary private preference changes', () => {
    const original = home();
    const normal = home();
    fs.symlinkSync(normal, path.join(original, '.intent-tests'));
    expect(() => prepareIsolatedTestProfile(original, 'manual-123-1', backend)).toThrow('Unsafe');
    expect(fs.readdirSync(normal)).toEqual([]);
    fs.unlinkSync(path.join(original, '.intent-tests'));
    fs.mkdirSync(path.join(original, '.intent-tests'), { mode: 0o755 });
    fs.chmodSync(path.join(original, '.intent-tests'), 0o755);
    expect(() => prepareIsolatedTestProfile(original, 'manual-123-1', backend)).toThrow('Unsafe');
    expect(fs.statSync(path.join(original, '.intent-tests')).mode & 0o777).toBe(0o755);
    const profile = prepareIsolatedTestProfile(home(), 'manual-125-1', backend);
    fs.appendFileSync(profile.config, '\n[workspace]\nbranchPrefix = "isolation-ci"\n');
    const saved = fs.readFileSync(profile.config, 'utf8');
    expect(
      prepareIsolatedTestProfile(path.dirname(path.dirname(profile.root)), 'manual-125-1', backend),
    ).toEqual(profile);
    expect(fs.readFileSync(profile.config, 'utf8')).toBe(saved);
    fs.unlinkSync(profile.config);
    fs.symlinkSync(path.join(normal, 'config.toml'), profile.config);
    expect(() =>
      prepareIsolatedTestProfile(path.dirname(path.dirname(profile.root)), 'manual-125-1', backend),
    ).toThrow('Unsafe');
  });

  it('refuses an occupied endpoint and hard-linked database before reuse', () => {
    const original = home();
    const profile = prepareIsolatedTestProfile(original, 'manual-123-1', backend);
    fs.writeFileSync(profile.socket, 'existing endpoint sentinel');
    expect(() => prepareIsolatedTestProfile(original, 'manual-123-1', backend)).toThrow(
      'socket already exists',
    );
    expect(fs.readFileSync(profile.socket, 'utf8')).toBe('existing endpoint sentinel');
    fs.unlinkSync(profile.socket);
    const normal = path.join(original, 'normal.db');
    fs.writeFileSync(normal, 'untouched');
    fs.linkSync(normal, path.join(profile.data, 'intentd.db'));
    expect(() => prepareIsolatedTestProfile(original, 'manual-123-1', backend)).toThrow('Unsafe');
    expect(fs.readFileSync(normal, 'utf8')).toBe('untouched');
  });
});
