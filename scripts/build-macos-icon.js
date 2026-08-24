#!/usr/bin/env node
/** Compile the approved release artwork into the native macOS 26 icon resource. */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ICON_NAME = 'Intent';
const SOURCE_PATH = path.join(__dirname, '../src/assets/icons/app-icon/Icon-1024.png');
const OUTPUT_DIRECTORY = path.join(__dirname, '../build/macos-icon');

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

export async function createReleaseMark(sourcePath = SOURCE_PATH) {
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

  return sharp(mark, { raw: source.info }).png().toBuffer();
}

export async function compileModernMacOSIcon({
  execute = execFileSync,
  outputDirectory = OUTPUT_DIRECTORY,
  sourcePath = SOURCE_PATH,
} = {}) {
  try {
    execute('xcrun', ['--find', 'actool'], { stdio: 'pipe' });
  } catch {
    throw new Error(
      'Modern macOS icon packaging requires Xcode 26 or newer with actool. Install full Xcode and select it with xcode-select before packaging macOS.',
    );
  }

  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'intent-macos-icon-'));
  const iconPackage = path.join(temporaryDirectory, `${ICON_NAME}.icon`);
  const assetsDirectory = path.join(iconPackage, 'Assets');
  const partialInfoPath = path.join(temporaryDirectory, 'partial-info.plist');

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
    fs.rmSync(outputDirectory, { recursive: true, force: true });
    fs.mkdirSync(outputDirectory, { recursive: true });

    try {
      execute(
        'xcrun',
        [
          'actool',
          iconPackage,
          '--compile',
          outputDirectory,
          '--output-format',
          'human-readable-text',
          '--notices',
          '--warnings',
          '--errors',
          '--output-partial-info-plist',
          partialInfoPath,
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
        ],
        { stdio: 'inherit' },
      );
    } catch (error) {
      throw new Error(`Xcode actool failed to compile the modern macOS icon: ${error.message}`);
    }

    const resourcePath = path.join(outputDirectory, 'Assets.car');
    if (!fs.existsSync(resourcePath)) {
      throw new Error('Xcode actool did not produce the required Assets.car icon resource.');
    }
    console.log(`Created modern macOS icon resource: ${resourcePath}`);
    return resourcePath;
  } finally {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}

export default function buildModernMacOSIcon(context) {
  if (context.electronPlatformName !== 'darwin') return;
  return compileModernMacOSIcon();
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    await compileModernMacOSIcon();
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    process.exitCode = 1;
  }
}
