#!/usr/bin/env node
/**
 * Compile the approved release artwork into the native macOS 26 icon resource.
 *
 * Packaging uses the pinned build/macos-icon-pin/Assets.car when it was compiled
 * from the current icon inputs, so release builds do not run actool. On some
 * WarpBuild runners actool hangs on every attempt (release-alpha runs 42699670226,
 * 42960353191, 43385563563, 43428213925, 43529394634); on the others it takes
 * 6-18 s. After changing the artwork, ICON_DOCUMENT or ACTOOL_OPTIONS, re-pin on a
 * Mac with Xcode 26: `node scripts/build-macos-icon.js --pin`.
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import sharp from 'sharp';
import { execBounded, retryTimeouts } from './bounded-exec.mjs';
import native from './macos-native.cjs';
import { formatProcessTree } from './process-tree.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ICON_NAME = 'Intent';
const SOURCE_PATH = path.join(__dirname, '../src/assets/icons/app-icon/Icon-1024.png');
const OUTPUT_DIRECTORY = path.join(__dirname, '../build/macos-icon');
export const PIN_DIRECTORY = path.join(__dirname, '../build/macos-icon-pin');
const REQUIRED_XCODE_MAJOR = 26;
// actool compiles this one icon in ~2 s, yet it has hung silently on WarpBuild macOS
// runners until the 30-min pre-notarization deadline killed the release (release-alpha
// runs 42434129706, 42410996247, 42246111547). Stop an attempt after 3 min and retry;
// three attempts keep the worst case (9 min, reached ~13 min into packaging) inside
// that 30-min deadline with room for signing to start.
export const ACTOOL_TIMEOUT_MS = 3 * 60_000;
export const ACTOOL_ATTEMPTS = 3;
// Processes actool depends on, logged when an attempt hangs.
const XCODE_HELPERS = /ibtoold|actool|AssetCatalog|CoreSimulator|simdisk|IBAgent|ictool/;

export const ACTOOL_OPTIONS = [
  '--app-icon',
  ICON_NAME,
  '--include-all-app-icons',
  '--enable-on-demand-resources',
  'NO',
  '--development-region',
  'en',
  '--target-device',
  'mac',
  '--minimum-deployment-target',
  '26.0',
  '--platform',
  'macosx',
];

export const ICON_DOCUMENT = {
  fill: { solid: 'extended-srgb:0.03137,0.03137,0.03137,1.00000' },
  groups: [
    {
      layers: [
        {
          glass: false,
          hidden: false,
          'image-name': 'Lime-Mark.png',
          name: 'Approved lime mark',
        },
      ],
      name: ICON_NAME,
      shadow: { kind: 'none', opacity: 0 },
      specular: false,
      translucency: { enabled: false, value: 0 },
    },
  ],
  'supported-platforms': { squares: ['macOS'] },
};

async function releaseMarkPixels(sourcePath) {
  const source = await sharp(sourcePath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const mark = Buffer.alloc(source.data.length);

  for (let offset = 0; offset < source.data.length; offset += 4) {
    const red = source.data[offset];
    const green = source.data[offset + 1];
    const blue = source.data[offset + 2];
    // The approved background and bevel are neutral; keep only the lime chroma.
    if (red - blue <= 2 || green - blue <= 2 || green <= 12) continue;

    mark[offset] = red;
    mark[offset + 1] = green;
    mark[offset + 2] = blue;
    mark[offset + 3] = 255;
  }

  return { data: mark, info: source.info };
}

export async function createReleaseMark(sourcePath = SOURCE_PATH) {
  const mark = await releaseMarkPixels(sourcePath);
  return sharp(mark.data, { raw: mark.info }).png().toBuffer();
}

/** Identifies everything actool is given, so a pin is reused only for the same icon. */
export async function iconInputsDigest(sourcePath = SOURCE_PATH) {
  const mark = await releaseMarkPixels(sourcePath);
  const { width, height, channels } = mark.info;
  return createHash('sha256')
    .update(JSON.stringify({ document: ICON_DOCUMENT, options: ACTOOL_OPTIONS }))
    .update(JSON.stringify({ width, height, channels }))
    .update(mark.data)
    .digest('hex');
}

const sha256 = (data) => createHash('sha256').update(data).digest('hex');

