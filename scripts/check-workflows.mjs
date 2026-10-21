import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Lints every workflow under .github/workflows with actionlint, including the
// shellcheck pass over `run:` scripts. Workflow YAML and its embedded shell are
// runtime text that no type or contract can pin, so before this gate shell
// mistakes in release automation surfaced only in review or in live runs (an
// unseen SC2016 in auto-cut-alpha.yml, found while building cloudlands-fe#3549).
// Ignores live in .github/actionlint.yaml, scoped by path and message.
//
// actionlint is pinned: a PATH binary is used only at exactly this version,
// otherwise the release archive is downloaded once into node_modules/.cache and
// verified against the checksums below (from actionlint_<v>_checksums.txt).
// `make bootstrap-dev-host` in the monorepo installs the same pin.
export const ACTIONLINT_VERSION = '1.7.12';
export const ACTIONLINT_SHA256 = Object.freeze({
  'darwin-amd64': '5b44c3bc2255115c9b69e30efc0fecdf498fdb63c5d58e17084fd5f16324c644',
  'darwin-arm64': 'aba9ced2dee8d27fecca3dc7feb1a7f9a52caefa1eb46f3271ea66b6e0e6953f',
  'linux-amd64': '8aca8db96f1b94770f1b0d72b6dddcb1ebb8123cb3712530b08cc387b349a3d8',
  'linux-arm64': '325e971b6ba9bfa504672e29be93c24981eeb1c07576d730e9f7c8805afff0c6',
});
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_CACHE_DIR = path.join(REPO_ROOT, 'node_modules', '.cache', 'actionlint');

export function platformKey(platform = process.platform, arch = process.arch) {
  const goos = { linux: 'linux', darwin: 'darwin' }[platform];
  const goarch = { x64: 'amd64', arm64: 'arm64' }[arch];
  const key = goos && goarch ? `${goos}-${goarch}` : null;
  if (!key || !(key in ACTIONLINT_SHA256)) {
    throw new Error(
      `actionlint ${ACTIONLINT_VERSION}: no pinned release for ${platform}/${arch}; ` +
        'install it manually and put it on PATH',
    );
  }
  return key;
}

export function archiveName(key) {
  return `actionlint_${ACTIONLINT_VERSION}_${key.replace('-', '_')}.tar.gz`;
}

export function verifyChecksum(buffer, expected, label) {
  const actual = createHash('sha256').update(buffer).digest('hex');
  if (actual !== expected) {
    throw new Error(`${label}: SHA-256 mismatch (expected ${expected}, got ${actual})`);
  }
}

// The first line of `actionlint --version` is the version: bare for release
// archives, v-prefixed for a `go install ...@vX.Y.Z` build. Null when the
// binary is missing or cannot run.
export function binaryVersion(command) {
  const result = spawnSync(command, ['--version'], { encoding: 'utf8' });
  if (result.error || result.status !== 0) return null;
  return result.stdout.split('\n')[0].trim().replace(/^v/, '') || null;
}

// Writes the verified archive's binary to `<cacheDir>/<version>/actionlint`
// through a temp dir + rename, so a concurrent or interrupted run never leaves
// a partial binary behind.
export function installFromArchive(buffer, { key, cacheDir }) {
  verifyChecksum(buffer, ACTIONLINT_SHA256[key], archiveName(key));
  const target = path.join(cacheDir, ACTIONLINT_VERSION, 'actionlint');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const staging = fs.mkdtempSync(path.join(path.dirname(target), '.staging-'));
  try {
    const archive = path.join(staging, archiveName(key));
    fs.writeFileSync(archive, buffer);
    const tar = spawnSync('tar', ['-xzf', archive, '-C', staging, 'actionlint'], {
      encoding: 'utf8',
    });
    if (tar.error || tar.status !== 0) {
      throw new Error(`extracting ${archiveName(key)} failed: ${tar.error ?? tar.stderr}`);
    }
    fs.chmodSync(path.join(staging, 'actionlint'), 0o755);
    fs.renameSync(path.join(staging, 'actionlint'), target);
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
  return target;
}

const DOWNLOAD_TIMEOUT_MS = 120_000;

async function download(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`downloading ${url} failed: HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

export async function resolveActionlint({
  cacheDir = DEFAULT_CACHE_DIR,
  fetchArchive = download,
} = {}) {
  if (binaryVersion('actionlint') === ACTIONLINT_VERSION) return 'actionlint';
  const cached = path.join(cacheDir, ACTIONLINT_VERSION, 'actionlint');
  if (binaryVersion(cached) === ACTIONLINT_VERSION) return cached;
  const key = platformKey();
  const url = `https://github.com/rhysd/actionlint/releases/download/v${ACTIONLINT_VERSION}/${archiveName(key)}`;
  const installed = installFromArchive(await fetchArchive(url), { key, cacheDir });
  if (binaryVersion(installed) !== ACTIONLINT_VERSION) {
    throw new Error(`${installed} does not report version ${ACTIONLINT_VERSION}`);
  }
  return installed;
}

// actionlint silently skips its shell pass when shellcheck is absent, which
// would turn this gate green while checking nothing, so a missing shellcheck
// is an error rather than a skip.
export function resolveShellcheck(command = process.env.ACTIONLINT_SHELLCHECK || 'shellcheck') {
  const result = spawnSync(command, ['--version'], { encoding: 'utf8' });
  if (result.error || result.status !== 0) {
    throw new Error(
      `shellcheck (${command}) is missing or cannot run; actionlint would skip every run: ` +
        'script. Install shellcheck (make bootstrap-dev-host in the monorepo) and retry.',
    );
  }
  return command;
}

// Exit status 0 is clean, 1 is findings; other statuses or a signal are errors. pyflakes is
// disabled so results do not depend on whether a host has it.
export function runActionlint({ actionlint, shellcheck, cwd = REPO_ROOT, stdio = 'inherit' }) {
  const result = spawnSync(actionlint, ['-shellcheck', shellcheck, '-pyflakes=', '-no-color'], {
    cwd,
    stdio,
    encoding: 'utf8',
  });
  if (result.error) throw result.error;
  return { status: result.status, signal: result.signal, stdout: result.stdout ?? '' };
}

export async function main({ cwd = REPO_ROOT, cacheDir } = {}) {
  let shellcheck;
  let actionlint;
  try {
    shellcheck = resolveShellcheck();
    actionlint = await resolveActionlint({ cacheDir });
  } catch (error) {
    console.error(`workflow lint: ${error.message}`);
    return 2;
  }
  const { status, signal } = runActionlint({ actionlint, shellcheck, cwd });
  if (signal || (status !== 0 && status !== 1)) {
    console.error(`workflow lint: actionlint exited abnormally (${signal ?? `status ${status}`}).`);
    return 2;
  }
  if (status === 0) {
    console.log(`workflow lint passed: actionlint ${ACTIONLINT_VERSION} with shellcheck.`);
  } else {
    console.error(
      'workflow lint failed: fix the findings above, or add a path-scoped ignore with its ' +
        'reason to .github/actionlint.yaml.',
    );
  }
  return status;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  process.exitCode = await main({ cacheDir: process.env.ACTIONLINT_CACHE_DIR || undefined });
}
