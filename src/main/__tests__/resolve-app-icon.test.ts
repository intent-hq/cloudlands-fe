import path from 'path';
import { describe, expect, it } from 'vitest';
import { resolveAppDockIconPath, resolveAppIconPath } from '../utils/resolve-app-icon';

const iconsDirectory = path.join('test', 'icons');
const resourcesDirectory = path.join('test', 'resources');
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
  it('uses the shipped production PNG for the packaged macOS Dock', () => {
    expect(
      resolveAppDockIconPath({
        isPackaged: true,
        nodeEnv: 'production',
        platform: 'darwin',
        resourcesDirectory,
        fileExists,
      }),
    ).toBe(path.join(resourcesDirectory, 'app-icon.png'));
  });

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
    { isPackaged: false, nodeEnv: 'production', platform: 'darwin' },
    { isPackaged: false, nodeEnv: undefined, platform: 'darwin' },
    { isPackaged: true, nodeEnv: 'production', platform: 'linux' },
    { isPackaged: false, nodeEnv: 'development', platform: 'win32' },
  ] as const)('does not override the Dock icon for other builds or platforms', (options) => {
    expect(
      resolveAppDockIconPath({
        ...options,
        iconsDirectory,
        resourcesDirectory,
        fileExists,
      }),
    ).toBeUndefined();
  });

  it.each([
    { isPackaged: true, nodeEnv: 'production' },
    { isPackaged: false, nodeEnv: 'development' },
  ] as const)('does not return a missing macOS Dock asset', (options) => {
    expect(
      resolveAppDockIconPath({
        ...options,
        platform: 'darwin',
        iconsDirectory,
        resourcesDirectory,
        fileExists: () => false,
      }),
    ).toBeUndefined();
  });
});
