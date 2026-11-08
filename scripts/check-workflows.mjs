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

// Per attempt; the archive is about 2.3 MB. Short enough that a stalled host
// reaches the API fallback within a few minutes.
const DOWNLOAD_TIMEOUT_MS = 30_000;
// Delays between attempts, in milliseconds: four attempts per source in all,
// matching scripts/download_retry.py.
export const RETRY_DELAYS_MS = Object.freeze([2_000, 5_000, 15_000]);
const RELEASE_REPO = 'rhysd/actionlint';
const ATTEMPTS = RETRY_DELAYS_MS.length + 1;
// Upper bound on fetchReleaseAsset when every attempt stalls to its timeout:
// three retried fetches (direct download, release lookup, API asset), each
// ATTEMPTS timeouts plus the backoff between them. Callers that wrap the
// download in their own deadline (the unit tests) derive it from this.
export const DOWNLOAD_WORST_CASE_MS =
  3 * (ATTEMPTS * DOWNLOAD_TIMEOUT_MS + RETRY_DELAYS_MS.reduce((sum, ms) => sum + ms, 0));

// A failed download. `transient` is true when every attempt failed with a 5xx,
// a network error or a timeout, i.e. when GitHub (not the pin) is at fault.
export class DownloadError extends Error {
  constructor(message, { transient }) {
    super(message);
    this.name = 'DownloadError';
    this.transient = transient;
  }
}

// 5xx, 408 and 429 are transient. GitHub also answers an exhausted rate limit
// with 403 plus `x-ratelimit-remaining: 0` or `retry-after`; any other 4xx
// (a wrong version, asset name or token) is permanent.
export function transientStatus(response) {
  const { status, headers } = response;
  if (status >= 500 || status === 408 || status === 429) return true;
  return (
    status === 403 &&
    (headers.get('x-ratelimit-remaining') === '0' || headers.get('retry-after') !== null)
  );
}

async function fetchOnce(url, { headers, fetchImpl }) {
  let response;
  try {
    response = await fetchImpl(url, { headers, signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
  } catch (error) {
    throw new DownloadError(
      `downloading ${url} failed: ${error.cause?.code ?? error.cause?.message ?? error.message}`,
      {
        transient: true,
      },
    );
  }
  if (!response.ok) {
    throw new DownloadError(`downloading ${url} failed: HTTP ${response.status}`, {
      transient: transientStatus(response),
    });
  }
  try {
    return Buffer.from(await response.arrayBuffer());
  } catch (error) {
    throw new DownloadError(`reading ${url} failed: ${error.message}`, { transient: true });
  }
}

// One fetch with bounded retries on transient failures only: a 4xx (a wrong
// version or asset name) fails at once. A single GitHub 504 on a release
// download ejected merge-queue PRs (cloudlands-fe runs 42464028655, 42464205010).
export async function fetchWithRetry(
  url,
  {
    headers = {},
    delays = RETRY_DELAYS_MS,
    sleep = defaultSleep,
    fetchImpl = fetch,
    log = console.warn,
  } = {},
) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await fetchOnce(url, { headers, fetchImpl });
    } catch (error) {
      const delay = delays[attempt - 1];
      if (!error.transient || delay === undefined) throw error;
      log(`workflow lint: ${error.message} (attempt ${attempt}); retrying in ${delay / 1000}s`);
      await sleep(delay);
    }
  }
}

