import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, mkdir, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { basename, dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual, parseArgs } from 'node:util';

// Use the updater's parser and version validator, including under pnpm isolation.
const updaterRequire = createRequire(createRequire(import.meta.url).resolve('electron-updater'));
const { load, dump, JSON_SCHEMA } = updaterRequire('js-yaml');
const { valid } = updaterRequire('semver');
const ARCHITECTURES = ['x64', 'arm64'];
const PER_BUILD_FIELDS = new Set(['files', 'path', 'sha512', 'sha2', 'releaseDate']);
const USAGE =
  'Usage: node scripts/mac-update-feed.mjs --arm64 <job-dir>/latest-mac.yml --x64 <job-dir>/latest-mac.yml --output <publish-dir>/latest-mac.yml\n' +
  '   or: node scripts/mac-update-feed.mjs --validate <publish-dir>/latest-mac.yml';

function record(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function architecture(name) {
  if (typeof name !== 'string' || !/^[A-Za-z0-9_-][A-Za-z0-9._-]*\.(zip|dmg)$/.test(name)) {
    throw new Error(`Unsafe or unsupported Mac asset name: ${String(name)}`);
  }
  const matches = ARCHITECTURES.filter((arch) =>
    new RegExp(`(?:^|[-_.])${arch}(?:[-_.]|$)`).test(name),
  );
  // MacUpdater 6.8.9 searches for the substring arm64, not a delimited token.
  if (matches.length !== 1 || (matches[0] === 'x64' && name.includes('arm64'))) {
    throw new Error(`Ambiguous or missing architecture in ${name}`);
  }
  return matches[0];
}

function validateStructure(info, expectedArchitectures) {
  if (!record(info)) throw new Error('Mac feed must be a YAML mapping');
  if (typeof info.version !== 'string' || valid(info.version) !== info.version) {
    throw new Error('Mac feed must contain a valid version');
  }
  if (!Array.isArray(info.files) || info.files.length === 0)
    throw new Error('Mac feed has no files');
  if (
    info.releaseDate !== undefined &&
    (typeof info.releaseDate !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}T/.test(info.releaseDate) ||
      !Number.isFinite(Date.parse(info.releaseDate)))
  ) {
    throw new Error('Invalid releaseDate');
  }
  const seen = new Set();
  const groups = Object.fromEntries(expectedArchitectures.map((arch) => [arch, []]));
  for (const file of info.files) {
    if (!record(file)) throw new Error('Invalid Mac files entry');
    const arch = architecture(file.url);
    if (!groups[arch])
      throw new Error(
        `Unexpected ${arch} architecture in feed for ${expectedArchitectures.join(', ')}`,
      );
    // Also forbid collisions on the case-insensitive filesystem used by Mac jobs.
    const name = file.url.toLowerCase();
    if (seen.has(name)) throw new Error(`Duplicate Mac asset name: ${file.url}`);
    seen.add(name);
    if (!Number.isSafeInteger(file.size) || file.size <= 0)
      throw new Error(`Invalid size for ${file.url}`);
    if (
      typeof file.sha512 !== 'string' ||
      !/^[A-Za-z0-9+/]{86}==$/.test(file.sha512) ||
      Buffer.from(file.sha512, 'base64').toString('base64') !== file.sha512
    ) {
      throw new Error(`Invalid sha512 for ${file.url}`);
    }
    groups[arch].push(file);
  }
  for (const arch of expectedArchitectures) {
    if (groups[arch].filter((file) => file.url.endsWith('.zip')).length !== 1) {
      throw new Error(`Expected exactly one ${arch} ZIP`);
    }
    if (groups[arch].filter((file) => file.url.endsWith('.dmg')).length > 1) {
      throw new Error(`Ambiguous ${arch} DMG entries`);
    }
  }
  if (['path', 'sha512', 'sha2'].some((key) => info[key] !== undefined)) {
    const legacy = info.files.find((file) => file.url === info.path && file.url.endsWith('.zip'));
    if (!legacy || info.sha512 !== legacy.sha512)
      throw new Error('Inconsistent legacy path/sha512');
  }
  return info;
}