function verifyIconResource(resourcePath, origin) {
  const car = fs.existsSync(resourcePath) ? fs.readFileSync(resourcePath) : Buffer.alloc(0);
  if (
    car.subarray(0, 8).toString('latin1') !== 'BOMStore' ||
    !car.includes(`${ICON_NAME}.iconstack`)
  ) {
    throw new Error(
      `${origin} ${resourcePath} is not a compiled asset catalog containing the ${ICON_NAME} icon.`,
    );
  }
  return car;
}

/** @returns {Promise<string | null>} the copied resource, or null when actool must compile. */
async function usePinnedIcon({ pinDirectory, sourcePath, outputDirectory }) {
  const pinPath = path.join(pinDirectory, 'pin.json');
  if (!fs.existsSync(pinPath)) return null;
  const pin = JSON.parse(fs.readFileSync(pinPath, 'utf8'));
  if (pin.inputsSha256 !== (await iconInputsDigest(sourcePath))) {
    console.log(
      '::warning title=Pinned macOS icon is stale::The icon inputs changed since ' +
        `${pinDirectory} was pinned, so actool compiles the icon. Re-pin on a Mac: ` +
        'node scripts/build-macos-icon.js --pin',
    );
    return null;
  }
  const pinnedPath = path.join(pinDirectory, 'Assets.car');
  const car = verifyIconResource(pinnedPath, 'Pinned icon resource');
  if (sha256(car) !== pin.assetsSha256) {
    throw new Error(`The pinned ${pinnedPath} does not match the sha256 recorded in ${pinPath}.`);
  }
  fs.rmSync(outputDirectory, { recursive: true, force: true });
  fs.mkdirSync(outputDirectory, { recursive: true });
  const resourcePath = path.join(outputDirectory, 'Assets.car');
  fs.copyFileSync(pinnedPath, resourcePath);
  console.log(`Using pinned modern macOS icon resource (${pin.xcode}): ${resourcePath}`);
  return resourcePath;
}

function logHungActool(pid, processes) {
  const tree = formatProcessTree(pid, processes);
  const inTree = new Set(tree.map((line) => line.trim().split(' ')[0]));
  const helpers = processes
    .filter((proc) => XCODE_HELPERS.test(proc.command) && !inTree.has(String(proc.pid)))
    .map((proc) => `${proc.pid} (ppid ${proc.ppid}, ${proc.etime}, ${proc.stat}) ${proc.command}`);
  console.log(
    [
      'Hung xcrun actool process tree:',
      ...tree,
      'Other Xcode helper processes:',
      ...(helpers.length ? helpers : ['(none)']),
    ].join('\n'),
  );
}

