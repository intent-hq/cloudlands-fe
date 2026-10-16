// @vitest-environment node
import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';
import { configureMacUpdateCompatibility, macUpdateChannel } from './mac-update-compatibility';
const updaterRequire = createRequire(createRequire(import.meta.url).resolve('electron-updater'));
const { MacUpdater } = updaterRequire('./MacUpdater');
const { GenericProvider } = updaterRequire('./providers/GenericProvider');
const { SemVer } = updaterRequire('semver');

function updater(info: unknown, arch: 'x64' | 'arm64', currentVersion = '2.0.0') {
  const value = Object.create(MacUpdater.prototype);
  Object.assign(value, {
    currentVersion: new SemVer(currentVersion),
    allowDowngrade: false,
    autoDownload: true,
    _logger: { info: vi.fn() },
    isUpdateSupported: () => true,
    isUserWithinRollout: () => true,
    getUpdateInfoAndProvider: async () => ({ info, provider: {} }),
    downloadUpdate: vi.fn(),
  });
  configureMacUpdateCompatibility(value, 'darwin', arch);
  return value;
}
const armRelease = {
  version: '3.0.0',
  files: [{ url: 'Intent-3.0.0-arm64-mac.zip', sha512: 'hash', size: 10 }],
};

describe('Mac updater architecture safety', () => {
  it('rejects ARM-only updates before offering or downloading them on Intel', async () => {
    const value = updater(armRelease, 'x64');
    const available = vi.fn(),
      error = vi.fn();
    value.on('update-available', available);
    value.on('error', error);
    expect((await value.doCheckForUpdates()).isUpdateAvailable).toBe(false);
    expect(available).not.toHaveBeenCalled();
    expect(value.downloadUpdate).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });
  it('offers a native ARM release and preserves the existing OS support check', async () => {
    const value = updater(armRelease, 'arm64');
    expect((await value.doCheckForUpdates()).isUpdateAvailable).toBe(true);
    expect(value.downloadUpdate).toHaveBeenCalledOnce();
    value.isUpdateSupported = () => false;
    configureMacUpdateCompatibility(value, 'darwin', 'arm64');
    expect((await value.doCheckForUpdates()).isUpdateAvailable).toBe(false);
  });
  it('allows native ARM updates for a translated process on Apple Silicon', async () => {
    const value = updater(armRelease, 'arm64');
    value.isUpdateSupported = () => true;
    configureMacUpdateCompatibility(value, 'darwin', 'x64', true);
    expect((await value.doCheckForUpdates()).isUpdateAvailable).toBe(true);
    expect(value.downloadUpdate).toHaveBeenCalledOnce();
  });
  it.each(['alpha', 'beta', 'stable'])(
    'uses native ARM and legacy Intel feed URLs on %s',
    async (channel) => {
      for (const arch of ['x64', 'arm64'] as const) {
        const value = updater({ version: '0.0.0', files: [] }, arch);
        const provider = new GenericProvider(
          {
            provider: 'generic',
            url: `https://github.com/intent-hq/cloudlands-releases/releases/download/${channel}`,
            ...macUpdateChannel('darwin', arch),
          },
          value,
          { platform: 'darwin', executor: {} },
        );
        const urls: string[] = [];
        provider.httpRequest = async (url: URL) => {
          urls.push(url.href);
          return 'version: 0.0.0\nfiles: []\n';
        };
        value.getUpdateInfoAndProvider = async () => ({
          info: await provider.getLatestVersion(),
          provider,
        });
        const available = vi.fn(),
          error = vi.fn();
        value.on('update-available', available);
        value.on('error', error);
        expect((await value.doCheckForUpdates()).isUpdateAvailable).toBe(false);
        expect(urls[0].split('?')[0]).toBe(
          `https://github.com/intent-hq/cloudlands-releases/releases/download/${channel}/${arch === 'arm64' ? 'latest-arm64-mac.yml' : 'latest-mac.yml'}`,
        );
        expect(value.allowDowngrade).toBe(false);
        expect(available).not.toHaveBeenCalled();
        expect(error).not.toHaveBeenCalled();
        expect(value.downloadUpdate).not.toHaveBeenCalled();
      }
    },
  );
  it('leaves non-Mac updater configuration unchanged', () => {
    expect(macUpdateChannel('linux', 'arm64')).toEqual({});
    const supported = vi.fn(() => true);
    const value = { isUpdateSupported: supported };
    configureMacUpdateCompatibility(value, 'win32', 'x64');
    expect(value.isUpdateSupported).toBe(supported);
  });
});
