// @vitest-environment node
// @verify-changed-triggers: scripts/mac-channel-feeds.mjs, scripts/mac-update-feed.mjs, scripts/assemble-release-assets.mjs, scripts/package-mac.mjs, scripts/macos-native.cjs, electron-builder.yml, .github/workflows/release-alpha.yml, .github/workflows/promote-beta.yml, .github/workflows/release-stable.yml, src/features/auto-update/main/mac-update-compatibility.ts, src/features/auto-update/main/auto-update.service.ts
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { prepareMacChannelFeeds } from './mac-channel-feeds.mjs';
import { configureMacUpdateCompatibility } from '../src/features/auto-update/main/mac-update-compatibility';

const updaterRequire = createRequire(
  process.env.MAC_UPDATER_PACKAGE_ROOT
    ? resolve(process.env.MAC_UPDATER_PACKAGE_ROOT, 'package.json')
    : createRequire(import.meta.url).resolve('electron-updater/package.json'),
);
const { dump, load } = updaterRequire('js-yaml');
const childProcess = updaterRequire('child_process');
const { MacUpdater } = updaterRequire('./out/MacUpdater.js');
const { GenericProvider } = updaterRequire('./out/providers/GenericProvider.js');
const { SemVer } = updaterRequire('semver');
const dirs: string[] = [];
const originalArch = Object.getOwnPropertyDescriptor(process, 'arch')!;

function feed(version: string, arches = ['arm64']) {
  const files = arches.flatMap((arch) =>
    ['zip', 'dmg'].map((ext) => {
      const url = `Intent-${version}-${arch}${ext === 'zip' ? '-mac' : ''}.${ext}`;
      const data = Buffer.from(`archive ${url}`);
      return { url, size: data.length, sha512: createHash('sha512').update(data).digest('base64') };
    }),
  );
  return {
    version,
    files,
    path: files[0].url,
    sha512: files[0].sha512,
    releaseNotes: 'Selected release',
    minimumSystemVersion: '13.0.0',
  };
}
function incoming(arches = ['arm64'], version = '2.220.0') {
  const dir = mkdtempSync(join(tmpdir(), 'mac-channels-'));
  dirs.push(dir);
  const info = feed(version, arches);
  for (const file of info.files) {
    writeFileSync(join(dir, file.url), `archive ${file.url}`);
    writeFileSync(join(dir, file.url + '.blockmap'), 'blockmap');
  }
  writeFileSync(join(dir, 'latest-mac.yml'), dump(info));
  return dir;
}
function read(dir: string, name = 'latest-mac.yml') {
  return load(readFileSync(join(dir, name), 'utf8'));
}