export async function compileModernMacOSIcon({
  execute = execFileSync,
  runActool = execBounded,
  actoolTimeoutMs = ACTOOL_TIMEOUT_MS,
  actoolAttempts = ACTOOL_ATTEMPTS,
  outputDirectory = OUTPUT_DIRECTORY,
  pinDirectory = PIN_DIRECTORY,
  sourcePath = SOURCE_PATH,
  usePin = true,
} = {}) {
  try {
    execute('xcrun', ['--find', 'actool'], { stdio: 'pipe' });
  } catch {
    throw new Error(
      'Modern macOS icon packaging requires Xcode 26 or newer with actool. Install full Xcode and select it with xcode-select before packaging macOS.',
    );
  }

  let xcodeVersion;
  try {
    xcodeVersion = String(
      execute('xcrun', ['xcodebuild', '-version'], { encoding: 'utf8', stdio: 'pipe' }),
    );
  } catch {
    throw new Error(
      'Modern macOS icon packaging requires Xcode 26 or newer with actool. Could not read the selected Xcode version. Select full Xcode with xcode-select or DEVELOPER_DIR before packaging macOS.',
    );
  }

  const versionMatch = xcodeVersion.match(/^Xcode\s+(\d+)(?:\.\d+)*/m);
  if (!versionMatch) {
    throw new Error(
      'Modern macOS icon packaging requires Xcode 26 or newer with actool. Could not determine the selected Xcode version from xcodebuild -version.',
    );
  }
  if (Number(versionMatch[1]) < REQUIRED_XCODE_MAJOR) {
    throw new Error(
      `Modern macOS icon packaging requires Xcode 26 or newer with actool, but the selected toolchain is ${versionMatch[0]}. Select Xcode 26 or newer with xcode-select or DEVELOPER_DIR before packaging macOS.`,
    );
  }

  if (usePin) {
    const pinned = await usePinnedIcon({ pinDirectory, sourcePath, outputDirectory });
    if (pinned) return pinned;
  }

  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'intent-macos-icon-'));
  const iconPackage = path.join(temporaryDirectory, `${ICON_NAME}.icon`);
  const assetsDirectory = path.join(iconPackage, 'Assets');

  try {
    fs.mkdirSync(assetsDirectory, { recursive: true });
    fs.writeFileSync(
      path.join(assetsDirectory, 'Lime-Mark.png'),
      await createReleaseMark(sourcePath),
    );
    fs.writeFileSync(
      path.join(iconPackage, 'icon.json'),
      `${JSON.stringify(ICON_DOCUMENT, null, 2)}\n`,
    );

    const actoolArgs = (attemptDirectory) => [
      'actool',
      iconPackage,
      '--compile',
      path.join(attemptDirectory, 'compiled'),
      '--output-format',
      'human-readable-text',
      '--notices',
      '--warnings',
      '--errors',
      '--output-partial-info-plist',
      path.join(attemptDirectory, 'partial-info.plist'),
      ...ACTOOL_OPTIONS,
    ];
    try {
      await retryTimeouts(
        async (attempt) => {
          // Each attempt compiles into its own fresh directory, so an abandoned
          // (unkillable) earlier attempt can never write into the result.
          const attemptDirectory = path.join(temporaryDirectory, `attempt-${attempt}`);
          fs.mkdirSync(path.join(attemptDirectory, 'compiled'), { recursive: true });
          await runActool('xcrun', actoolArgs(attemptDirectory), {
            timeoutMs: actoolTimeoutMs,
            stdio: 'inherit',
            label: 'xcrun actool',
            onTimeout: logHungActool,
          });
          fs.rmSync(outputDirectory, { recursive: true, force: true });
          fs.cpSync(path.join(attemptDirectory, 'compiled'), outputDirectory, { recursive: true });
        },
        {
          attempts: actoolAttempts,
          onRetry: (error, attempt) =>
            console.log(
              `::warning title=Xcode actool hung::${error.message} ` +
                `(attempt ${attempt} of ${actoolAttempts}); retrying.`,
            ),
        },
      );
    } catch (error) {
      const detail =
        error.name === 'CommandTimeoutError'
          ? `${error.message} after ${actoolAttempts} attempts`
          : error.message;
      throw new Error(`Xcode actool failed to compile the modern macOS icon: ${detail}`, {
        cause: error,
      });
    }

    const resourcePath = path.join(outputDirectory, 'Assets.car');
    verifyIconResource(resourcePath, 'Xcode actool output');
    console.log(`Created modern macOS icon resource: ${resourcePath}`);
    return resourcePath;
  } finally {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}

/** Compile with actool and record the result as the pin later builds reuse. */
export async function pinCompiledIcon({
  execute = execFileSync,
  pinDirectory = PIN_DIRECTORY,
  sourcePath = SOURCE_PATH,
  ...options
} = {}) {
  const resourcePath = await compileModernMacOSIcon({
    ...options,
    execute,
    pinDirectory,
    sourcePath,
    usePin: false,
  });
  const version = String(
    execute('xcrun', ['xcodebuild', '-version'], { encoding: 'utf8', stdio: 'pipe' }),
  );
  const [, name = version.trim(), build] =
    version.match(/^(Xcode\s+\S+)\s*\nBuild version\s+(\S+)/m) ?? [];
  const car = fs.readFileSync(resourcePath);
  fs.mkdirSync(pinDirectory, { recursive: true });
  fs.writeFileSync(path.join(pinDirectory, 'Assets.car'), car);
  const pin = {
    inputsSha256: await iconInputsDigest(sourcePath),
    assetsSha256: sha256(car),
    xcode: build ? `${name} (${build})` : name,
  };
  fs.writeFileSync(path.join(pinDirectory, 'pin.json'), `${JSON.stringify(pin, null, 2)}\n`);
  console.log(`Pinned modern macOS icon resource in ${pinDirectory}`);
  return pin;
}

export default function buildModernMacOSIcon(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const arch = native.builderMacArch(context);
  native.validateStagedMacBinaries(path.resolve(__dirname, '..'), arch);
  return compileModernMacOSIcon();
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    await (process.argv.includes('--pin') ? pinCompiledIcon() : compileModernMacOSIcon());
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    process.exitCode = 1;
  }
}
