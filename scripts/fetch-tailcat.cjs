#!/usr/bin/env node
/**
 * Stage the pinned tailcat client binary (tunnel transport, monorepo tunnel
 * feature) per packaging target at resources/tailcat/<os>-<arch>/tailcat[.exe]
 * (electron-builder `${os}`/`${arch}` macro names, so the extraResources entry
 * `resources/tailcat/${os}-${arch}` picks the matching binary per built
 * artifact — a multi-platform `electron-builder -mwl` run must not ship the
 * build host's binary into every artifact), plus its BSD-3-Clause LICENSE as
 * tailcat.LICENSE next to each binary. Mirrors intentd's CI staging
 * (.github/dist-build-setup.yml "Stage tailcat sidecar binary"): Linux and
 * Windows use the checksum-verified upstream prebuilt release assets; macOS
 * has no prebuilt assets, so it is a source build of the same pinned tag with
 * the upstream release build tags (build-tags.txt) and goreleaser flags
 * (CGO_ENABLED=0, -s -w, -X main.version), verified against the pinned commit
 * hash (tags are mutable; the commit pin is the macOS analog of the archive
 * sha256s). Bump TAILCAT_VERSION, TAILCAT_COMMIT, and the pinned sha256s
 * together (sha256s from the release's checksums.txt; commit from
 * `git rev-parse v<version>^{}`).
 *
 * Flags:
 *   --force               re-fetch even when a staged binary matches the pin.
 *   --targets=a,b         comma-separated node-style targets to stage
 *                         (linux-x64, linux-arm64, win32-x64, win32-arm64,
 *                         darwin-arm64, darwin-x64). Also readable from the
 *                         TAILCAT_TARGETS env var; defaults to the build host.
 *
 * Env:
 *   TAILCAT_SKIP=1   skip staging entirely AND remove previously staged
 *                    binaries (still creates the empty per-target staging dirs
 *                    so electron-builder's extraResources entries resolve);
 *                    packaged builds then ship without tunnel dialing.
 *
 * Idempotent: a per-target stamp file (<target-dir>/.tailcat-fetch-stamp.json)
 * records what was staged; matching version+target+staged-binary-hash skips
 * the download/build.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');

const TAILCAT_VERSION = '0.4.0';
// The commit the v<TAILCAT_VERSION> tag points at, pre-resolved so the macOS
// source build fails closed if the upstream tag is ever moved.
const TAILCAT_COMMIT = 'ce6fedcabc220bab3b94d470ab330219111eeae8';
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
const STAMP_NAME = '.tailcat-fetch-stamp.json';

function binaryName(platform) {
  return platform === 'win32' ? 'tailcat.exe' : 'tailcat';
}

/**
 * Parse a node-style target token (`<platform>-<arch>`, e.g. `linux-x64`,
 * `win32-arm64`, `darwin-arm64`) into { platform, arch, dir } where `dir` is
 * the per-target staging directory name using electron-builder's `${os}`
 * macro vocabulary (mac | win | linux) so the extraResources `from` template
 * `resources/tailcat/${os}-${arch}` resolves it.
 */
function parseTarget(token) {
  const match = /^(darwin|win32|linux)-(x64|arm64)$/.exec(token.trim());
  if (!match) {
    throw new Error(
      `Invalid tailcat target "${token}" (expected <darwin|win32|linux>-<x64|arm64>)`,
    );
  }
  const [, platform, arch] = match;
  const builderOs = platform === 'darwin' ? 'mac' : platform === 'win32' ? 'win' : 'linux';
  return { platform, arch, dir: `${builderOs}-${arch}` };
}

