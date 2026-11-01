#!/usr/bin/env node
/**
 * Compile the dock clip recorder (resources/dock/screen-recorder.swift) into
 * resources/dock-helper/intent-dock-recorder, which ships with the rest of
 * dock-helper/ through electron-builder's extraResources.
 *
 * Built for the host architecture (like the speech and geometry helpers) with a
 * macOS 12.3 deployment target, the first release with ScreenCaptureKit.
 * macOS-only: elsewhere, or without swiftc, it exits 0 without a binary and the
 * recorder reports itself unsupported.
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { binaryMatchesArchitecture } = require('./macos-native.cjs');

const root = path.resolve(__dirname, '..');
const source = path.join(root, 'resources/dock/screen-recorder.swift');
const infoPlist = path.join(root, 'resources/dock/recorder-info.plist');
const destination = path.join(root, 'resources/dock-helper/intent-dock-recorder');
const DEPLOYMENT_TARGET = '12.3';
const SWIFT_ARCH = { arm64: 'arm64', x64: 'x86_64' };

function upToDate() {
  if (!fs.existsSync(destination) || !binaryMatchesArchitecture(destination, process.arch))
    return false;
  const built = fs.statSync(destination).mtimeMs;
  return [source, infoPlist, __filename].every((input) => fs.statSync(input).mtimeMs < built);
}

function main() {
  if (process.platform !== 'darwin') {
    console.log('Skipping dock recorder build (macOS only).');
    return;
  }
  try {
    execFileSync('xcrun', ['--find', 'swiftc'], { stdio: 'ignore' });
  } catch {
    console.warn('Warning: swiftc not found — dock recorder not built; recording is unavailable.');
    return;
  }
  if (upToDate()) {
    console.log(`Dock recorder up to date: ${destination}`);
    return;
  }
  const arch = SWIFT_ARCH[process.arch];
  if (!arch) {
    console.warn(`Skipping dock recorder build (unsupported arch ${process.arch}).`);
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
        '-Xlinker',
        '-sectcreate',
        '-Xlinker',
        '__TEXT',
        '-Xlinker',
        '__info_plist',
        '-Xlinker',
        infoPlist,
      ],
      { stdio: 'inherit' },
    );
    // Ad-hoc re-sign so the signature covers the embedded Info.plist; release
    // packaging replaces it with the Developer ID signature (afterPack hook).
    execFileSync('codesign', ['-f', '-s', '-', temporary], { stdio: 'inherit' });
    fs.renameSync(temporary, destination);
    console.log('Dock recorder built.');
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}

if (require.main === module) main();
module.exports = { main, destination, DEPLOYMENT_TARGET };