function client(
  dir: string,
  channel: string,
  generation: 'production' | 'current' | 'split-alpha',
  hardware: 'arm64' | 'intel',
) {
  const arch = hardware === 'arm64' ? 'arm64' : 'x64';
  Object.defineProperty(process, 'arch', { value: arch, configurable: true });
  vi.spyOn(childProcess, 'execFileSync').mockImplementation(((command: string) =>
    command === 'sysctl'
      ? 'sysctl.proc_translated: 0'
      : hardware === 'arm64'
        ? 'Darwin ARM64'
        : 'Darwin x86_64') as any);
  const value = Object.create(MacUpdater.prototype);
  const transfer = vi.fn(async ({ fileInfo }) => [fileInfo.url.href]);
  Object.assign(value, {
    currentVersion: new SemVer(generation === 'production' ? '2.212.1' : '2.219.7'),
    allowDowngrade: false,
    autoDownload: true,
    _logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
    isUpdateSupported: () => true,
    isUserWithinRollout: () => true,
    executeDownload: transfer,
  });
  if (generation !== 'production') configureMacUpdateCompatibility(value, 'darwin', arch);
  const requests: string[] = [];
  // Production 2.212.1 used the default; only alpha 2.219.x used the split filename.
  const installedChannel =
    generation === 'split-alpha' && arch === 'arm64' ? { channel: 'latest-arm64' } : {};
  const provider = new GenericProvider(
    {
      provider: 'generic',
      url: `https://updates.example/${channel}/`,
      ...installedChannel,
    },
    value,
    { platform: 'darwin', executor: {} },
  );
  provider.httpRequest = async (url: URL) => {
    requests.push(url.pathname);
    return readFileSync(join(dir, basename(url.pathname)), 'utf8');
  };
  value.getUpdateInfoAndProvider = async () => ({
    info: await provider.getLatestVersion(),
    provider,
  });
  const offered = vi.fn(),
    errors = vi.fn();
  value.on('update-available', offered);
  value.on('error', errors);
  return { value, requests, transfer, offered, errors };
}
afterEach(() => {
  vi.restoreAllMocks();
  Object.defineProperty(process, 'arch', originalArch);
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('Mac channel migration', () => {
  it.each(['alpha', 'beta', 'stable'])(
    'publishes the selected %s release using only the standard Mac feed',
    async (channel) => {
      const dir = incoming(['x64', 'arm64']);
      await prepareMacChannelFeeds(dir, channel);
      expect(read(dir)).toMatchObject({
        version: '2.220.0',
        path: 'Intent-2.220.0-arm64-mac.zip',
        releaseNotes: 'Selected release',
        minimumSystemVersion: '13.0.0',
      });
      expect(existsSync(join(dir, 'latest-arm64-mac.yml'))).toBe(false);
      await prepareMacChannelFeeds(dir, channel);
      expect(read(dir).version).toBe('2.220.0');
    },
  );

  it('promotes an older selected dual release without Intel assets or cross-channel lookup', async () => {
    const dir = incoming(['x64', 'arm64'], '2.216.5');
    writeFileSync(join(dir, 'Intent-2.216.5-x64.exe'), 'Windows installer');
    await prepareMacChannelFeeds(dir, 'stable');
    expect(read(dir).version).toBe('2.216.5');
    expect(read(dir).files.map((file: any) => file.url)).toEqual([
      'Intent-2.216.5-arm64-mac.zip',
      'Intent-2.216.5-arm64.dmg',
    ]);
    expect(read(dir).path).toBe('Intent-2.216.5-arm64-mac.zip');
    expect(existsSync(join(dir, 'Intent-2.216.5-x64-mac.zip'))).toBe(false);
    expect(existsSync(join(dir, 'Intent-2.216.5-x64.dmg.blockmap'))).toBe(false);
    expect(existsSync(join(dir, 'Intent-2.216.5-x64.exe'))).toBe(true);
  });

  it.each([
    'malformed feed',
    'retired alpha feed',
    'missing archive',
    'corrupt archive',
    'invalid channel',
    'wrong selected version',
  ])('leaves published inputs intact on %s', async (failure) => {
    const dir = incoming();
    const zip = join(dir, read(dir).path);
    if (failure === 'malformed feed') writeFileSync(join(dir, 'latest-mac.yml'), 'files: bad');
    const shared = readFileSync(join(dir, 'latest-mac.yml'), 'utf8');
    if (failure === 'retired alpha feed') {
      writeFileSync(join(dir, 'latest-arm64-mac.yml'), shared);
    }
    if (failure === 'missing archive') rmSync(zip);
    if (failure === 'corrupt archive') writeFileSync(zip, 'bad');
    await expect(
      prepareMacChannelFeeds(
        dir,
        failure === 'invalid channel' ? 'other' : 'beta',
        failure === 'wrong selected version' ? '2.219.7' : '2.220.0',
      ),
    ).rejects.toThrow();
    expect(readFileSync(join(dir, 'latest-mac.yml'), 'utf8')).toBe(shared);
    if (failure === 'retired alpha feed') {
      expect(readFileSync(join(dir, 'latest-arm64-mac.yml'), 'utf8')).toBe(shared);
    }
  });

  for (const channel of ['alpha', 'beta', 'stable']) {
    for (const generation of ['production', 'current'] as const) {
      it(`discovers and selects native ARM from ${generation} clients on ${channel}`, async () => {
        const dir = incoming();
        await prepareMacChannelFeeds(dir, channel, '2.220.0');
        const { value, requests, transfer, offered, errors } = client(
          dir,
          channel,
          generation,
          'arm64',
        );
        const result = await value.doCheckForUpdates();
        expect(result.isUpdateAvailable).toBe(true);
        expect(result.updateInfo.version).toBe('2.220.0');
        expect(requests).toEqual([`/${channel}/latest-mac.yml`]);
        expect(await result.downloadPromise).toEqual([
          `https://updates.example/${channel}/Intent-2.220.0-arm64-mac.zip`,
        ]);
        expect(transfer).toHaveBeenCalledOnce();
        expect(offered).toHaveBeenCalledOnce();
        expect(errors).not.toHaveBeenCalled();
        expect(value.allowDowngrade).toBe(false);
      });
    }
  }

  it('pre-change Intel reports an update error before downloading an incompatible archive', async () => {
    const dir = incoming();
    await prepareMacChannelFeeds(dir, 'alpha');
    const { value, transfer, offered, errors } = client(dir, 'alpha', 'production', 'intel');
    const result = await value.doCheckForUpdates();
    expect(result.isUpdateAvailable).toBe(true);
    await expect(result.downloadPromise).rejects.toMatchObject({
      code: 'ERR_UPDATER_NO_FILES_PROVIDED',
    });
    expect(offered).toHaveBeenCalledOnce();
    expect(errors).toHaveBeenCalledOnce();
    expect(transfer).not.toHaveBeenCalled();
  });

  it('guarded Intel refuses before announcing an update', async () => {
    const dir = incoming();
    await prepareMacChannelFeeds(dir, 'alpha');
    const { value, transfer, offered, errors } = client(dir, 'alpha', 'current', 'intel');
    expect((await value.doCheckForUpdates()).isUpdateAvailable).toBe(false);
    expect(transfer).not.toHaveBeenCalled();
    expect(offered).not.toHaveBeenCalled();
    expect(errors).not.toHaveBeenCalled();
  });

  it('requires reinstalling alpha clients that request the retired filename', async () => {
    const dir = incoming();
    await prepareMacChannelFeeds(dir, 'alpha');
    const { value, requests, transfer, offered } = client(dir, 'alpha', 'split-alpha', 'arm64');
    await expect(value.doCheckForUpdates()).rejects.toThrow();
    expect(requests).toEqual(['/alpha/latest-arm64-mac.yml']);
    expect(transfer).not.toHaveBeenCalled();
    expect(offered).not.toHaveBeenCalled();
  });

  it.each(['production', 'current'] as const)(
    'does not move a %s client backwards to an older promoted release',
    async (generation) => {
      const dir = incoming(['arm64'], '2.200.0');
      await prepareMacChannelFeeds(dir, 'stable');
      const { value, transfer } = client(dir, 'stable', generation, 'arm64');
      expect((await value.doCheckForUpdates()).isUpdateAvailable).toBe(false);
      expect(transfer).not.toHaveBeenCalled();
    },
  );
});
