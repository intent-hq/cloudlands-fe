import { describe, expect, it, vi } from 'vitest';

/**
 * Tests for buildSidecarSpawnEnv (features/backend/main/intentd-sidecar.ts):
 * the daemon spawn env must carry `INTENTD_TAILCAT_BIN` pointing at the
 * app-bundled tailcat client when one exists (intentd's own probing cannot
 * find the Electron-packaged binary), must omit it fail-soft when no bundled
 * binary resolves, and must never clobber a user-provided override. The
 * tailcat resolver is injected, so no fs access happens here.
 */

vi.mock('$shared/logger', () => ({
  Logger: class {
    debug() {}
    info() {}
    warn() {}
    error() {}
  },
}));

import { buildSidecarSpawnEnv } from '../intentd-sidecar';

describe('buildSidecarSpawnEnv', () => {
  it('sets INTENTD_TAILCAT_BIN when a bundled tailcat resolves', () => {
    const env: NodeJS.ProcessEnv = { PATH: '/usr/bin' };
    const spawnEnv = buildSidecarSpawnEnv(env, () => '/app/Resources/tailcat/tailcat');

    expect(spawnEnv.INTENTD_TAILCAT_BIN).toBe('/app/Resources/tailcat/tailcat');
    // Input env is not mutated.
    expect(env.INTENTD_TAILCAT_BIN).toBeUndefined();
  });

  it('omits INTENTD_TAILCAT_BIN when no bundled tailcat exists (fail-soft)', () => {
    const spawnEnv = buildSidecarSpawnEnv({ PATH: '/usr/bin' }, () => null);

    expect('INTENTD_TAILCAT_BIN' in spawnEnv).toBe(false);
  });

  it('preserves a user-provided INTENTD_TAILCAT_BIN without consulting the resolver', () => {
    const resolve = vi.fn(() => '/app/Resources/tailcat/tailcat');
    const spawnEnv = buildSidecarSpawnEnv({ INTENTD_TAILCAT_BIN: '/opt/custom/tailcat' }, resolve);

    expect(spawnEnv.INTENTD_TAILCAT_BIN).toBe('/opt/custom/tailcat');
    expect(resolve).not.toHaveBeenCalled();
  });

  it('treats a whitespace-only INTENTD_TAILCAT_BIN as unset', () => {
    const spawnEnv = buildSidecarSpawnEnv({ INTENTD_TAILCAT_BIN: '   ' }, () => '/bundled/tailcat');

    expect(spawnEnv.INTENTD_TAILCAT_BIN).toBe('/bundled/tailcat');
  });

  it('keeps the existing INTENTD_DATA_DIR trimming behavior', () => {
    const spawnEnv = buildSidecarSpawnEnv({ INTENTD_DATA_DIR: '  /data/dir  ' }, () => null);

    expect(spawnEnv.INTENTD_DATA_DIR).toBe('/data/dir');
  });
});
