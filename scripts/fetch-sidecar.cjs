#!/usr/bin/env node
/**
 * Download the pinned intentd release for the current platform/arch from
 * intent-hq/intentd GitHub Releases, verify its sha256, and stage the binary at
 * resources/sidecar/intentd[.exe] — the same staging location as copy-sidecar.cjs
 * (which remains the local-source-build path for dev).
 *
 * Pin: intentd.version at the repo root (see README "intentd sidecar pin").
 *
 * Env:
 *   INTENTD_READ_PAT / GH_TOKEN / GITHUB_TOKEN  auth token (required while the
 *                                               intentd repo is private)
 *   INTENTD_VERSION   override the pinned version
 *   INTENTD_TARGET    override the cargo-dist target triple (cross-staging)
 *   INTENTD_REPO      override the source repo (default intent-hq/intentd)
 *   INTENTD_APP_NAME  override the cargo-dist app/binary name (testing only)
 *
 * Flags: --force re-fetches even when the staged sidecar already matches the pin.
 *
 * Idempotent: a stamp file (resources/sidecar/.intentd-fetch-stamp.json) records what
 * was staged; matching version+target skips the download.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');

const FE_DIR = path.resolve(__dirname, '..');
const PIN_FILE = path.join(FE_DIR, 'intentd.version');
const DEST_DIR = path.join(FE_DIR, 'resources/sidecar');
const STAMP_FILE = path.join(DEST_DIR, '.intentd-fetch-stamp.json');
const REPO = process.env.INTENTD_REPO?.trim() || 'intent-hq/intentd';
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

function authToken() {
  for (const name of ['INTENTD_READ_PAT', 'GH_TOKEN', 'GITHUB_TOKEN']) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  return null;
}

async function githubGet(url, accept) {
  const headers = {
    accept,
    'user-agent': 'cloudlands-fe fetch-sidecar',
    'x-github-api-version': '2022-11-28',
  };
  const token = authToken();
  if (token) headers.authorization = `Bearer ${token}`;
  // Manual redirects: asset downloads redirect to storage hosts that reject the
  // GitHub Authorization header, so drop auth when following the redirect.
  let res = await fetch(url, { headers, redirect: 'manual' });
  for (let i = 0; REDIRECT_STATUSES.has(res.status) && i < 5; i++) {
    const location = res.headers.get('location');
    if (!location) break;
    res = await fetch(location, { headers: { accept: 'application/octet-stream' } });
  }
  return res;
}

async function downloadAsset(asset) {
  const res = await githubGet(asset.url, 'application/octet-stream');
  if (!res.ok) {
    throw new Error(`Failed to download asset ${asset.name}: HTTP ${res.status}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

function listArchiveEntries(archivePath) {
  const output =
    archivePath.endsWith('.zip') && process.platform !== 'win32'
      ? execFileSync('unzip', ['-Z1', archivePath], { encoding: 'utf8' })
      : execFileSync('tar', ['-tf', archivePath], { encoding: 'utf8' });
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function extractArchive(lib, archivePath, extractDir) {
  // Reject path-traversal (zip-slip/tar-slip) entries before extracting; the checksum
  // asset comes from the same release, so it is no defense against a malicious archive.
  const unsafe = listArchiveEntries(archivePath).filter((entry) => !lib.isSafeArchiveEntry(entry));
  if (unsafe.length > 0) {
    throw new Error(
      `Refusing to extract ${path.basename(archivePath)}: unsafe entry paths: ${unsafe.slice(0, 5).join(', ')}`,
    );
  }
  if (archivePath.endsWith('.zip') && process.platform !== 'win32') {
    execFileSync('unzip', ['-o', '-q', archivePath, '-d', extractDir]);
  } else {
    // System tar handles .tar.xz/.tar.gz everywhere; bsdtar on Windows also unpacks .zip.
    execFileSync('tar', ['-xf', archivePath, '-C', extractDir]);
  }
}

function findFile(dir, name) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isFile() && entry.name === name) return entryPath;
    if (entry.isDirectory()) {
      const found = findFile(entryPath, name);
      if (found) return found;
    }
  }
  return null;
}

async function main() {
  const lib = await import(pathToFileURL(path.join(__dirname, 'fetch-sidecar-lib.mjs')).href);
  const force = process.argv.includes('--force');

  const version =
    process.env.INTENTD_VERSION?.trim() || lib.parseVersionPin(fs.readFileSync(PIN_FILE, 'utf8'));
  const target =
    process.env.INTENTD_TARGET?.trim() || lib.resolveTarget(process.platform, process.arch);
  const appName = process.env.INTENTD_APP_NAME?.trim() || lib.INTENTD_APP_NAME;
  const binaryName = lib.sidecarBinaryName(target, appName);
  const destBin = path.join(DEST_DIR, binaryName);
  const tag = lib.releaseTag(version);

  if (!force && fs.existsSync(destBin)) {
    let stamp = null;
    try {
      stamp = JSON.parse(fs.readFileSync(STAMP_FILE, 'utf8'));
    } catch {
      // Missing or corrupted stamp (e.g. prior run killed mid-write): fall through and re-fetch.
    }
    if (stamp?.version === version && stamp?.target === target) {
      console.log(
        `intentd ${version} (${target}) already staged at ${destBin} — skipping (use --force to re-fetch)`,
      );
      return;
    }
  }

  console.log(`Fetching intentd ${tag} (${target}) from ${REPO}...`);
  const releaseRes = await githubGet(
    `https://api.github.com/repos/${REPO}/releases/tags/${tag}`,
    'application/vnd.github+json',
  );
  if (releaseRes.status === 404) {
    throw new Error(
      `Release ${tag} not found in ${REPO}. Check the intentd.version pin, and that a token with read access is set (INTENTD_READ_PAT/GH_TOKEN/GITHUB_TOKEN) while the repo is private.`,
    );
  }
  if (!releaseRes.ok) {
    throw new Error(`GitHub API error fetching release ${tag}: HTTP ${releaseRes.status}`);
  }
  const release = await releaseRes.json();
  const assetsByName = new Map(release.assets.map((a) => [a.name, a]));

  const candidates = lib.assetCandidates(target, appName);
  const assetName = candidates.find((name) => assetsByName.has(name));
  if (!assetName) {
    throw new Error(
      `No asset for ${target} in release ${tag} (tried: ${candidates.join(', ')}). Available assets: ${release.assets.map((a) => a.name).join(', ') || '(none)'}`,
    );
  }
  const checksumName = lib.checksumAssetName(assetName);
  const checksumAsset = assetsByName.get(checksumName);
  if (!checksumAsset) {
    throw new Error(
      `Checksum asset ${checksumName} not found in release ${tag}; refusing to stage unverified binary`,
    );
  }

  const [archive, checksumBuf] = await Promise.all([
    downloadAsset(assetsByName.get(assetName)),
    downloadAsset(checksumAsset),
  ]);
  const expected = lib.parseChecksumFile(checksumBuf.toString('utf8'), assetName);
  if (!expected) {
    throw new Error(`Could not parse expected sha256 for ${assetName} from ${checksumName}`);
  }
  const actual = lib.sha256Hex(archive);
  if (actual !== expected) {
    throw new Error(`sha256 mismatch for ${assetName}: expected ${expected}, got ${actual}`);
  }
  console.log(`sha256 verified: ${actual}`);

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'intentd-sidecar-'));
  try {
    const archivePath = path.join(tmpDir, assetName);
    fs.writeFileSync(archivePath, archive);
    const extractDir = path.join(tmpDir, 'extract');
    fs.mkdirSync(extractDir);
    extractArchive(lib, archivePath, extractDir);
    const extractedBin = findFile(extractDir, binaryName);
    if (!extractedBin) {
      throw new Error(`Binary ${binaryName} not found inside ${assetName}`);
    }
    fs.mkdirSync(DEST_DIR, { recursive: true });
    fs.copyFileSync(extractedBin, destBin);
    if (process.platform !== 'win32') fs.chmodSync(destBin, 0o755);
    fs.writeFileSync(
      STAMP_FILE,
      `${JSON.stringify({ version, target, asset: assetName, sha256: actual, fetchedAt: new Date().toISOString() }, null, 2)}\n`,
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  console.log(`Staged intentd ${version} (${target}) at ${destBin}`);
}

main().catch((err) => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
