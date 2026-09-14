import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// GitHub sanitizes uploaded filenames, but our generic electron-updater feeds
// retain the local names. Reject names that would change before publishing.
// https://docs.github.com/en/rest/releases/assets#upload-a-release-asset
export function validateReleaseAssetNames(directory) {
  const files = readdirSync(directory, { withFileTypes: true }).filter((entry) => entry.isFile());
  if (files.length === 0) throw new Error(`No release assets in ${directory}`);

  const unsafe = files
    .map((entry) => entry.name)
    .filter((name) => !/^[A-Za-z0-9_-][A-Za-z0-9._-]*$/.test(name) || name.endsWith('.'));
  if (unsafe.length > 0) {
    throw new Error(
      `Release filenames would be renamed by GitHub: ${unsafe.join(', ')}. ` +
        'Set a URL-safe artifactName in electron-builder.yml before generating updater feeds.',
    );
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (!process.argv[2])
      throw new Error('Usage: node scripts/validate-release-asset-names.mjs <dir>');
    validateReleaseAssetNames(process.argv[2]);
    console.log('Release asset filenames are safe for GitHub uploads.');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
