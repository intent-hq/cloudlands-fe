import { constants } from 'node:fs';
import { copyFile, lstat, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { prepareMacUpdateFeed, validateMacUpdateFeed } from './mac-update-feed.mjs';
import { validateReleaseAssetNames } from './validate-release-asset-names.mjs';

/** Flatten validated Apple Silicon artifacts and the required non-Mac platforms. */
export async function assembleReleaseAssets(downloads, output, version) {
  const macJob = 'release-macos-arm64';
  const arm64 = join(downloads, macJob, 'latest-mac.yml');
  async function validateMacJob(info) {
    if (info.version !== version) throw new Error('Mac feed version does not match release');
    const files = info.files;
    if (!files.some((file) => file.url.endsWith('-arm64.dmg'))) {
      throw new Error('Missing arm64 DMG in release feed');
    }
    const directory = join(downloads, macJob);
    const expected = new Set(['latest-mac.yml']);
    for (const file of files) {
      expected.add(file.url);
      expected.add(`${file.url}.blockmap`);
      const blockmap = join(directory, `${file.url}.blockmap`);
      const stat = await lstat(blockmap);
      if (!stat.isFile() || stat.size === 0) {
        throw new Error(`Expected a non-empty regular blockmap: ${blockmap}`);
      }
    }
    for (const file of await readdir(directory, { withFileTypes: true })) {
      if (!file.isFile() || !expected.has(file.name)) {
        throw new Error(`Unexpected Mac release asset: ${file.name}`);
      }
    }
  }
  const info = await prepareMacUpdateFeed(arm64);
  await validateMacJob(info);
  // Refuse existing output instead of overwriting stale assets. Remove only the
  // directory this invocation created if any copy or final validation fails.
  await mkdir(output);
  try {
    const names = new Set(['latest-mac.yml', 'latest-arm64-mac.yml']);
    for (const job of await readdir(downloads, { withFileTypes: true })) {
      if (
        !job.isDirectory() ||
        ![macJob, 'release-windows', 'release-linux-x64', 'release-linux-arm64'].includes(job.name)
      ) {
        throw new Error(`Unexpected release artifact: ${job.name}`);
      }
      for (const file of await readdir(join(downloads, job.name), { withFileTypes: true })) {
        if (!file.isFile()) throw new Error(`Non-file release asset: ${file.name}`);
        if (file.name === 'latest-mac.yml' && job.name === macJob) continue;
        if (job.name !== macJob && /(?:\.dmg|-mac\.zip)(?:\.blockmap)?$/i.test(file.name)) {
          throw new Error(`Mac asset outside the Apple Silicon job: ${file.name}`);
        }
        const key = file.name.toLowerCase();
        if (names.has(key)) throw new Error(`Duplicate release asset: ${file.name}`);
        names.add(key);
        await copyFile(
          join(downloads, job.name, file.name),
          join(output, file.name),
          constants.COPYFILE_EXCL,
        );
      }
    }
    // Use the updater's parser/serializer, just like the feed CLI.
    const updaterRequire = createRequire(
      createRequire(import.meta.url).resolve('electron-updater'),
    );
    const { dump } = updaterRequire('js-yaml');
    await writeFile(
      join(output, 'latest-mac.yml'),
      dump(info, { sortKeys: true, lineWidth: -1, noRefs: true }),
      { flag: 'wx' },
    );
    await writeFile(
      join(output, 'latest-arm64-mac.yml'),
      dump(info, { sortKeys: true, lineWidth: -1, noRefs: true }),
      { flag: 'wx' },
    );
    validateReleaseAssetNames(output);
    await validateMacUpdateFeed(join(output, 'latest-mac.yml'));
    for (const feed of ['latest.yml', 'latest-linux.yml', 'latest-linux-arm64.yml']) {
      if (!names.has(feed)) throw new Error(`Missing release feed: ${feed}`);
    }
  } catch (error) {
    await rm(output, { recursive: true, force: true });
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [downloads, output, version, ...extra] = process.argv.slice(2);
  if (!downloads || !output || !version || extra.length) {
    console.error(
      'Usage: node scripts/assemble-release-assets.mjs <downloads> <new-output> <version>',
    );
    process.exitCode = 1;
  } else {
    assembleReleaseAssets(downloads, output, version).catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
  }
}
