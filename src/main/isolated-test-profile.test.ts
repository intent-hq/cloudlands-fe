import { afterEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { isolatedTestEnvironment, prepareIsolatedTestProfile } from './isolated-test-profile';

const roots: string[] = [];
const backend = '1234567890123456789012345678901234567890';
function home(): string {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'it-')));
  roots.push(root);
  return root;
}
afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe('isolated manual package state', () => {
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