function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Downloads a release asset from its browser_download_url and, when that keeps
// failing, from the REST API asset endpoint. GitHub has served 504 for single
// release assets for over half an hour while the API endpoint for the same
// asset returned 200 (2026-11-08). The archive is still checksum-verified by
// installFromArchive, so the fallback source cannot weaken the pin. A token
// (GITHUB_TOKEN or GH_TOKEN) is sent only to the API, and only for its rate
// limit: the release is public.
export async function fetchReleaseAsset(
  name,
  {
    tag = `v${ACTIONLINT_VERSION}`,
    repo = RELEASE_REPO,
    downloadBase = 'https://github.com',
    apiBase = 'https://api.github.com',
    token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN,
    ...retry
  } = {},
) {
  const direct = `${downloadBase}/${repo}/releases/download/${tag}/${name}`;
  let primaryError;
  try {
    return await fetchWithRetry(direct, retry);
  } catch (error) {
    primaryError = error;
  }
  (retry.log ?? console.warn)(
    `workflow lint: ${primaryError.message}; falling back to the GitHub API asset endpoint`,
  );
  const auth = token ? { Authorization: `Bearer ${token}` } : {};
  try {
    const release = JSON.parse(
      (
        await fetchWithRetry(`${apiBase}/repos/${repo}/releases/tags/${tag}`, {
          ...retry,
          headers: { Accept: 'application/vnd.github+json', ...auth },
        })
      ).toString('utf8'),
    );
    const asset = release.assets?.find((candidate) => candidate.name === name);
    if (!asset) {
      throw new DownloadError(`release ${repo}@${tag} has no asset ${name}`, { transient: false });
    }
    return await fetchWithRetry(`${apiBase}/repos/${repo}/releases/assets/${asset.id}`, {
      ...retry,
      headers: { Accept: 'application/octet-stream', ...auth },
    });
  } catch (error) {
    throw new DownloadError(`${primaryError.message}; API fallback: ${error.message}`, {
      transient: Boolean(primaryError.transient && error.transient),
    });
  }
}

export async function resolveActionlint({
  cacheDir = DEFAULT_CACHE_DIR,
  fetchArchive = fetchReleaseAsset,
} = {}) {
  if (binaryVersion('actionlint') === ACTIONLINT_VERSION) return 'actionlint';
  const cached = path.join(cacheDir, ACTIONLINT_VERSION, 'actionlint');
  if (binaryVersion(cached) === ACTIONLINT_VERSION) return cached;
  const key = platformKey();
  const installed = installFromArchive(await fetchArchive(archiveName(key)), { key, cacheDir });
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

// actionlint <= 1.7.12 writes each run: script to shellcheck's stdin before it
// starts shellcheck, so a script larger than the pipe buffer blocks forever at
// 0% CPU. Linux shrinks new pipes to one page once a user holds more than
// fs.pipe-user-pages-soft pages, so a busy host hangs this gate silently
// (rhysd/actionlint#702, fixed on main by #651 but not yet released). The lint
// takes about a second, so a deadline turns that hang into a readable failure.
export const ACTIONLINT_TIMEOUT_MS = 60_000;

export class ActionlintTimeoutError extends Error {
  constructor(timeoutMs) {
    super(
      `actionlint did not finish within ${Math.ceil(timeoutMs / 1000)} s and was stopped. ` +
        `This is most likely the actionlint ${ACTIONLINT_VERSION} shellcheck deadlock ` +
        '(https://github.com/rhysd/actionlint/issues/702): when your user holds many pipes, new ' +
        'pipes shrink and actionlint blocks writing a large run: script to shellcheck. Stop idle ' +
        'long-running processes (dev servers, test watchers) and rerun: pnpm run lint:workflows',
    );
    this.name = 'ActionlintTimeoutError';
  }
}

// Exit status 0 is clean, 1 is findings; other statuses or a signal are errors. pyflakes is
// disabled so results do not depend on whether a host has it.
export function runActionlint({
  actionlint,
  shellcheck,
  cwd = REPO_ROOT,
  stdio = 'inherit',
  timeoutMs = ACTIONLINT_TIMEOUT_MS,
}) {
  const result = spawnSync(actionlint, ['-shellcheck', shellcheck, '-pyflakes=', '-no-color'], {
    cwd,
    stdio,
    encoding: 'utf8',
    timeout: timeoutMs,
    killSignal: 'SIGKILL',
  });
  if (result.error?.code === 'ETIMEDOUT') throw new ActionlintTimeoutError(timeoutMs);
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
  let status;
  let signal;
  try {
    ({ status, signal } = runActionlint({ actionlint, shellcheck, cwd }));
  } catch (error) {
    console.error(`workflow lint: ${error.message}`);
    return 2;
  }
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
