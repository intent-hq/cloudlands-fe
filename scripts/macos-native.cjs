/** Shared architecture checks for native Mac packaging and cached Swift helpers. */
const fs = require('node:fs');
const path = require('node:path');
const childProcess = require('node:child_process');

const CPU_ARCH = new Map([
  [0x01000007, 'x64'],
  [0x0100000c, 'arm64'],
]);
const MACH_MAGICS = new Set([
  0xfeedface, 0xcefaedfe, 0xfeedfacf, 0xcffaedfe, 0xcafebabe, 0xbebafeca, 0xcafebabf, 0xbfbafeca,
]);

function assertNativeMacArch(arch, platform = process.platform, hostArch = process.arch) {
  if (platform !== 'darwin' || arch !== 'arm64' || hostArch !== 'arm64') {
    throw new Error(
      `Mac packaging requires a native Apple Silicon macOS host and arm64 target (got ${platform}/${hostArch}, target ${arch}); Intel, cross-building and universal builds are unsupported.`,
    );
  }
  return arch;
}

function readHeader(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const header = Buffer.alloc(4096);
    return header.subarray(0, fs.readSync(fd, header, 0, header.length, 0));
  } finally {
    fs.closeSync(fd);
  }
}

function isMachO(header) {
  return header.length >= 4 && MACH_MAGICS.has(header.readUInt32BE(0));
}

function binaryArchitectures(file) {
  const header = readHeader(file);
  if (!isMachO(header) || header.length < 8) throw new Error(`Not a Mach-O binary: ${file}`);
  const magic = header.readUInt32BE(0);
  const little = [0xcefaedfe, 0xcffaedfe, 0xbebafeca, 0xbfbafeca].includes(magic);
  const uint = (offset) => (little ? header.readUInt32LE(offset) : header.readUInt32BE(offset));
  if ([0xfeedface, 0xcefaedfe, 0xfeedfacf, 0xcffaedfe].includes(magic)) {
    const headerSize = [0xfeedfacf, 0xcffaedfe].includes(magic) ? 32 : 28;
    if (header.length < headerSize) throw new Error(`Truncated Mach-O header: ${file}`);
    return [CPU_ARCH.get(uint(4)) ?? 'unsupported'];
  }
  const count = uint(4);
  const stride = [0xcafebabf, 0xbfbafeca].includes(magic) ? 32 : 20;
  if (count === 0 || count > 64 || header.length < 8 + count * stride) {
    throw new Error(`Invalid Mach-O fat header: ${file}`);
  }
  return Array.from(
    { length: count },
    (_, index) => CPU_ARCH.get(uint(8 + index * stride)) ?? 'unsupported',
  );
}

function assertBinaryArchitecture(file, arch) {
  const arches = binaryArchitectures(file);
  if (!arches.includes(arch)) {
    throw new Error(`Wrong architecture for ${file}: expected ${arch}, found ${arches.join(', ')}`);
  }
}

function binaryMatchesArchitecture(file, arch) {
  try {
    assertBinaryArchitecture(file, arch);
    return true;
  } catch {
    return false;
  }
}

// Dock composer helpers (screen recorder, streaming dictation, element picker),
// relative to Resources in both the staging tree and the packaged app. They are
// required in every Mac package and signed individually by sign-sidecar.js.
const DOCK_COMPOSER_HELPERS = Object.freeze([
  'dock-helper/intent-dock-recorder',
  'speech-helper/intent-dock-speech',
  'dock-helper/intent-dock-element-pick',
]);

function helperPaths(resources, sidecarDirectory, includeKeychain = true) {
  return [
    path.join(resources, sidecarDirectory, 'intentd'),
    path.join(resources, 'speech-helper/intent-speech-helper'),
    ...(includeKeychain
      ? [
          path.join(
            resources,
            'keychain-helper/intent-keychain-helper.app/Contents/MacOS/intent-keychain-helper',
          ),
        ]
      : []),
    ...DOCK_COMPOSER_HELPERS.map((helper) => path.join(resources, helper)),
  ];
}

