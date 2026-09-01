#!/usr/bin/env node
/**
 * Stage the pinned tailcat client binary (tunnel transport, monorepo tunnel
 * feature) at resources/tailcat/tailcat[.exe], plus its BSD-3-Clause LICENSE
 * as tailcat.LICENSE next to the binary. Mirrors intentd's CI staging
 * (.github/dist-build-setup.yml "Stage tailcat sidecar binary"): Linux and
 * Windows use the checksum-verified upstream prebuilt release assets; macOS
 * has no prebuilt assets, so it is a source build of the same pinned tag with
 * the upstream release build tags (build-tags.txt) and goreleaser flags
 * (CGO_ENABLED=0, -s -w, -X main.version). Bump TAILCAT_VERSION and the
 * pinned sha256s together (sha256s from the release's checksums.txt).
 *
 * Env:
 *   TAILCAT_SKIP=1   skip staging entirely (still creates the empty staging
 *                    dir so electron-builder's extraResources entry resolves);
 *                    packaged builds then ship without tunnel dialing.
 *
 * Flags: --force re-fetches even when the staged binary already matches the pin.
 *
 * Idempotent: a stamp file (resources/tailcat/.tailcat-fetch-stamp.json)
 * records what was staged; matching version+target+staged-binary-hash skips
 * the download/build.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');

const TAILCAT_VERSION = '0.4.0';
const TAILCAT_REPO = 'tailscale/tailcat';
// sha256s of the upstream prebuilt archives (checksums.txt of the release).
const PREBUILT = {
  'linux-x64': {
    asset: `tailcat_${TAILCAT_VERSION}_linux_amd64.tar.gz`,
    sha256: '8b819c43dfdf806b5663e23535aba557bb106075b0b5839df289af9bba70bec2',
  },
  'linux-arm64': {
    asset: `tailcat_${TAILCAT_VERSION}_linux_arm64.tar.gz`,
    sha256: '3b77322350f64d229d5b2119b159b863b4bcffa0a62a0294682423a19956dc76',
  },
  'win32-x64': {
    asset: `tailcat_${TAILCAT_VERSION}_windows_amd64.zip`,
    sha256: 'c238a4e8d3b460423a67e5ad400888b73ffa0b28e15173fd32c9acb699a3a89e',
  },
  'win32-arm64': {
    asset: `tailcat_${TAILCAT_VERSION}_windows_arm64.zip`,
    sha256: '78b26d4be91d251bb9b8b865139bddc5e4545ca1c3316a90faa57c6521aed153',
  },
};

const FE_DIR = path.resolve(__dirname, '..');
const DEST_DIR = path.join(FE_DIR, 'resources/tailcat');
const STAMP_FILE = path.join(DEST_DIR, '.tailcat-fetch-stamp.json');

function binaryName(platform) {
  return platform === 'win32' ? 'tailcat.exe' : 'tailcat';
}

async function download(url) {
  const res = await fetch(url, {
    headers: { 'user-agent': 'cloudlands-fe fetch-tailcat' },
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`Failed to download ${url}: HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

// Same relative-path tar invocation as fetch-sidecar.cjs: GNU tar on Windows
// parses drive letters in absolute paths as remote hosts (monorepo#1282).
function execTar(archivePath, args) {
  return execFileSync('tar', args, { encoding: 'utf8', cwd: path.dirname(archivePath) });
}

function listArchiveEntries(archivePath) {
  const output =
    archivePath.endsWith('.zip') && process.platform !== 'win32'
      ? execFileSync('unzip', ['-Z1', archivePath], { encoding: 'utf8' })
      : execTar(archivePath, ['-tf', path.basename(archivePath)]);
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function assertNoLinkEntries(lib, archivePath) {
  const output =
    archivePath.endsWith('.zip') && process.platform !== 'win32'
      ? execFileSync('unzip', ['-Z', archivePath], { encoding: 'utf8' })
      : execTar(archivePath, ['-tvf', path.basename(archivePath)]);
  if (output.split('\n').some((line) => lib.isLinkListingLine(line))) {
    throw new Error(
      `Refusing to extract ${path.basename(archivePath)}: archive contains symlink/hardlink entries`,
    );
  }
}

function extractArchive(lib, archivePath, extractDir) {
  const unsafe = listArchiveEntries(archivePath).filter((entry) => !lib.isSafeArchiveEntry(entry));
  if (unsafe.length > 0) {
    throw new Error(
      `Refusing to extract ${path.basename(archivePath)}: unsafe entry paths: ${unsafe.slice(0, 5).join(', ')}`,
    );
  }
  assertNoLinkEntries(lib, archivePath);
  if (archivePath.endsWith('.zip') && process.platform !== 'win32') {
    execFileSync('unzip', ['-o', '-q', archivePath, '-d', extractDir]);
  } else {
    execTar(archivePath, [
      '-xf',
      path.basename(archivePath),
      '-C',
      path.relative(path.dirname(archivePath), extractDir) || '.',
    ]);
  }
}

/** Source-build for macOS (no upstream prebuilt assets); requires Go. */
function buildFromSource(tmpDir, goarch, binName) {
  try {
    execFileSync('go', ['version'], { encoding: 'utf8' });
  } catch {
    throw new Error(
      `tailcat has no prebuilt macOS assets and Go is not installed; install Go or set TAILCAT_SKIP=1 to package without tunnel support`,
    );
  }
  const srcDir = path.join(tmpDir, 'src');
  execFileSync('git', [
    'clone',
    '--depth',
    '1',
    '--branch',
    `v${TAILCAT_VERSION}`,
    `https://github.com/${TAILCAT_REPO}`,
    srcDir,
  ]);
  const tags = fs.readFileSync(path.join(srcDir, 'build-tags.txt'), 'utf8').replace(/\s+/g, '');
  execFileSync(
    'go',
    [
      'build',
      `-tags=${tags}`,
      '-ldflags',
      `-s -w -X main.version=v${TAILCAT_VERSION}`,
      '-o',
      binName,
      './cmd/tailcat',
    ],
    { cwd: srcDir, env: { ...process.env, CGO_ENABLED: '0', GOARCH: goarch } },
  );
  return { binPath: path.join(srcDir, binName), licensePath: path.join(srcDir, 'LICENSE') };
}

