#!/usr/bin/env node
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { binaryMatchesArchitecture, binaryArchitectures } = require('./macos-native.cjs');
const root = path.resolve(__dirname, '..');
const source = path.join(root, 'resources/dock/display-geometry.swift');
const destination = path.join(root, 'resources/dock-helper/intent-dock-helper');
if (process.platform !== 'darwin') process.exit(0);
try {
  execFileSync('xcrun', ['--find', 'swiftc'], { stdio: 'ignore' });
} catch {
  console.warn('Swift compiler unavailable; the dock will use its safe top-center fallback.');
  process.exit(0);
}
fs.mkdirSync(path.dirname(destination), { recursive: true });
if (
  !fs.existsSync(destination) ||
  !binaryMatchesArchitecture(destination, process.arch) ||
  fs.statSync(destination).mtimeMs <=
    Math.max(fs.statSync(source).mtimeMs, fs.statSync(__filename).mtimeMs)
) {
  execFileSync('xcrun', ['swiftc', '-O', '-o', destination, source], { stdio: 'inherit' });
  execFileSync('codesign', ['-f', '-s', '-', destination], { stdio: 'inherit' });
}

// Stable C Node-API avoids binding this AppKit addon to a particular Electron ABI.
const cursorSource = path.join(root, 'resources/dock/cursor.mm');
const cursorDestination = path.join(root, 'resources/dock-helper/intent-dock-cursor.node');
const includeDirectory = require('node-api-headers').include_dir;
const headerFiles = fs.readdirSync(includeDirectory).filter((file) => file.endsWith('.h'));
const cursorInputs = [
  cursorSource,
  __filename,
  ...headerFiles.map((file) => path.join(includeDirectory, file)),
];
const universal =
  fs.existsSync(cursorDestination) &&
  binaryMatchesArchitecture(cursorDestination, 'arm64') &&
  binaryMatchesArchitecture(cursorDestination, 'x64');
if (
  !universal ||
  fs.statSync(cursorDestination).mtimeMs <=
    Math.max(...cursorInputs.map((file) => fs.statSync(file).mtimeMs))
) {
  const temporary = `${cursorDestination}.${process.pid}.tmp`;
  try {
    execFileSync(
      'xcrun',
      [
        'clang++',
        '-std=c++17',
        '-fobjc-arc',
        '-fobjc-weak',
        '-fexceptions',
        '-O2',
        '-Wall',
        '-Wextra',
        '-Werror',
        '-Wno-unused-parameter',
        '-arch',
        'arm64',
        '-arch',
        'x86_64',
        '-mmacosx-version-min=12.0',
        '-bundle',
        '-undefined',
        'dynamic_lookup',
        '-framework',
        'AppKit',
        '-DNAPI_VERSION=8',
        '-DNODE_GYP_MODULE_NAME=intent_dock_cursor',
        '-I',
        includeDirectory,
        cursorSource,
        '-o',
        temporary,
      ],
      { stdio: 'inherit' },
    );
    const arches = binaryArchitectures(temporary);
    if (!arches.includes('arm64') || !arches.includes('x64'))
      throw new Error('Dock cursor addon must contain both macOS architectures');
    execFileSync('codesign', ['-f', '-s', '-', temporary], { stdio: 'inherit' });
    fs.renameSync(temporary, cursorDestination);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}
