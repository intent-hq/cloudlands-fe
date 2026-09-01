#!/usr/bin/env node
/** Build desktop and web icons from the approved app icon PNGs. */

import { execFileSync } from 'child_process';
import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { fileURLToPath, pathToFileURL } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ICONS_DIR = path.join(__dirname, '../src/assets/icons');
const SOURCE_DIR = path.join(ICONS_DIR, 'app-icon');
const ICONSET_DIR = path.join(ICONS_DIR, 'AppIcon.iconset');
const DEV_SOURCE_PATH = path.join(SOURCE_DIR, 'Dev-Source.png');
const DEV_ICONSET_DIR = path.join(ICONS_DIR, 'DevAppIcon.iconset');
const FAVICON_PATH = path.join(__dirname, '../static/favicon.png');
const SOURCE_SIZES = [32, 64, 128, 256, 512, 1024];
export const ICO_SIZES = [16, 32, 48, 64, 128, 256];
const WINDOWS_CONTENT_INSET_RATIO = 0.03;
const DEV_SOURCE_SHA256 = '4e6e13f59557bb3ee33ed7810ba07d05f7308d564e16456b1117885822c68581';
const DEV_SOURCE_ALPHA_BOUNDS = { left: 80, top: 91, right: 943, bottom: 954 };

// macOS iconutil requires these exact filenames and sizes
const ICONSET_SPEC = {
  'icon_16x16.png': 16,
  'icon_16x16@2x.png': 32,
  'icon_32x32.png': 32,
  'icon_32x32@2x.png': 64,
  'icon_128x128.png': 128,
  'icon_128x128@2x.png': 256,
  'icon_256x256.png': 256,
  'icon_256x256@2x.png': 512,
  'icon_512x512.png': 512,
  'icon_512x512@2x.png': 1024,
};

function sourcePath(size) {
  const sourceSize = SOURCE_SIZES.find((candidate) => candidate >= size);
  return path.join(SOURCE_DIR, `Icon-${sourceSize}.png`);
}

async function releasePngBuffer(size) {
  const source = sourcePath(size);
  const metadata = await sharp(source).metadata();
  if (metadata.width === size && metadata.height === size) return fs.readFileSync(source);
  return sharp(source).resize(size, size).png().toBuffer();
}

export async function releaseWindowsPngBuffer(size, source = sourcePath(1024)) {
  const inset = Math.max(1, Math.round(size * WINDOWS_CONTENT_INSET_RATIO));
  const contentSize = size - inset * 2;
  return sharp(source)
    .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 }, threshold: 0 })
    .resize(contentSize, contentSize, {
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .extend({
      top: inset,
      bottom: inset,
      left: inset,
      right: inset,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();
}

async function devPngBuffer(size) {
  return sharp(DEV_SOURCE_PATH).resize(size, size).png().toBuffer();
}

async function validateReleaseSources() {
  for (const size of SOURCE_SIZES) {
    const source = sourcePath(size);
    const metadata = await sharp(source).metadata();
    if (metadata.format !== 'png' || metadata.width !== size || metadata.height !== size) {
      throw new Error(`${source} must be a ${size}x${size} PNG`);
    }
  }
}

async function validateDevSource() {
  const source = fs.readFileSync(DEV_SOURCE_PATH);
  const devMetadata = await sharp(source).metadata();
  if (devMetadata.format !== 'png' || devMetadata.width !== 1024 || devMetadata.height !== 1024) {
    throw new Error(`${DEV_SOURCE_PATH} must be a 1024x1024 PNG`);
  }
  if (createHash('sha256').update(source).digest('hex') !== DEV_SOURCE_SHA256) {
    throw new Error(`${DEV_SOURCE_PATH} must match the approved unstable icon source`);
  }

  const { data, info } = await sharp(source)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const bounds = { left: info.width, top: info.height, right: -1, bottom: -1 };
  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      if (data[(y * info.width + x) * info.channels + 3] === 0) continue;
      bounds.left = Math.min(bounds.left, x);
      bounds.top = Math.min(bounds.top, y);
      bounds.right = Math.max(bounds.right, x);
      bounds.bottom = Math.max(bounds.bottom, y);
    }
  }
  if (Object.keys(bounds).some((key) => bounds[key] !== DEV_SOURCE_ALPHA_BOUNDS[key])) {
    throw new Error(`${DEV_SOURCE_PATH} must preserve the approved transparent spacing`);
  }
}

async function buildIcns(pngBuffer, iconsetDirectory, destination) {
  fs.rmSync(iconsetDirectory, { recursive: true, force: true });
  fs.mkdirSync(iconsetDirectory, { recursive: true });

  try {
    for (const [filename, size] of Object.entries(ICONSET_SPEC)) {
      fs.writeFileSync(path.join(iconsetDirectory, filename), await pngBuffer(size));
    }
    execFileSync('iconutil', ['-c', 'icns', iconsetDirectory, '-o', destination]);
  } finally {
    fs.rmSync(iconsetDirectory, { recursive: true, force: true });
  }
}

export async function buildIco(pngBuffer, destination) {
  const images = await Promise.all(ICO_SIZES.map((size) => pngBuffer(size)));
  const headerSize = 6 + images.length * 16;
  const header = Buffer.alloc(headerSize);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = headerSize;

  images.forEach((image, index) => {
    const size = ICO_SIZES[index];
    const entry = 6 + index * 16;
    header.writeUInt8(size === 256 ? 0 : size, entry);
    header.writeUInt8(size === 256 ? 0 : size, entry + 1);
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(image.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += image.length;
  });

  fs.writeFileSync(destination, Buffer.concat([header, ...images]));
}

async function buildDevelopmentIcons() {
  await buildIcns(devPngBuffer, DEV_ICONSET_DIR, path.join(ICONS_DIR, 'dev-icon.icns'));
  await buildIco(devPngBuffer, path.join(ICONS_DIR, 'dev-icon.ico'));
  fs.writeFileSync(path.join(ICONS_DIR, 'dev-icon.png'), await devPngBuffer(512));
}

async function main() {
  const args = process.argv.slice(2);
  const unknownArgs = args.filter((arg) => arg !== '--dev-only');
  if (unknownArgs.length > 0) throw new Error(`Unknown argument: ${unknownArgs[0]}`);

  if (args.includes('--dev-only')) {
    console.log('Building development app icons...');
    await validateDevSource();
    await buildDevelopmentIcons();
    console.log('Created dev-icon PNG/ICO/ICNS assets');
    return;
  }

  console.log('Building release and development app icons...');
  await validateReleaseSources();
  await validateDevSource();

  await buildIcns(releasePngBuffer, ICONSET_DIR, path.join(ICONS_DIR, 'icon.icns'));
  await buildIco(releaseWindowsPngBuffer, path.join(ICONS_DIR, 'icon.ico'));
  fs.copyFileSync(sourcePath(512), path.join(ICONS_DIR, 'icon.png'));
  fs.copyFileSync(sourcePath(128), FAVICON_PATH);

  await buildDevelopmentIcons();
  console.log('Created release icons, favicon.png, and dev-icon PNG/ICO/ICNS assets');
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
