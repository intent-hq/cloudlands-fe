#!/usr/bin/env node
/**
 * Build macOS .icns from Icon-iOS-Default-* icons
 * Adds ~12% padding to match macOS icon visual guidelines
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ICONS_DIR = path.join(__dirname, '../src/assets/icons');
const OUTPUT_DIR = path.join(__dirname, '../src/assets/icons');
const ICONSET_DIR = path.join(OUTPUT_DIR, 'AppIcon.iconset');

// Padding ratio - macOS icons typically have ~12% margin
const PADDING_RATIO = 0.1;

// macOS iconutil requires these exact filenames and sizes
const ICONSET_SPEC = {
  'icon_16x16.png': { size: 16, scale: 1 },
  'icon_16x16@2x.png': { size: 16, scale: 2 },
  'icon_32x32.png': { size: 32, scale: 1 },
  'icon_32x32@2x.png': { size: 32, scale: 2 },
  'icon_128x128.png': { size: 128, scale: 1 },
  'icon_128x128@2x.png': { size: 128, scale: 2 },
  'icon_256x256.png': { size: 256, scale: 1 },
  'icon_256x256@2x.png': { size: 256, scale: 2 },
  'icon_512x512.png': { size: 512, scale: 1 },
  'icon_512x512@2x.png': { size: 512, scale: 2 },
};

function getSourceFilename(size, scale) {
  if (size === 512 && scale === 2) {
    return 'Icon-iOS-Default-1024x1024@1x.png';
  }
  return `Icon-iOS-Default-${size}x${size}@${scale}x.png`;
}

async function processIcon(sourcePath, destPath, targetSize) {
  // Calculate the inner size after padding
  const padding = Math.round(targetSize * PADDING_RATIO);
  const innerSize = targetSize - padding * 2;

  await sharp(sourcePath)
    .resize(innerSize, innerSize, { fit: 'contain' })
    .extend({
      top: padding,
      bottom: padding,
      left: padding,
      right: padding,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png({ compressionLevel: 9 })
    .toFile(destPath);
}

async function main() {
  console.log('🔧 Building macOS .icns with padding...\n');

  if (fs.existsSync(ICONSET_DIR)) {
    fs.rmSync(ICONSET_DIR, { recursive: true });
  }
  fs.mkdirSync(ICONSET_DIR, { recursive: true });

  let processedCount = 0;

  for (const [iconsetName, { size, scale }] of Object.entries(ICONSET_SPEC)) {
    const sourceFilename = getSourceFilename(size, scale);
    const sourcePath = path.join(ICONS_DIR, sourceFilename);
    const destPath = path.join(ICONSET_DIR, iconsetName);
    const targetPixels = size * scale;

    if (fs.existsSync(sourcePath)) {
      await processIcon(sourcePath, destPath, targetPixels);
      console.log(
        `  ✓ ${iconsetName} (${targetPixels}px with ${Math.round(PADDING_RATIO * 100)}% padding)`,
      );
      processedCount++;
    } else {
      console.log(`  ✗ Missing: ${sourceFilename}`);
    }
  }

  console.log(`\n📁 Processed ${processedCount}/10 icons`);

  const icnsPath = path.join(OUTPUT_DIR, 'icon.icns');
  const pngPath = path.join(OUTPUT_DIR, 'icon.png');

  // Also generate icon.png for dev mode (use 512x512 with padding)
  const sourcePng = path.join(ICONS_DIR, 'Icon-iOS-Default-512x512@1x.png');
  if (fs.existsSync(sourcePng)) {
    await processIcon(sourcePng, pngPath, 512);
    console.log(`\n✅ Created: icon.png (512px with padding for dev mode)`);
  }

  try {
    console.log('\n🔨 Running iconutil...');
    execSync(`iconutil -c icns "${ICONSET_DIR}" -o "${icnsPath}"`, { stdio: 'inherit' });
    const finalSize = (fs.statSync(icnsPath).size / 1024).toFixed(0);
    console.log(`✅ Created: ${icnsPath} (${finalSize} KB)`);

    fs.rmSync(ICONSET_DIR, { recursive: true });
    console.log('🧹 Cleaned up temporary iconset directory');
  } catch (error) {
    console.error('\n❌ Failed to create .icns:', error.message);
    process.exit(1);
  }
}

main();
