/** Shared architecture checks for native Mac packaging and cached Swift helpers. */
const fs = require('node:fs');
const path = require('node:path');

const CPU_ARCH = new Map([
  [0x01000007, 'x64'],
  [0x0100000c, 'arm64'],
]);
const MACH_MAGICS = new Set([
  0xfeedface, 0xcefaedfe, 0xfeedfacf, 0xcffaedfe, 0xcafebabe, 0xbebafeca, 0xcafebabf, 0xbfbafeca,
]);

function assertNativeMacArch(arch, platform = process.platform, hostArch = process.arch) {
  if (platform !== 'darwin' || !['x64', 'arm64'].includes(arch) || arch !== hostArch) {
    throw new Error(
      `Mac packaging requires a native ${arch} macOS host (got ${platform}/${hostArch}); cross-building and universal builds are unsupported.`,
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

function helperPaths(resources, sidecarDirectory) {
  return [
    path.join(resources, sidecarDirectory, 'intentd'),
    path.join(resources, 'speech-helper/intent-speech-helper'),
    path.join(
      resources,
      'keychain-helper/intent-keychain-helper.app/Contents/MacOS/intent-keychain-helper',
    ),
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
}

function validatePackagedMacBinaries(appPath, arch) {
  const contents = path.join(appPath, 'Contents');
  const resources = path.join(contents, 'Resources');
  const required = [
    ...helperPaths(resources, 'intentd'),
    path.join(resources, 'tailcat/tailcat'),
    path.join(resources, 'app.asar.unpacked/node_modules/node-pty/build/Release/pty.node'),
    path.join(resources, 'app.asar.unpacked/node_modules/node-pty/build/Release/spawn-helper'),
  ];
  for (const file of required) assertBinaryArchitecture(file, arch);
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
  assertNativeMacArch,
  binaryArchitectures,
  assertBinaryArchitecture,
  binaryMatchesArchitecture,
  validateStagedMacBinaries,
  validatePackagedMacBinaries,
  builderMacArch,
};