async function verifyAssets(info, directory) {
  // Streaming keeps release-size archives out of memory, even on publishing runners.
  for (const file of info.files) {
    const path = join(directory, file.url);
    const stat = await lstat(path);
    if (!stat.isFile()) throw new Error(`Mac asset must be a regular file: ${file.url}`);
    if (stat.size !== file.size) throw new Error(`Incorrect size for ${file.url}`);
    const sha512 = createHash('sha512');
    const legacySha2 = info.path === file.url ? info.sha2 : undefined;
    const expectedSha2 = [file.sha2, legacySha2].filter((hash) => hash !== undefined);
    const sha256 = expectedSha2.length > 0 ? createHash('sha256') : null;
    for await (const chunk of createReadStream(path)) {
      sha512.update(chunk);
      sha256?.update(chunk);
    }
    if (sha512.digest('base64') !== file.sha512)
      throw new Error(`Incorrect sha512 for ${file.url}`);
    if (sha256) {
      const actualSha2 = sha256.digest('hex');
      if (expectedSha2.some((hash) => hash !== actualSha2))
        throw new Error(`Incorrect sha2 for ${file.url}`);
    }
  }
}

async function readFeed(path, expectedArchitectures) {
  // JSON_SCHEMA keeps timestamps as strings; load rejects duplicate keys/documents.
  const info = validateStructure(
    load(await readFile(path, 'utf8'), { schema: JSON_SCHEMA }),
    expectedArchitectures,
  );
  await verifyAssets(info, dirname(path));
  return info;
}

/** Validate the combined feed against archives in its final upload directory. */
export async function validateMacUpdateFeed(path) {
  const info = await readFeed(path, ARCHITECTURES);
  if (info.path !== undefined && architecture(info.path) !== 'x64') {
    throw new Error('Combined feed legacy path must use the x64 ZIP');
  }
  return info;
}

/** Merge separate native-job feeds; assets stay beside each input until upload assembly. */
export async function mergeMacUpdateFeeds({ arm64, x64 }) {
  if (!arm64 || !x64) throw new Error('Both arm64 and x64 feed paths are required');
  if ((await realpath(arm64)) === (await realpath(x64)))
    throw new Error('Architecture feeds must be distinct inputs');
  const intel = await readFeed(x64, ['x64']);
  const arm = await readFeed(arm64, ['arm64']);
  const keys = new Set([...Object.keys(intel), ...Object.keys(arm)]);
  for (const key of keys) {
    if (!PER_BUILD_FIELDS.has(key) && !isDeepStrictEqual(intel[key], arm[key])) {
      throw new Error(`Conflicting Mac feed metadata: ${key}`);
    }
  }
  const files = ARCHITECTURES.flatMap((arch) =>
    [...(arch === 'x64' ? intel : arm).files].sort((a, b) => {
      // ZIP first matches electron-builder's legacy default. Ordering is independent
      // of artifact download order and locale.
      const zipOrder = Number(b.url.endsWith('.zip')) - Number(a.url.endsWith('.zip'));
      return zipOrder || (a.url < b.url ? -1 : a.url > b.url ? 1 : 0);
    }),
  );
  const legacy = files[0];
  const merged = { ...intel, files, path: legacy.url, sha512: legacy.sha512 };
  const dates = [intel.releaseDate, arm.releaseDate].filter((date) => date !== undefined);
  if (dates.length > 0)
    merged.releaseDate = new Date(Math.max(...dates.map((date) => Date.parse(date)))).toISOString();
  validateStructure(merged, ARCHITECTURES);
  return merged;
}

async function main(args) {
  let values;
  try {
    const parsed = parseArgs({
      args,
      options: {
        arm64: { type: 'string' },
        x64: { type: 'string' },
        output: { type: 'string' },
        validate: { type: 'string' },
      },
      tokens: true,
    });
    values = parsed.values;
    const names = parsed.tokens.map((token) => token.name);
    if (new Set(names).size !== names.length || Object.values(values).some((value) => !value))
      throw new Error(USAGE);
    if (values.validate ? names.length !== 1 : !values.arm64 || !values.x64 || !values.output)
      throw new Error(USAGE);
  } catch {
    throw new Error(USAGE);
  }
  if (values.validate) {
    await validateMacUpdateFeed(values.validate);
    console.log('Mac feed and both architecture archives validated.');
    return;
  }
  const output = resolve(values.output);
  const info = await mergeMacUpdateFeeds(values);
  await mkdir(dirname(output), { recursive: true });
  const outputPath = join(await realpath(dirname(output)), basename(output));
  if (
    [await realpath(values.arm64), await realpath(values.x64)].includes(outputPath) ||
    info.files.some((file) => file.url === basename(output))
  ) {
    throw new Error('Output must not overwrite a source feed or archive');
  }
  const temporary = `${output}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, dump(info, { sortKeys: true, lineWidth: -1, noRefs: true }), {
      flag: 'wx',
    });
    await rename(temporary, output);
  } finally {
    await rm(temporary, { force: true });
  }
  console.log(`Combined Mac feed written to ${output}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