function readStamp() {
  try {
    return JSON.parse(fs.readFileSync(STAMP_FILE, 'utf8'));
  } catch {
    return null;
  }
}

async function main() {
  const force = process.argv.includes('--force');
  const platform = process.env.TAILCAT_PLATFORM || process.platform;
  const arch = process.env.TAILCAT_ARCH || process.arch;
  const binName = binaryName(platform);
  const destBin = path.join(DEST_DIR, binName);
  const destLicense = path.join(DEST_DIR, 'tailcat.LICENSE');
  fs.mkdirSync(DEST_DIR, { recursive: true });

  if (process.env.TAILCAT_SKIP === '1') {
    console.log('TAILCAT_SKIP=1 — skipping tailcat staging (packaged build ships without tunnel dialing)');
    return;
  }

  const lib = await import(pathToFileURL(path.join(__dirname, 'fetch-sidecar-lib.mjs')).href);

  const stamp = readStamp();
  if (
    !force &&
    stamp?.version === TAILCAT_VERSION &&
    stamp?.platform === platform &&
    stamp?.arch === arch &&
    fs.existsSync(destBin) &&
    lib.sha256Hex(fs.readFileSync(destBin)) === stamp?.binSha256 &&
    fs.existsSync(destLicense)
  ) {
    console.log(`tailcat v${TAILCAT_VERSION} (${platform}-${arch}) already staged; skipping (--force to re-fetch)`);
    return;
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tailcat-fetch-'));
  try {
    let binPath;
    let licensePath;
    if (platform === 'darwin') {
      ({ binPath, licensePath } = buildFromSource(
        tmpDir,
        arch === 'arm64' ? 'arm64' : 'amd64',
        binName,
      ));
    } else {
      const pin = PREBUILT[`${platform}-${arch}`];
      if (!pin) throw new Error(`No pinned tailcat asset for ${platform}-${arch}`);
      const url = `https://github.com/${TAILCAT_REPO}/releases/download/v${TAILCAT_VERSION}/${pin.asset}`;
      console.log(`Downloading ${url}`);
      const archive = await download(url);
      const actual = lib.sha256Hex(archive);
      if (actual !== pin.sha256) {
        throw new Error(`Checksum mismatch for ${pin.asset}: expected ${pin.sha256}, got ${actual}`);
      }
      const archivePath = path.join(tmpDir, pin.asset);
      fs.writeFileSync(archivePath, archive);
      extractArchive(lib, archivePath, tmpDir);
      binPath = path.join(tmpDir, binName);
      licensePath = path.join(tmpDir, 'LICENSE');
    }
    if (!fs.existsSync(binPath)) throw new Error(`tailcat binary missing after staging: ${binPath}`);
    if (!fs.existsSync(licensePath)) throw new Error(`tailcat LICENSE missing after staging: ${licensePath}`);
    fs.copyFileSync(binPath, destBin);
    if (platform !== 'win32') fs.chmodSync(destBin, 0o755);
    fs.copyFileSync(licensePath, destLicense);
    fs.writeFileSync(
      STAMP_FILE,
      `${JSON.stringify(
        {
          version: TAILCAT_VERSION,
          platform,
          arch,
          binSha256: lib.sha256Hex(fs.readFileSync(destBin)),
        },
        null,
        2,
      )}\n`,
    );
    console.log(`Staged tailcat v${TAILCAT_VERSION} (${platform}-${arch}) at ${destBin}`);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(`fetch-tailcat failed: ${error.message}`);
  process.exit(1);
});
