import { constants } from 'node:fs';
import { copyFile, lstat, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { mergeMacUpdateFeeds, validateMacUpdateFeed } from './mac-update-feed.mjs';
import { validateReleaseAssetNames } from './validate-release-asset-names.mjs';

/** Flatten Actions artifacts only after both native Mac feeds pass validation. */
export async function assembleReleaseAssets(downloads, output, version) {
  const macJobs = ['release-macos-x64', 'release-macos-arm64'];
  const info = await mergeMacUpdateFeeds({
    x64: join(downloads, macJobs[0], 'latest-mac.yml'),
    arm64: join(downloads, macJobs[1], 'latest-mac.yml'),
  });
  if (info.version !== version) throw new Error('Mac feed version does not match release');
  for (const arch of ['x64', 'arm64']) {
    if (!info.files.some((file) => file.url.endsWith(`-${arch}.dmg`))) {
      throw new Error(`Missing ${arch} DMG in release feed`);
    }
  }
  for (const file of info.files) {
    const arch = file.url.includes('arm64') ? 'arm64' : 'x64';
    const blockmap = join(downloads, `release-macos-${arch}`, `${file.url}.blockmap`);
    const stat = await lstat(blockmap);
    if (!stat.isFile() || stat.size === 0) {
      throw new Error(`Expected a non-empty regular blockmap: ${blockmap}`);
    }
  }
  // Refuse existing output instead of overwriting stale assets. Remove only the
  // directory this invocation created if any copy or final validation fails.
  await mkdir(output);
  try {
    const names = new Set(['latest-mac.yml']);
    for (const job of await readdir(downloads, { withFileTypes: true })) {
      if (!job.isDirectory() || !job.name.startsWith('release-')) {
        throw new Error(`Unexpected release artifact: ${job.name}`);
      }
      for (const file of await readdir(join(downloads, job.name), { withFileTypes: true })) {
        if (!file.isFile()) throw new Error(`Non-file release asset: ${file.name}`);
        if (file.name === 'latest-mac.yml' && macJobs.includes(job.name)) continue;
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