function resolveTargets(argv, env) {
  const flag = argv.find((arg) => arg.startsWith('--targets='));
  const raw = flag ? flag.slice('--targets='.length) : env.TAILCAT_TARGETS;
  const tokens = raw
    ? raw.split(',').filter((token) => token.trim().length > 0)
    : [`${process.platform}-${process.arch}`];
  return tokens.map(parseTarget);
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
function execArchiveTool(command, archivePath, args) {
  return execFileSync(command, args, { encoding: 'utf8', cwd: path.dirname(archivePath) });
}

function commandWorks(command, probeArgs) {
  try {
    execFileSync(command, probeArgs, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve a tool that can read the given archive: `{ kind: 'tar'|'unzip',
 * command }`. Plain tarballs use `tar`. For .zip, GNU tar cannot read the
 * format ("This does not look like a tar archive"), so resolve in order:
 *   1. Windows System32 tar.exe (bsdtar) explicitly — the workflows scope
 *      their System32 PATH prefix only around fetch-sidecar, and
 *      fetch-tailcat runs later inside `pnpm run dist:*` without it, where
 *      PATH may resolve Git's GNU tar (monorepo#1282).
 *   2. `unzip` (Ubuntu CI runners, most Linux hosts).
 *   3. `bsdtar` (libarchive-tools).
 *   4. `tar` when it self-identifies as bsdtar (macOS's default).
 * A host with none of these gets a clear error naming the fix instead of an
 * opaque extraction failure.
 */
function archiveTool(archivePath) {
  if (!archivePath.endsWith('.zip')) return { kind: 'tar', command: 'tar' };
  if (process.platform === 'win32') {
    const systemTar = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
    if (fs.existsSync(systemTar)) return { kind: 'tar', command: systemTar };
  }
  if (commandWorks('unzip', ['-h'])) return { kind: 'unzip', command: 'unzip' };
  if (commandWorks('bsdtar', ['--version'])) return { kind: 'tar', command: 'bsdtar' };
  try {
    const version = execFileSync('tar', ['--version'], { encoding: 'utf8' });
    if (version.includes('bsdtar')) return { kind: 'tar', command: 'tar' };
  } catch {
    // fall through to the error below
  }
  throw new Error(
    `No zip-capable extractor found for ${path.basename(archivePath)}: install unzip or bsdtar (libarchive-tools)`,
  );
}

function listArchiveEntries(archivePath) {
  const tool = archiveTool(archivePath);
  const output =
    tool.kind === 'unzip'
      ? execFileSync(tool.command, ['-Z1', archivePath], { encoding: 'utf8' })
      : execArchiveTool(tool.command, archivePath, ['-tf', path.basename(archivePath)]);
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function assertNoLinkEntries(lib, archivePath) {
  const tool = archiveTool(archivePath);
  const output =
    tool.kind === 'unzip'
      ? execFileSync(tool.command, ['-Z', archivePath], { encoding: 'utf8' })
      : execArchiveTool(tool.command, archivePath, ['-tvf', path.basename(archivePath)]);
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
  const tool = archiveTool(archivePath);
  if (tool.kind === 'unzip') {
    execFileSync(tool.command, ['-o', '-q', archivePath, '-d', extractDir]);
  } else {
    execArchiveTool(tool.command, archivePath, [
      '-xf',
      path.basename(archivePath),
      '-C',
      path.relative(path.dirname(archivePath), extractDir) || '.',
    ]);
  }
}

/**
 * Source-build for macOS (no upstream prebuilt assets); requires Go. Clones
 * the pinned tag, verifies its commit matches TAILCAT_COMMIT (tags are
 * mutable — the pin is the integrity check the other platforms get from the
 * archive sha256s), then cross-builds for the requested os/arch
 * (CGO_ENABLED=0 keeps the build host-toolchain-independent).
 */
function buildFromSource(tmpDir, goos, goarch, binName) {
  try {
    execFileSync('go', ['version'], { encoding: 'utf8' });
  } catch {
    throw new Error(
      `tailcat has no prebuilt macOS assets and Go is not installed; install Go or set TAILCAT_SKIP=1 to package without tunnel support`,
    );
  }
  const srcDir = path.join(tmpDir, `src-${goos}-${goarch}`);
  execFileSync('git', [
    'clone',
    '--depth',
    '1',
    '--branch',
    `v${TAILCAT_VERSION}`,
    `https://github.com/${TAILCAT_REPO}`,
    srcDir,
  ]);
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: srcDir, encoding: 'utf8' }).trim();
  if (head !== TAILCAT_COMMIT) {
    throw new Error(
      `tailcat tag v${TAILCAT_VERSION} points at ${head}, expected pinned commit ${TAILCAT_COMMIT} — upstream tag moved; refusing to build`,
    );
  }
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
    { cwd: srcDir, env: { ...process.env, CGO_ENABLED: '0', GOOS: goos, GOARCH: goarch } },
  );
  return { binPath: path.join(srcDir, binName), licensePath: path.join(srcDir, 'LICENSE') };
}

function readStamp(stampFile) {
  try {
    return JSON.parse(fs.readFileSync(stampFile, 'utf8'));
  } catch {
    return null;
  }
}

/** Remove every staged file for a target dir (binary, license, stamp). */
function cleanTargetDir(targetDir) {
  for (const name of ['tailcat', 'tailcat.exe', 'tailcat.LICENSE', STAMP_NAME]) {
    fs.rmSync(path.join(targetDir, name), { force: true });
  }
}

async function stageTarget(lib, target, force) {
  const { platform, arch, dir } = target;
  const binName = binaryName(platform);
  const targetDir = path.join(DEST_DIR, dir);
  const destBin = path.join(targetDir, binName);
  const destLicense = path.join(targetDir, 'tailcat.LICENSE');
  const stampFile = path.join(targetDir, STAMP_NAME);
  fs.mkdirSync(targetDir, { recursive: true });

  const stamp = readStamp(stampFile);
  if (
    !force &&
    stamp?.version === TAILCAT_VERSION &&
    stamp?.platform === platform &&
    stamp?.arch === arch &&
    fs.existsSync(destBin) &&
    lib.sha256Hex(fs.readFileSync(destBin)) === stamp?.binSha256 &&
    fs.existsSync(destLicense)
  ) {
    console.log(
      `tailcat v${TAILCAT_VERSION} (${platform}-${arch}) already staged; skipping (--force to re-fetch)`,
    );
    return;
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tailcat-fetch-'));
  try {
    let binPath;
    let licensePath;
    if (platform === 'darwin') {
      ({ binPath, licensePath } = buildFromSource(
        tmpDir,
        'darwin',
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
        throw new Error(
          `Checksum mismatch for ${pin.asset}: expected ${pin.sha256}, got ${actual}`,
        );
      }
      const archivePath = path.join(tmpDir, pin.asset);
      fs.writeFileSync(archivePath, archive);
      extractArchive(lib, archivePath, tmpDir);
      binPath = path.join(tmpDir, binName);
      licensePath = path.join(tmpDir, 'LICENSE');
    }
    if (!fs.existsSync(binPath))
      throw new Error(`tailcat binary missing after staging: ${binPath}`);
    if (!fs.existsSync(licensePath))
      throw new Error(`tailcat LICENSE missing after staging: ${licensePath}`);
    // Clean first so a re-pin never leaves a stale sibling (e.g. a leftover
    // tailcat.exe next to a fresh tailcat after a target-vocabulary change).
    cleanTargetDir(targetDir);
    fs.copyFileSync(binPath, destBin);
    if (platform !== 'win32') fs.chmodSync(destBin, 0o755);
    fs.copyFileSync(licensePath, destLicense);
    fs.writeFileSync(
      stampFile,
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

async function main() {
  const force = process.argv.includes('--force');
  const targets = resolveTargets(process.argv, process.env);
  // Every per-target dir electron-builder's extraResources templates can
  // resolve to must exist even when not staged this run (missing `from`
  // directories fail the build); pre-create them all.
  const ALL_TARGET_DIRS = [
    'mac-x64',
    'mac-arm64',
    'win-x64',
    'win-arm64',
    'linux-x64',
    'linux-arm64',
  ];
  for (const dir of ALL_TARGET_DIRS) {
    fs.mkdirSync(path.join(DEST_DIR, dir), { recursive: true });
  }

  if (process.env.TAILCAT_SKIP === '1') {
    // Remove anything a previous run staged: a documented skip must reliably
    // produce a tunnel-free build, not silently package stale binaries.
    for (const dir of ALL_TARGET_DIRS) {
      cleanTargetDir(path.join(DEST_DIR, dir));
    }
    // Pre-per-target layout leftovers (binary staged directly in DEST_DIR).
    cleanTargetDir(DEST_DIR);
    console.log(
      'TAILCAT_SKIP=1 — skipping tailcat staging and removing previously staged binaries (packaged build ships without tunnel dialing)',
    );
    return;
  }

  const lib = await import(pathToFileURL(path.join(__dirname, 'fetch-sidecar-lib.mjs')).href);
  for (const target of targets) {
    await stageTarget(lib, target, force);
  }
}

main().catch((error) => {
  console.error(`fetch-tailcat failed: ${error.message}`);
  process.exit(1);
});
