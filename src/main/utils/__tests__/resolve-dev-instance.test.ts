import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DEV_INTENTD_DIR_NAME,
  devIntentdSocketPathByteLength,
  MACOS_SUN_PATH_MAX_BYTES,
  resolveDevInstance,
  resolveDevIntentdDataDir,
  resolveDevUserDataDirName,
  resolveUserDataBasePath,
  shouldIsolateDevIntentdDataDir,
  USER_DATA_DIR_NAME,
} from '../resolve-dev-instance';

const ENV_KEYS = ['NODE_ENV', 'DEV_INSTANCE', 'DEV_PORT'] as const;

describe('resolveDevInstance', () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of ENV_KEYS) saved[key] = process.env[key];
    for (const key of ENV_KEYS) delete process.env[key];
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  it('returns DEV_INSTANCE verbatim when set', () => {
    process.env.DEV_INSTANCE = '3';
    expect(resolveDevInstance()).toBe('3');
  });

  it('derives 1-based instance from DEV_PORT relative to base 5190', () => {
    process.env.DEV_PORT = '5191';
    expect(resolveDevInstance()).toBe('2');
  });

  it('returns empty string when nothing usable is set', () => {
    expect(resolveDevInstance()).toBe('');
  });
});

describe('resolveDevUserDataDirName', () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of ENV_KEYS) saved[key] = process.env[key];
    for (const key of ENV_KEYS) delete process.env[key];
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  it('returns null outside development', () => {
    process.env.NODE_ENV = 'production';
    process.env.DEV_PORT = '5190';
    expect(resolveDevUserDataDirName()).toBeNull();
  });

  it('namespaces by absolute DEV_PORT in development', () => {
    process.env.NODE_ENV = 'development';
    process.env.DEV_PORT = '5190';
    expect(resolveDevUserDataDirName()).toBe('cloudlands-dev-5190');
  });

  it('cannot collide with reference Intent dev-instance-N naming', () => {
    process.env.NODE_ENV = 'development';
    process.env.DEV_PORT = '5177';
    const name = resolveDevUserDataDirName();
    expect(name).toBe('cloudlands-dev-5177');
    expect(name).not.toMatch(/^dev-instance-/);
  });

  it('falls back to unprefixed name when DEV_PORT is unset in dev', () => {
    process.env.NODE_ENV = 'development';
    expect(resolveDevUserDataDirName()).toBe('cloudlands-dev');
  });

  it('falls back to unprefixed name when DEV_PORT is not a positive number', () => {
    process.env.NODE_ENV = 'development';
    process.env.DEV_PORT = 'not-a-number';
    expect(resolveDevUserDataDirName()).toBe('cloudlands-dev');
  });
});

describe('resolveUserDataBasePath', () => {
  it('joins the appData path with the intent-cloudlands dir name', () => {
    expect(resolveUserDataBasePath('/Users/me/Library/Application Support')).toBe(
      path.join('/Users/me/Library/Application Support', 'intent-cloudlands'),
    );
  });

  it('uses the exported USER_DATA_DIR_NAME constant', () => {
    expect(USER_DATA_DIR_NAME).toBe('intent-cloudlands');
    expect(resolveUserDataBasePath('/base')).toBe(path.join('/base', USER_DATA_DIR_NAME));
  });

  it('composes with the dev segment to yield intent-cloudlands/cloudlands-dev-PORT', () => {
    const base = resolveUserDataBasePath('/appdata');
    expect(path.join(base, 'cloudlands-dev-5190')).toBe(
      path.join('/appdata', 'intent-cloudlands', 'cloudlands-dev-5190'),
    );
  });
});

