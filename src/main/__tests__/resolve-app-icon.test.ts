import path from 'path';
import { describe, expect, it } from 'vitest';
import { resolveAppDockIconPath, resolveAppIconPath } from '../utils/resolve-app-icon';

const iconsDirectory = path.join('test', 'icons');
const fileExists = () => true;

describe('resolveAppIconPath', () => {
  it.each([
    ['darwin', 'dev-icon.icns'],
    ['win32', 'dev-icon.ico'],
    ['linux', 'dev-icon.png'],
  ] as const)('uses the development icon for unpackaged %s windows', (platform, filename) => {
    expect(
      resolveAppIconPath({
        isPackaged: false,
        nodeEnv: 'development',
        platform,
        iconsDirectory,
        fileExists,
      }),
    ).toBe(path.join(iconsDirectory, filename));
  });

  it.each([
    { isPackaged: true, nodeEnv: 'development' },
    { isPackaged: false, nodeEnv: 'production' },
    { isPackaged: false, nodeEnv: undefined },
  ])('keeps the baked release icon for production mode ($isPackaged, $nodeEnv)', (options) => {
    expect(
      resolveAppIconPath({
        ...options,
        platform: 'darwin',
        iconsDirectory,
        fileExists,
      }),
    ).toBeUndefined();
  });

  it('does not return a missing development asset', () => {
    expect(
      resolveAppIconPath({
        isPackaged: false,
        nodeEnv: 'development',
        platform: 'linux',
        iconsDirectory,
        fileExists: () => false,
      }),
    ).toBeUndefined();
  });
});

describe('resolveAppDockIconPath', () => {
  it('uses the PNG for the unpackaged macOS development Dock', () => {
    expect(
      resolveAppDockIconPath({
        isPackaged: false,
        nodeEnv: 'development',
        platform: 'darwin',
        iconsDirectory,
        fileExists,
      }),
    ).toBe(path.join(iconsDirectory, 'dev-icon.png'));
  });

  it.each([
    { isPackaged: true, nodeEnv: 'development', platform: 'darwin' },
    { isPackaged: false, nodeEnv: 'production', platform: 'darwin' },
    { isPackaged: false, nodeEnv: 'development', platform: 'linux' },
  ] as const)('does not override the Dock icon outside macOS development', (options) => {
    expect(resolveAppDockIconPath({ ...options, iconsDirectory, fileExists })).toBeUndefined();
  });
});