function validateStagedMacBinaries(root, arch) {
  const resources = path.join(root, 'resources');
  const required = [
    ...helperPaths(resources, 'sidecar'),
    path.join(resources, `tailcat/mac-${arch}/tailcat`),
    path.join(root, 'node_modules/node-pty/build/Release/pty.node'),
    path.join(root, 'node_modules/node-pty/build/Release/spawn-helper'),
  ];
  for (const file of required) assertBinaryArchitecture(file, arch);
  const dockHelper = path.join(resources, 'dock-helper/intent-dock-helper');
  if (fs.existsSync(dockHelper)) assertBinaryArchitecture(dockHelper, arch);
  const dockCursor = path.join(resources, 'dock-helper/intent-dock-cursor.node');
  if (fs.existsSync(dockCursor)) assertBinaryArchitecture(dockCursor, arch);
}

function validatePackagedMacBinaries(appPath, arch) {
  const contents = path.join(appPath, 'Contents');
  const resources = path.join(contents, 'Resources');
  const isolated = path.basename(appPath) === 'Intent GitLab Test.app';
  if (isolated) {
    // Read the assembled bundle, not ambient build flags or the absence of a helper.
    const info = JSON.parse(
      childProcess.execFileSync(
        'plutil',
        ['-convert', 'json', '-o', '-', path.join(contents, 'Info.plist')],
        { encoding: 'utf8' },
      ),
    );
    if (
      info.CFBundleIdentifier !== 'app.cloudlands.intent.gitlab-test' ||
      !/^manual-[1-9][0-9]{0,19}-[1-9][0-9]{0,2}$/.test(info.IntentIsolatedTestBuild || '') ||
      !/^[a-f0-9]{40}$/.test(info.IntentIsolatedTestBackend || '')
    )
      throw new Error('Invalid isolated package identity');
    if (
      info.CFBundleURLTypes !== undefined &&
      (!Array.isArray(info.CFBundleURLTypes) || info.CFBundleURLTypes.length !== 0)
    )
      throw new Error('Isolated package must not register shared protocols');
    if (fs.lstatSync(path.join(resources, 'keychain-helper'), { throwIfNoEntry: false }))
      throw new Error('Isolated package must not contain the shared Keychain helper');
  }
  const required = [
    ...helperPaths(resources, 'intentd', !isolated),
    path.join(resources, 'tailcat/tailcat'),
    path.join(resources, 'app.asar.unpacked/node_modules/node-pty/build/Release/pty.node'),
    path.join(resources, 'app.asar.unpacked/node_modules/node-pty/build/Release/spawn-helper'),
  ];
  for (const file of required) assertBinaryArchitecture(file, arch);
  const dockHelper = path.join(resources, 'dock-helper/intent-dock-helper');
  if (fs.existsSync(dockHelper)) assertBinaryArchitecture(dockHelper, arch);
  // Check Electron, frameworks, third-party helpers and all unpacked native addons too.
  // Follow framework symlinks once; leave scripts and non-native resources alone.
  const seen = new Set();
  function visit(file) {
    const real = fs.realpathSync(file);
    if (seen.has(real)) return;
    seen.add(real);
    if (fs.statSync(real).isDirectory()) {
      for (const name of fs.readdirSync(real)) visit(path.join(real, name));
    } else if (file.endsWith('.node') || isMachO(readHeader(real))) {
      assertBinaryArchitecture(real, arch);
    }
  }
  visit(contents);
}

function builderMacArch(context) {
  // electron-builder's Arch enum: ia32=0, x64=1, armv7l=2, arm64=3, universal=4.
  const arch = { 1: 'x64', 3: 'arm64' }[context.arch];
  return assertNativeMacArch(arch);
}

module.exports = {
  DOCK_COMPOSER_HELPERS,
  assertNativeMacArch,
  binaryArchitectures,
  assertBinaryArchitecture,
  binaryMatchesArchitecture,
  validateStagedMacBinaries,
  validatePackagedMacBinaries,
  builderMacArch,
};
