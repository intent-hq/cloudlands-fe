import { describe, expect, it } from 'vitest';
import {
  GEOMETRY_SNAPSHOT_META_KEY,
  GEOMETRY_UPDATE_ALLOW_NON_LINUX_ENV,
  GEOMETRY_UPDATE_ENV,
  assertGeometryUpdateHost,
  baselinePlatformError,
  snapshotStateNames,
} from './geometry-snapshot';

const snapshotPath = '/repo/src/lib/components/ui/button/__geometry__/button.geometry.json';
const cell = { probes: {}, root: { height: 82, width: 420 } };

describe('assertGeometryUpdateHost', () => {
  it.each(['darwin', 'win32'])('refuses an update on %s without the escape hatch', (platform) => {
    expect(() =>
      assertGeometryUpdateHost({ platform, env: { [GEOMETRY_UPDATE_ENV]: '1' } }),
    ).toThrow(/Linux CI/);
  });

  it('names the host platform, the Linux host to use, and the escape hatch', () => {
    expect(() =>
      assertGeometryUpdateHost({ platform: 'darwin', env: { [GEOMETRY_UPDATE_ENV]: '1' } }),
    ).toThrow(
      expect.objectContaining({
        message: expect.stringMatching(
          new RegExp(
            `"darwin".*Inter.*Linux host.*daemon host.*${GEOMETRY_UPDATE_ALLOW_NON_LINUX_ENV}=1.*never be committed`,
          ),
        ),
      }),
    );
  });

  it('allows an update on linux', () => {
    expect(() =>
      assertGeometryUpdateHost({ platform: 'linux', env: { [GEOMETRY_UPDATE_ENV]: '1' } }),
    ).not.toThrow();
  });

  it('allows an update on darwin with the escape hatch', () => {
    expect(() =>
      assertGeometryUpdateHost({
        platform: 'darwin',
        env: { [GEOMETRY_UPDATE_ENV]: '1', [GEOMETRY_UPDATE_ALLOW_NON_LINUX_ENV]: '1' },
      }),
    ).not.toThrow();
  });

  it('ignores the platform when no update is requested', () => {
    expect(() => assertGeometryUpdateHost({ platform: 'darwin', env: {} })).not.toThrow();
    expect(() =>
      assertGeometryUpdateHost({ platform: 'win32', env: { [GEOMETRY_UPDATE_ENV]: '0' } }),
    ).not.toThrow();
  });
});

describe('snapshotStateNames', () => {
  it('excludes the reserved metadata key', () => {
    expect(
      snapshotStateNames({
        [GEOMETRY_SNAPSHOT_META_KEY]: { generatedOn: 'linux' },
        default: { 420: cell },
        loading: { 420: cell },
      }),
    ).toEqual(['default', 'loading']);
  });

  it('returns every state of a baseline without metadata', () => {
    expect(snapshotStateNames({ default: { 420: cell } })).toEqual(['default']);
  });
});

describe('baselinePlatformError', () => {
  it('accepts a baseline generated on linux', () => {
    expect(
      baselinePlatformError(snapshotPath, {
        [GEOMETRY_SNAPSHOT_META_KEY]: { generatedOn: 'linux' },
        default: { 420: cell },
      }),
    ).toBeUndefined();
  });

  it('rejects a baseline generated on darwin, naming the platform and the path', () => {
    const error = baselinePlatformError(snapshotPath, {
      [GEOMETRY_SNAPSHOT_META_KEY]: { generatedOn: 'darwin' },
      default: { 420: cell },
    });
    expect(error).toContain(snapshotPath);
    expect(error).toContain('generated on "darwin"');
    expect(error).toContain('regenerated on Linux');
  });

  it('rejects a baseline without metadata', () => {
    const error = baselinePlatformError(snapshotPath, { default: { 420: cell } });
    expect(error).toContain(snapshotPath);
    expect(error).toContain('regenerated on Linux');
    expect(error).toContain(`${GEOMETRY_SNAPSHOT_META_KEY}.generatedOn`);
  });

  it('rejects malformed metadata', () => {
    expect(
      baselinePlatformError(snapshotPath, { [GEOMETRY_SNAPSHOT_META_KEY]: 'linux' }),
    ).toContain('regenerated on Linux');
    expect(
      baselinePlatformError(snapshotPath, { [GEOMETRY_SNAPSHOT_META_KEY]: { generatedOn: 7 } }),
    ).toContain('regenerated on Linux');
  });
});
