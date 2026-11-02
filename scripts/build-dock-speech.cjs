#!/usr/bin/env node
/**
 * Compile the dock's streaming dictation helper (resources/speech/dock-speech.swift)
 * into resources/speech-helper/intent-dock-speech, beside the batch
 * intent-speech-helper whose build and ABI stay separate.
 *
 * macOS-only and optional: without swiftc this exits 0 and the dock reports
 * streaming dictation as unavailable (dock-speech.ts probes for the binary).
 * The deployment target stays below macOS 26 so the SpeechAnalyzer path is
 * chosen at runtime and SFSpeechRecognizer remains the fallback.
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { binaryMatchesArchitecture } = require('./macos-native.cjs');

const FE_DIR = path.resolve(__dirname, '..');
const sourceFile = path.join(FE_DIR, 'resources/speech/dock-speech.swift');
const infoPlist = path.join(FE_DIR, 'resources/speech/dock-speech-info.plist');
const destBin = path.join(FE_DIR, 'resources/speech-helper/intent-dock-speech');
const DEPLOYMENT_TARGET = '13.0';

if (process.platform !== 'darwin') {
  console.log('Skipping dock speech helper build (macOS only).');
  process.exit(0);
}

try {
  execFileSync('xcrun', ['--find', 'swiftc'], { stdio: 'ignore' });
} catch {
  console.warn('Warning: swiftc not found — streaming dock dictation will be unavailable.');
  process.exit(0);
}

const inputs = [sourceFile, infoPlist, __filename];
if (
  fs.existsSync(destBin) &&
  binaryMatchesArchitecture(destBin, process.arch) &&
  inputs.every((file) => fs.statSync(destBin).mtimeMs > fs.statSync(file).mtimeMs)
) {
  console.log(`Dock speech helper up to date: ${destBin}`);
  process.exit(0);
}

const arch = process.arch === 'x64' ? 'x86_64' : 'arm64';
fs.mkdirSync(path.dirname(destBin), { recursive: true });
const temporary = `${destBin}.${process.pid}.tmp`;
console.log(`Compiling ${sourceFile} -> ${destBin}`);
try {
  execFileSync(
    'xcrun',
    [
      'swiftc',
      '-O',
      '-swift-version',
      '5',
      '-target',
      `${arch}-apple-macos${DEPLOYMENT_TARGET}`,
      '-o',
      temporary,
      sourceFile,
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
  // packaging replaces it with the Developer ID signature.
  execFileSync('codesign', ['-f', '-s', '-', temporary], { stdio: 'inherit' });
  fs.renameSync(temporary, destBin);
} finally {
  fs.rmSync(temporary, { force: true });
}
console.log('Dock speech helper built.');
