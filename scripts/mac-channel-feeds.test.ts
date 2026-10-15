// @vitest-environment node
// @verify-changed-triggers: scripts/mac-channel-feeds.mjs, .github/workflows/release-alpha.yml, .github/workflows/promote-beta.yml, .github/workflows/release-stable.yml
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { prepareMacChannelFeeds } from './mac-channel-feeds.mjs';
const updaterRequire = createRequire(createRequire(import.meta.url).resolve('electron-updater'));
const { dump, load } = updaterRequire('js-yaml');
const { MacUpdater } = updaterRequire('./MacUpdater');
const { resolveFiles, findFile } = updaterRequire('./providers/Provider');
const { SemVer } = updaterRequire('semver');
const dirs: string[] = [];
function feed(version: string, arches = ['x64', 'arm64']) {
  const files = arches.map((arch) => {
    const url = `Intent-${version}-${arch}-mac.zip`;
    const data = Buffer.from(`archive ${url}`);
    return { url, size: data.length, sha512: createHash('sha512').update(data).digest('base64') };
  });
  return { version, files, path: files[0].url, sha512: files[0].sha512 };
}
function incoming(arches = ['arm64']) {
  const dir = mkdtempSync(join(tmpdir(), 'mac-channels-'));
  dirs.push(dir);
  const info = feed('3.0.0', arches);
  for (const file of info.files) writeFileSync(join(dir, file.url), `archive ${file.url}`);
  writeFileSync(join(dir, 'latest-mac.yml'), dump(info));
  return dir;
}
function source(info: ReturnType<typeof feed>) {
  return {
    feed: dump(info),
    assets: info.files.map((file) => ({ name: file.url, size: file.size })),
  };
}
function read(dir: string, name = 'latest-mac.yml') {
  return load(readFileSync(join(dir, name), 'utf8'));
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('architecture-safe channel feeds', () => {
  it.each(['alpha', 'beta', 'stable'])(
    'retains only %s’s own compatible legacy release with immutable URLs',
    async (channel) => {
      const dir = incoming();
      const arm = read(dir);
      writeFileSync(join(dir, 'latest-arm64-mac.yml'), dump(arm));
      writeFileSync(join(dir, 'latest-mac.yml'), dump(feed('2.9.0')));
      const old = feed('2.0.0');
      const loadRelease = vi.fn(async (tag: string) => {
        if (tag === channel || tag === 'v2.0.0') return source(old);
        throw new Error(`Unexpected release ${tag}`);
      });
      await prepareMacChannelFeeds(dir, channel, loadRelease);
      const legacy = read(dir);
      expect(legacy.version).toBe('2.0.0');
      expect(legacy.files.map((file: { url: string }) => file.url)).toEqual(
        old.files.map(
          (file) =>
            `https://github.com/intent-hq/cloudlands-releases/releases/download/v2.0.0/${file.url}`,
        ),
      );
      expect(legacy.files.map((file: { sha512: string }) => file.sha512)).toEqual(
        old.files.map((file) => file.sha512),
      );
      expect(legacy.path).toBe(legacy.files[0].url);
      const intel = findFile(
        MacUpdater.filterFilesForArch(
          resolveFiles(
            legacy,
            new URL(
              `https://github.com/intent-hq/cloudlands-releases/releases/download/${channel}/`,
            ),
          ),
          false,
        ),
        'zip',
        ['pkg', 'dmg'],
      );
      expect(intel.url.href).toBe(
        `https://github.com/intent-hq/cloudlands-releases/releases/download/v2.0.0/Intent-2.0.0-x64-mac.zip`,
      );
      expect(read(dir, 'latest-arm64-mac.yml').version).toBe('3.0.0');
      expect(loadRelease.mock.calls.map((call) => call[0])).toEqual([channel, 'v2.0.0']);
    },
  );
  it('refreshes both feeds after a successful complete Mac release without consulting old releases', async () => {
    const dir = incoming(['x64', 'arm64']);
    const loadRelease = vi.fn();
    await prepareMacChannelFeeds(dir, 'alpha', loadRelease);
    expect(read(dir).files).toHaveLength(2);
    expect(read(dir, 'latest-arm64-mac.yml').files).toHaveLength(1);
    expect(loadRelease).not.toHaveBeenCalled();
  });
  it.each(['alpha', 'beta', 'stable'])(
    'does not offer or download the no-history sentinel on %s',
    async (channel) => {
      const dir = incoming();
      await prepareMacChannelFeeds(dir, channel, async () => null);
      const info = read(dir);
      expect(info).toEqual({ version: '0.0.0', files: [] });
      // Exercise the installed updater's real check state machine, not a model of it.
      const updater = Object.create(MacUpdater.prototype);
      Object.assign(updater, {
        currentVersion: new SemVer('2.0.0'),
        allowDowngrade: false,
        autoDownload: true,
        _logger: { info: vi.fn() },
        isUpdateSupported: () => true,
        isUserWithinRollout: () => true,
        getUpdateInfoAndProvider: async () => ({ info, provider: {} }),
        downloadUpdate: vi.fn(),
      });
      const offered = vi.fn(),
        error = vi.fn(),
        unavailable = vi.fn();
      updater.on('update-available', offered);
      updater.on('error', error);
      updater.on('update-not-available', unavailable);
      const result = await updater.doCheckForUpdates();
      expect(result.isUpdateAvailable).toBe(false);
      expect(unavailable).toHaveBeenCalledOnce();
      expect(offered).not.toHaveBeenCalled();
      expect(error).not.toHaveBeenCalled();
      expect(updater.downloadUpdate).not.toHaveBeenCalled();
    },
  );
  it.each(['lookup failure', 'malformed feed', 'missing old asset', 'wrong size'])(
    'fails safely on %s without replacing the legacy feed',
    async (failure) => {
      const dir = incoming();
      const before = readFileSync(join(dir, 'latest-mac.yml'), 'utf8');
      const old = source(feed('2.0.0'));
      if (failure === 'malformed feed') old.feed = 'files: bad';
      if (failure === 'missing old asset') old.assets.pop();
      if (failure === 'wrong size') old.assets[0].size++;
      await expect(
        prepareMacChannelFeeds(dir, 'beta', async () => {
          if (failure === 'lookup failure') throw new Error('HTTP 503');
          return old;
        }),
      ).rejects.toThrow();
      expect(readFileSync(join(dir, 'latest-mac.yml'), 'utf8')).toBe(before);
    },
  );
});

it.each(['404', '401', '403', '500'])(
  'treats only confirmed HTTP 404 as no previous release (HTTP %s)',
  (status) => {
    const dir = incoming();
    const before = readFileSync(join(dir, 'latest-mac.yml'), 'utf8');
    mkdirSync(join(dir, 'bin'));
    writeFileSync(
      join(dir, 'bin/gh'),
      `#!/bin/sh\necho 'gh: failure (HTTP ${status})' >&2\nexit 1\n`,
      { mode: 0o755 },
    );
    const result = spawnSync(process.execPath, ['scripts/mac-channel-feeds.mjs', dir, 'alpha'], {
      encoding: 'utf8',
      env: { ...process.env, PATH: `${join(dir, 'bin')}:${process.env.PATH}` },
    });
    if (status === '404') {
      expect(result.status, result.stderr).toBe(0);
      expect(read(dir)).toEqual({ version: '0.0.0', files: [] });
    } else {
      expect(result.status).not.toBe(0);
      expect(readFileSync(join(dir, 'latest-mac.yml'), 'utf8')).toBe(before);
    }
  },
);
