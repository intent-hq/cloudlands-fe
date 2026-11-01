#!/usr/bin/env node
/**
 * Compile the dock annotation element picker (resources/dock/element-pick.swift)
 * into resources/dock-helper/intent-dock-element-pick, shipped with the rest of
 * dock-helper/ through electron-builder's extraResources.
 *
 * Host architecture, macOS 12.0 deployment target, ad-hoc signed (release
 * packaging re-signs with the Developer ID). macOS-only: elsewhere, or without
 * swiftc, it exits 0 without a binary and picking reports itself unavailable.
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { binaryMatchesArchitecture } = require('./macos-native.cjs');

const root = path.resolve(__dirname, '..');
const source = path.join(root, 'resources/dock/element-pick.swift');
const destination = path.join(root, 'resources/dock-helper/intent-dock-element-pick');
const DEPLOYMENT_TARGET = '12.0';
const SWIFT_ARCH = { arm64: 'arm64', x64: 'x86_64' };

function upToDate() {
  if (!fs.existsSync(destination) || !binaryMatchesArchitecture(destination, process.arch))
    return false;
  const built = fs.statSync(destination).mtimeMs;
  return [source, __filename].every((input) => fs.statSync(input).mtimeMs < built);
}

function main() {
  if (process.platform !== 'darwin') {
    console.log('Skipping dock element picker build (macOS only).');
    return;
  }
  try {
    execFileSync('xcrun', ['--find', 'swiftc'], { stdio: 'ignore' });
  } catch {
    console.warn('Warning: swiftc not found — element picker not built; picks carry no metadata.');
    return;
  }
  if (upToDate()) {
    console.log(`Dock element picker up to date: ${destination}`);
    return;
  }
  const arch = SWIFT_ARCH[process.arch];
  if (!arch) {
    console.warn(`Skipping dock element picker build (unsupported arch ${process.arch}).`);
    return;
  }
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.${process.pid}.tmp`;
  try {
    execFileSync(
      'xcrun',
      [
        'swiftc',
        '-O',
        '-target',
        `${arch}-apple-macos${DEPLOYMENT_TARGET}`,
        '-o',
        temporary,
        source,
      ],
      { stdio: 'inherit' },
    );
    execFileSync('codesign', ['-f', '-s', '-', temporary], { stdio: 'inherit' });
    fs.renameSync(temporary, destination);
    console.log('Dock element picker built.');
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}

if (require.main === module) main();
module.exports = { main, destination, DEPLOYMENT_TARGET };
