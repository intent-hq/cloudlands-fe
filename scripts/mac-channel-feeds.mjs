import { readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { validateMacFeedStructure, validateMacUpdateFeed } from './mac-update-feed.mjs';

const updaterRequire = createRequire(createRequire(import.meta.url).resolve('electron-updater'));
const { load, dump, JSON_SCHEMA } = updaterRequire('js-yaml');

/** Both generations of ARM clients must discover the selected channel release. */
export async function prepareMacChannelFeeds(directory, channel, expectedVersion) {
  if (!['alpha', 'beta', 'stable'].includes(channel)) throw new Error('Invalid release channel');
  const sharedPath = join(directory, 'latest-mac.yml');
  const armPath = join(directory, 'latest-arm64-mac.yml');
  let sourcePath = armPath;
  let content;
  try {
    content = await readFile(armPath, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    sourcePath = sharedPath;
    content = await readFile(sharedPath, 'utf8');
  }
  const source = load(content, { schema: JSON_SCHEMA });
  validateMacFeedStructure(
    source,
    sourcePath === armPath
      ? ['arm64']
      : source?.files?.some((file) => file.url?.includes('x64'))
        ? ['x64', 'arm64']
        : ['arm64'],
  );
  if (expectedVersion !== undefined && source.version !== expectedVersion) {
    throw new Error('Mac feed must match the selected release version');
  }
  const files = source.files.filter((file) => file.url.includes('arm64'));
  const { path: _path, sha512: _sha512, sha2: _sha2, size: _size, ...metadata } = source;
  const zip = files.find((file) => file.url.endsWith('.zip'));
  const arm = { ...metadata, files, path: zip.url, sha512: zip.sha512 };
  validateMacFeedStructure(arm, ['arm64']);
  const serialized = dump(arm, { sortKeys: true, lineWidth: -1, noRefs: true });
  const temporary = `${armPath}.tmp`;
  try {
    await writeFile(temporary, serialized, { flag: 'wx' });
    await validateMacUpdateFeed(temporary);
    await rename(temporary, armPath);
    await writeFile(temporary, serialized, { flag: 'wx' });
    await rename(temporary, sharedPath);
  } finally {
    await rm(temporary, { force: true });
  }
  // Historical promotions can contain Intel installers; never republish them.
  for (const name of await readdir(directory)) {
    if (/-x64(?:-mac\.zip|\.dmg)(?:\.blockmap)?$/.test(name)) {
      await rm(join(directory, name));
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [directory, channel, version, ...extra] = process.argv.slice(2);
  if (!directory || !channel || !version || extra.length) {
    console.error(
      'Usage: node scripts/mac-channel-feeds.mjs <asset-directory> <alpha|beta|stable> <version>',
    );
    process.exitCode = 1;
  } else {
    prepareMacChannelFeeds(directory, channel, version).catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
  }
}