describe('resolveDevIntentdDataDir', () => {
  const APP_DATA = '/Users/me/Library/Application Support';

  it('namespaces by absolute DEV_PORT under intentd-fe', () => {
    expect(resolveDevIntentdDataDir(APP_DATA, { DEV_PORT: '5190' })).toBe(
      path.join(APP_DATA, 'intentd-fe', '5190'),
    );
  });

  it('is deterministic for the same port and distinct across ports', () => {
    const a = resolveDevIntentdDataDir(APP_DATA, { DEV_PORT: '5190' });
    expect(resolveDevIntentdDataDir(APP_DATA, { DEV_PORT: '5190' })).toBe(a);
    expect(resolveDevIntentdDataDir(APP_DATA, { DEV_PORT: '5191' })).not.toBe(a);
  });

  it('falls back to the "dev" segment when DEV_PORT is unset or unusable', () => {
    const fallback = path.join(APP_DATA, 'intentd-fe', 'dev');
    expect(resolveDevIntentdDataDir(APP_DATA, {})).toBe(fallback);
    expect(resolveDevIntentdDataDir(APP_DATA, { DEV_PORT: 'not-a-number' })).toBe(fallback);
    expect(resolveDevIntentdDataDir(APP_DATA, { DEV_PORT: '0' })).toBe(fallback);
  });

  it('stays outside the pruned intent-cloudlands userData namespace', () => {
    const dataDir = resolveDevIntentdDataDir(APP_DATA, { DEV_PORT: '5190' });
    expect(dataDir.startsWith(path.join(APP_DATA, USER_DATA_DIR_NAME))).toBe(false);
    expect(dataDir).not.toContain('cloudlands-dev');
    expect(DEV_INTENTD_DIR_NAME).toBe('intentd-fe');
  });

  it('keeps the derived socket path within the macOS sun_path limit', () => {
    expect(devIntentdSocketPathByteLength(APP_DATA, { DEV_PORT: '5190' })).toBeLessThanOrEqual(
      MACOS_SUN_PATH_MAX_BYTES,
    );
  });

  it('adds only 8 bytes over the pre-existing global default socket path', () => {
    const ours = devIntentdSocketPathByteLength(APP_DATA, { DEV_PORT: '5190' });
    const globalDefault = Buffer.byteLength(path.join(APP_DATA, 'intentd', 'intentd.sock'), 'utf8');
    expect(ours - globalDefault).toBe(8);
  });

  it('stays within sun_path for a long username and a long DEV_PORT', () => {
    const longUser = 'a'.repeat(32);
    const longAppData = `/Users/${longUser}/Library/Application Support`;
    expect(devIntentdSocketPathByteLength(longAppData, { DEV_PORT: '65535' })).toBeLessThanOrEqual(
      MACOS_SUN_PATH_MAX_BYTES,
    );
  });

  it('documents the appData budget the layout leaves for sun_path', () => {
    // Overhead is independent of appData, so the budget is a property of the layout.
    const overhead = devIntentdSocketPathByteLength('', { DEV_PORT: '5190' });
    expect(overhead).toBe(Buffer.byteLength(path.join('intentd-fe', '5190', 'intentd.sock')));
    expect(MACOS_SUN_PATH_MAX_BYTES - overhead).toBeGreaterThanOrEqual(
      Buffer.byteLength(APP_DATA, 'utf8'),
    );
  });
});

describe('shouldIsolateDevIntentdDataDir', () => {
  it('isolates dev builds with no INTENTD_* env', () => {
    expect(shouldIsolateDevIntentdDataDir({}, true)).toBe(true);
  });

  it('replaces an inherited INTENTD_DATA_DIR in dev (no escape hatch)', () => {
    expect(shouldIsolateDevIntentdDataDir({ INTENTD_DATA_DIR: '/legacy/data' }, true)).toBe(true);
  });

  it('never isolates a packaged build', () => {
    expect(shouldIsolateDevIntentdDataDir({ DEV_PORT: '5190' }, false)).toBe(false);
  });

  it('keys off the caller-supplied isDev, not NODE_ENV', () => {
    // Mirrors `!app.isPackaged` in backend.ipc.ts: an unpackaged launch without NODE_ENV
    // still resolves a dev UDS socket, so it must be isolated...
    expect(shouldIsolateDevIntentdDataDir({ INTENTD_SIDECAR: '1' }, true)).toBe(true);
    // ...and a packaged build inheriting NODE_ENV=development must not be.
    expect(shouldIsolateDevIntentdDataDir({ NODE_ENV: 'development' }, false)).toBe(false);
  });

  it('defers to explicit transport overrides', () => {
    for (const key of ['INTENTD_SOCKET', 'INTENTD_WS_URL', 'INTENTD_TCP'] as const) {
      expect(shouldIsolateDevIntentdDataDir({ [key]: 'x' }, true)).toBe(false);
    }
  });

  it('ignores whitespace-only transport overrides', () => {
    expect(shouldIsolateDevIntentdDataDir({ INTENTD_SOCKET: '  ' }, true)).toBe(true);
  });
});
