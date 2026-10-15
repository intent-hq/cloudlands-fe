import { execFileSync } from 'node:child_process';
import { readFile, rename, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { validateMacFeedStructure, validateMacUpdateFeed } from './mac-update-feed.mjs';

const updaterRequire = createRequire(createRequire(import.meta.url).resolve('electron-updater'));
const { load, dump, JSON_SCHEMA } = updaterRequire('js-yaml');
const REPO = 'intent-hq/cloudlands-releases';
const RELEASES = `https://github.com/${REPO}/releases/download/`;
const emptyLegacy = () => ({ version: '0.0.0', files: [] });
const parse = (text) => load(text, { schema: JSON_SCHEMA });
const serialize = (info) => dump(info, { sortKeys: true, lineWidth: -1, noRefs: true });
const hasIntel = (info) =>
  Array.isArray(info?.files) &&
  info.files.some(
    (file) => typeof file.url === 'string' && /(?:^|[-_.])x64(?:[-_.]|$)/.test(file.url),
  );

function localLegacy(info) {
  if (
    info?.version === '0.0.0' &&
    Array.isArray(info.files) &&
    info.files.length === 0 &&
    Object.keys(info).length === 2
  )
    return null;
  const prefix = `${RELEASES}v${info?.version}/`;
  const name = (url) => {
    if (typeof url !== 'string') throw new Error('Invalid legacy asset URL');
    if (url.startsWith(prefix)) return url.slice(prefix.length);
    if (url.includes('/') || url.includes(':'))
      throw new Error('Legacy asset URL is not its immutable release');
    return url;
  };
  const local = { ...info, files: info?.files?.map((file) => ({ ...file, url: name(file.url) })) };
  if (local.path !== undefined) local.path = name(local.path);
  validateMacFeedStructure(local, hasIntel(local) ? ['x64', 'arm64'] : ['arm64']);
  return local;
}

/** Read only the requested channel/tag. Confirmed 404 is distinct from auth/network failure. */
function loadGitHubRelease(tag) {
  let release;
  try {
    release = JSON.parse(
      execFileSync('gh', ['api', `repos/${REPO}/releases/tags/${tag}`], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      }),
    );
  } catch (error) {
    if (/\(HTTP 404\)/.test(String(error.stderr))) return null;
    throw error;
  }
  if (!release.assets?.some((asset) => asset.name === 'latest-mac.yml')) {
    if (release.assets?.length === 0) return null;
    throw new Error(`Release ${tag} has assets but no legacy Mac feed`);
  }
  const feed = execFileSync(
    'gh',
    ['release', 'download', tag, '--repo', REPO, '--pattern', 'latest-mac.yml', '--output', '-'],
    { encoding: 'utf8' },
  );
  return { feed, assets: release.assets };
}

/** Build the native ARM feed and preserve this destination channel's compatible legacy feed. */
export async function prepareMacChannelFeeds(directory, channel, loadRelease = loadGitHubRelease) {
  if (!['alpha', 'beta', 'stable'].includes(channel)) throw new Error('Invalid release channel');
  const legacyPath = join(directory, 'latest-mac.yml');
  const armPath = join(directory, 'latest-arm64-mac.yml');
  let arm;
  let current;
  try {
    await readFile(armPath);
    arm = await validateMacUpdateFeed(armPath);
    current = parse(await readFile(legacyPath, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    current = await validateMacUpdateFeed(legacyPath);
    const files = current.files.filter((file) => file.url.includes('arm64'));
    // Regenerate legacy fields from the ARM ZIP, never inherit Intel hashes/size.
    const { path: _path, sha512: _sha512, sha2: _sha2, size: _size, ...metadata } = current;
    const zip = files.find((file) => file.url.endsWith('.zip'));
    arm = { ...metadata, files, path: zip.url, sha512: zip.sha512 };
  }
  validateMacFeedStructure(arm, ['arm64']);
  let legacy = current;
  if (hasIntel(current) && current.version === arm.version) {
    await validateMacUpdateFeed(legacyPath);
  } else {
    const previous = await loadRelease(channel);
    const local = previous ? localLegacy(parse(previous.feed)) : null;
    legacy = emptyLegacy();
    if (local && hasIntel(local)) {
      const immutable = await loadRelease(`v${local.version}`);
      if (!immutable) throw new Error('Compatible legacy release no longer exists');
      const verified = localLegacy(parse(immutable.feed));
      if (!verified || verified.version !== local.version || !hasIntel(verified))
        throw new Error('Immutable legacy release is not a complete compatible Mac release');
      for (const file of verified.files) {
        const prior = local.files.find((entry) => entry.url === file.url);
        const asset = immutable.assets.find((entry) => entry.name === file.url);
        if (
          !prior ||
          prior.sha512 !== file.sha512 ||
          prior.size !== file.size ||
          !asset ||
          asset.size !== file.size
        )
          throw new Error(`Legacy archive metadata mismatch: ${file.url}`);
      }
      legacy = {
        ...verified,
        sha512: verified.files.find((file) => file.url.endsWith('.zip') && file.url.includes('x64'))
          .sha512,
        files: verified.files.map((file) => ({
          ...file,
          url: `${RELEASES}v${verified.version}/${file.url}`,
        })),
        path: `${RELEASES}v${verified.version}/${verified.files.find((file) => file.url.endsWith('.zip') && file.url.includes('x64')).url}`,
      };
    }
  }
  // Resolve and validate everything before replacing either prepared feed.
  for (const [path, info] of [
    [armPath, arm],
    [legacyPath, legacy],
  ]) {
    await writeFile(`${path}.tmp`, serialize(info));
    await rename(`${path}.tmp`, path);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [directory, channel, ...extra] = process.argv.slice(2);
  if (!directory || !channel || extra.length) {
    console.error(
      'Usage: node scripts/mac-channel-feeds.mjs <asset-directory> <alpha|beta|stable>',
    );
    process.exitCode = 1;
  } else {
    prepareMacChannelFeeds(directory, channel).catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
  }
}
