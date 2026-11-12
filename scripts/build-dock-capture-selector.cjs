#!/usr/bin/env node
/** Compile the window and region capture selector for macOS 14.2+, without running it. */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { binaryMatchesArchitecture } = require('./macos-native.cjs');

const root = path.resolve(__dirname, '..');
const source = path.join(root, 'resources/dock/capture-selector.swift');
const infoPlist = path.join(root, 'resources/dock/recorder-info.plist');
const destination = path.join(root, 'resources/dock-helper/intent-dock-capture-selector');
const DEPLOYMENT_TARGET = '14.2';
const SWIFT_ARCH = { arm64: 'arm64', x64: 'x86_64' };

function upToDate() {
  if (!fs.existsSync(destination) || !binaryMatchesArchitecture(destination, process.arch))
    return false;
  const built = fs.statSync(destination).mtimeMs;
  return [source, infoPlist, __filename].every((input) => fs.statSync(input).mtimeMs < built);
}

function main() {
  if (process.platform !== 'darwin') {
    console.log('Skipping dock capture selector build (macOS only).');
    return;
  }
  try {
    execFileSync('xcrun', ['--find', 'swiftc'], { stdio: 'ignore' });
  } catch {
    console.warn('Warning: swiftc not found — dock capture selector not built; window and region capture are unavailable.');
    return;
  }
  if (upToDate()) {
    console.log(`Dock capture selector up to date: ${destination}`);
    return;
  }
  const arch = SWIFT_ARCH[process.arch];
  if (!arch) {
    console.warn(`Skipping dock capture selector build (unsupported arch ${process.arch}).`);
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
    console.log('Dock capture selector built.');
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}

if (require.main === module) main();
module.exports = { main, destination, DEPLOYMENT_TARGET };
