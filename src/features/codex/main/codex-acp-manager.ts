import { createHash, randomUUID } from 'crypto';
import { app } from 'electron';
import * as fsSync from 'fs';
import { promises as fs } from 'fs';
import * as https from 'https';
import { createRequire } from 'module';
import * as path from 'path';
import { pipeline } from 'stream/promises';
import { hostExec } from '../../../shared/main/host-exec';

export const MANAGED_CODEX_ACP_VERSION = '1.1.7';

/**
 * Env overrides for every managed codex-acp spawn (#544). The published
 * adapter honors `CODEX_PATH` (binary to spawn) and `CODEX_CONFIG` (config
 * JSON); inheriting them from the user's environment would silently redirect
 * the managed runtime away from the sha512- and codesign-verified vendored
 * binary. The daemon's `host.exec` merges env on top of its own process env,
 * so the keys cannot be removed — they are pinned to empty strings, which the
 * adapter treats as unset. Unmanaged (PATH / npx) spawns deliberately keep the
 * variables as a user escape hatch.
 */
export const MANAGED_CODEX_ACP_ENV_OVERRIDES: Record<string, string> = {
  CODEX_PATH: '',
  CODEX_CONFIG: '',
};

// The vendored native codex CLI is signed by OpenAI OpCo, LLC.
const CODEX_APPLE_TEAM_ID = '2DC432GLL2';
const DOWNLOAD_TIMEOUT_MS = 60_000;
const SPAWN_TIMEOUT_MS = 30_000;

type ManagedCodexAcpPackage = {
  packageName: string;
  tarballUrl: string;
  integrity: string;
};

type SupportedPlatformKey = 'darwin-arm64' | 'darwin-x64' | 'linux-x64' | 'win32-x64';

const ENTRY_PACKAGE_NAME = '@agentclientprotocol/codex-acp';

/**
 * Vendor directory target triples inside the per-platform `@openai/codex-*`
 * packages (mirrors `PLATFORM_PACKAGE_BY_TARGET` in `@openai/codex/bin/codex.js`).
 */
const CODEX_VENDOR_TARGET_TRIPLES: Record<SupportedPlatformKey, string> = {
  'darwin-arm64': 'aarch64-apple-darwin',
  'darwin-x64': 'x86_64-apple-darwin',
  'linux-x64': 'x86_64-unknown-linux-musl',
  'win32-x64': 'x86_64-pc-windows-msvc',
};

/**
 * Pinned flat dependency closure of `@agentclientprotocol/codex-acp@1.1.7`
 * (resolved from the npm registry on 2026-07-23). The successor package is
 * pure Node but has runtime npm dependencies, so the whole closure is staged
 * into a flat `node_modules` — unpacking the top-level tarball alone would
 * not be runnable. `packages` are platform-independent; `platforms` holds the
 * per-platform `@openai/codex` optional dependency vendoring the native codex
 * CLI that the adapter spawns.
 */
export const MANAGED_CODEX_ACP_INTEGRITY: {
  packages: ManagedCodexAcpPackage[];
  platforms: Record<SupportedPlatformKey, ManagedCodexAcpPackage>;
} = {
  packages: [
    {
      packageName: '@agentclientprotocol/codex-acp',
      tarballUrl: `https://registry.npmjs.org/@agentclientprotocol/codex-acp/-/codex-acp-${MANAGED_CODEX_ACP_VERSION}.tgz`,
      integrity:
        'sha512-bhFLbGtOMEw6+PAp33vNERb6dXlULOfV3mWbRdps4v7sY7PHha/C2T1dnlG0yVcvBu9W+NYPzL0CAupnVoFTiQ==',
    },
    {
      packageName: '@agentclientprotocol/sdk',
      tarballUrl: 'https://registry.npmjs.org/@agentclientprotocol/sdk/-/sdk-1.3.0.tgz',
      integrity:
        'sha512-i3h/efaeuMUFAO1HSfo97QZQnnvMd7wWBYtBsdL6UMZg3a78sk3Ffya5Xu7C7tYsXomXoDXJBAzQF2PcFKAhIQ==',
    },
    {
      packageName: '@openai/codex',
      tarballUrl: 'https://registry.npmjs.org/@openai/codex/-/codex-0.145.0.tgz',
      integrity:
        'sha512-/PSPSFujjjmiyVFvG2yu/grOFhsWdokTH8t2KGWhXSo/M5n/dIDsnbsnO82/7bLtIoDuzQf7ATBUMWqPWQINlQ==',
    },
    {
      packageName: 'bundle-name',
      tarballUrl: 'https://registry.npmjs.org/bundle-name/-/bundle-name-4.1.0.tgz',
      integrity:
        'sha512-tjwM5exMg6BGRI+kNmTntNsvdZS1X8BFYS6tnJ2hdH0kVxM6/eVZ2xy+FqStSWvYmtfFMDLIxurorHwDKfDz5Q==',
    },
    {
      packageName: 'default-browser',
      tarballUrl: 'https://registry.npmjs.org/default-browser/-/default-browser-5.5.0.tgz',
      integrity:
        'sha512-H9LMLr5zwIbSxrmvikGuI/5KGhZ8E2zH3stkMgM5LpOWDutGM2JZaj460Udnf1a+946zc7YBgrqEWwbk7zHvGw==',
    },
    {
      packageName: 'default-browser-id',
      tarballUrl: 'https://registry.npmjs.org/default-browser-id/-/default-browser-id-5.0.1.tgz',
      integrity:
        'sha512-x1VCxdX4t+8wVfd1so/9w+vQ4vx7lKd2Qp5tDRutErwmR85OgmfX7RlLRMWafRMY7hbEiXIbudNrjOAPa/hL8Q==',
    },
    {
      packageName: 'define-lazy-prop',
      tarballUrl: 'https://registry.npmjs.org/define-lazy-prop/-/define-lazy-prop-3.0.0.tgz',
      integrity:
        'sha512-N+MeXYoqr3pOgn8xfyRPREN7gHakLYjhsHhWGT3fWAiL4IkAt0iDw14QiiEm2bE30c5XX5q0FtAA3CK5f9/BUg==',
    },
    {
      packageName: 'diff',
      tarballUrl: 'https://registry.npmjs.org/diff/-/diff-9.0.0.tgz',
      integrity:
        'sha512-svtcdpS8CgJyqAjEQIXdb3OjhFVVYjzGAPO8WGCmRbrml64SPw/jJD4GoE98aR7r25A0XcgrK3F02yw9R/vhQw==',
    },
    {
      packageName: 'is-docker',
      tarballUrl: 'https://registry.npmjs.org/is-docker/-/is-docker-3.0.0.tgz',
      integrity:
        'sha512-eljcgEDlEns/7AXFosB5K/2nCM4P7FQPkGc/DWLy5rmFEWvZayGrik1d9/QIY5nJ4f9YsVvBkA6kJpHn9rISdQ==',
    },
    {
      packageName: 'is-in-ssh',
      tarballUrl: 'https://registry.npmjs.org/is-in-ssh/-/is-in-ssh-1.0.0.tgz',
      integrity:
        'sha512-jYa6Q9rH90kR1vKB6NM7qqd1mge3Fx4Dhw5TVlK1MUBqhEOuCagrEHMevNuCcbECmXZ0ThXkRm+Ymr51HwEPAw==',
    },
    {
      packageName: 'is-inside-container',
      tarballUrl: 'https://registry.npmjs.org/is-inside-container/-/is-inside-container-1.0.0.tgz',
      integrity:
        'sha512-KIYLCCJghfHZxqjYBE7rEy0OBuTd5xCHS7tHVgvCLkx7StIoaxwNW3hCALgEUjFfeRk+MG/Qxmp/vtETEF3tRA==',
    },
    {
      packageName: 'is-wsl',
      tarballUrl: 'https://registry.npmjs.org/is-wsl/-/is-wsl-3.1.1.tgz',
      integrity:
        'sha512-e6rvdUCiQCAuumZslxRJWR/Doq4VpPR82kqclvcS0efgt430SlGIk05vdCN58+VrzgtIcfNODjozVielycD4Sw==',
    },
    {
      packageName: 'open',
      tarballUrl: 'https://registry.npmjs.org/open/-/open-11.0.0.tgz',
      integrity:
        'sha512-smsWv2LzFjP03xmvFoJ331ss6h+jixfA4UUV/Bsiyuu4YJPfN+FIQGOIiv4w9/+MoHkfkJ22UIaQWRVFRfH6Vw==',
    },
    {
      packageName: 'powershell-utils',
      tarballUrl: 'https://registry.npmjs.org/powershell-utils/-/powershell-utils-0.1.0.tgz',
      integrity:
        'sha512-dM0jVuXJPsDN6DvRpea484tCUaMiXWjuCn++HGTqUWzGDjv5tZkEZldAJ/UMlqRYGFrD/etByo4/xOuC/snX2A==',
    },
    {
      packageName: 'run-applescript',
      tarballUrl: 'https://registry.npmjs.org/run-applescript/-/run-applescript-7.1.0.tgz',
      integrity:
        'sha512-DPe5pVFaAsinSaV6QjQ6gdiedWDcRCbUuiQfQa2wmWV7+xC9bGulGI8+TdRmoFkAPaBXk8CrAbnlY2ISniJ47Q==',
    },
    {
      packageName: 'vscode-jsonrpc',
      tarballUrl: 'https://registry.npmjs.org/vscode-jsonrpc/-/vscode-jsonrpc-9.0.1.tgz',
      integrity:
        'sha512-rfuA6T75H6m5EkbhtEPzre9pT0HPcDI2MMy4+nPFIBks5J8JBAUHD4tRYSgaBOijIEC7SRkC1kKyXTLqbmh9jw==',
    },
    {
      packageName: 'wsl-utils',
      tarballUrl: 'https://registry.npmjs.org/wsl-utils/-/wsl-utils-0.3.1.tgz',
      integrity:
        'sha512-g/eziiSUNBSsdDJtCLB8bdYEUMj4jR7AGeUo96p/3dTafgjHhpF4RiCFPiRILwjQoDXx5MqkBr4fwWtR3Ky4Wg==',
    },
    {
      packageName: 'zod',
      tarballUrl: 'https://registry.npmjs.org/zod/-/zod-4.4.3.tgz',
      integrity:
        'sha512-ytENFjIJFl2UwYglde2jchW2Hwm4GJFLDiSXWdTrJQBIN9Fcyp7n4DhxJEiWNAJMV1/BqWfW/kkg71UDcHJyTQ==',
    },
  ],
  platforms: {
    'darwin-arm64': {
      packageName: '@openai/codex-darwin-arm64',
      tarballUrl: 'https://registry.npmjs.org/@openai/codex/-/codex-0.145.0-darwin-arm64.tgz',
      integrity:
        'sha512-h6aQ0UxnaP8mIM/9/qPAH9MNkRliJo88toq1T36IxNM2L5JSU0TFamu+MZn7YkFgDsrp0RfiI+97Tm8AVVxqtA==',
    },
    'darwin-x64': {
      packageName: '@openai/codex-darwin-x64',
      tarballUrl: 'https://registry.npmjs.org/@openai/codex/-/codex-0.145.0-darwin-x64.tgz',
      integrity:
        'sha512-FCYzVKCa9VoLtg9gVyzKpqylonfgZrfcWZN6HsXAZPeuo8CukdMqdgTUOhDn2V6h3MbqS0z6VqQVKUllN/yKhA==',
    },
    'linux-x64': {
      packageName: '@openai/codex-linux-x64',
      tarballUrl: 'https://registry.npmjs.org/@openai/codex/-/codex-0.145.0-linux-x64.tgz',
      integrity:
        'sha512-u8w8LLv3DvsfrDCoswLIemZ0SoNEXyi511WsfFsSiYUazk9qMsB/NtU8N9vhAfN7mZAxLFoMex4v66JjHuZWwA==',
    },
    'win32-x64': {
      packageName: '@openai/codex-win32-x64',
      tarballUrl: 'https://registry.npmjs.org/@openai/codex/-/codex-0.145.0-win32-x64.tgz',
      integrity:
        'sha512-u0h9lk094CaXRSqE34SBW2dRaQTPa6fASXqehczWH9QdsU62mBsiAgAdp6tCG4i+YzPmmhjD8FdXNnYGNmwuMg==',
    },
  },
};

export type ManagedCodexAcpStatus = {
  state: 'not_installed' | 'installing' | 'ready' | 'error' | 'unsupported';
  version: string;
  wrapperPath?: string;
  error?: string;
};

type ManagedCodexAcpResult = { wrapperPath: string; version: string };
type PlatformLike = NodeJS.Platform;
type ArchLike = NodeJS.Architecture;
type TarModule = { x(options: { file: string; cwd: string; strip: number }): Promise<void> };
type SpawnResult = { stdout: string; stderr: string };

type TestOverrides = {
  platform?: PlatformLike;
  arch?: ArchLike;
  manifest?: typeof MANAGED_CODEX_ACP_INTEGRITY;
  version?: string;
};

let inFlightInstall: Promise<ManagedCodexAcpResult> | null = null;
let testOverrides: TestOverrides | null = null;
let lastStatus: ManagedCodexAcpStatus = {
  state: 'not_installed',
  version: MANAGED_CODEX_ACP_VERSION,
};

const require = createRequire(import.meta.url);

function getTar(): TarModule {
  return require('tar') as TarModule;
}

function getVersion(): string {
  return testOverrides?.version ?? MANAGED_CODEX_ACP_VERSION;
}

function getManifest(): typeof MANAGED_CODEX_ACP_INTEGRITY {
  return testOverrides?.manifest ?? MANAGED_CODEX_ACP_INTEGRITY;
}

function getPlatform(): PlatformLike {
  return testOverrides?.platform ?? process.platform;
}

function getArch(): ArchLike {
  return testOverrides?.arch ?? process.arch;
}

function platformKey(): SupportedPlatformKey {
  return `${getPlatform()}-${getArch()}` as SupportedPlatformKey;
}

function getPlatformPackage(): ManagedCodexAcpPackage {
  const key = platformKey();
  const pkg = getManifest().platforms[key];
  if (!pkg) {
    throw new Error(
      // i18n-ignore (internal platform diagnostic, logged not rendered)
      `Unsupported platform/arch for managed codex-acp: ${getPlatform()}/${getArch()}`,
    );
  }
  return pkg;
}

function packageInstallPath(versionDir: string, packageName: string): string {
  const segments = packageName.split('/');
  const expectedSegments = packageName.startsWith('@') ? 2 : 1;
  if (
    segments.length !== expectedSegments ||
    segments.some((segment) => !segment || segment === '.' || segment === '..')
  ) {
    throw new Error(`Unexpected package name: ${packageName}`);
  }
  return path.join(versionDir, 'node_modules', ...segments);
}

function getRuntimePaths(): {
  baseDir: string;
  versionDir: string;
  wrapperPath: string;
  nativeBinaryPath: string;
} {
  const version = getVersion();
  const platformPackage = getPlatformPackage();
  const baseDir = path.join(app.getPath('userData'), 'runtimes', 'codex-acp');
  const versionDir = path.join(baseDir, version);
  const { wrapperPath, nativeBinaryPath } = getPathsForVersion(
    versionDir,
    platformPackage.packageName,
  );
  return { baseDir, versionDir, wrapperPath, nativeBinaryPath };
}

function hasCompleteCurrentInstall(): boolean {
  try {
    const { wrapperPath, nativeBinaryPath } = getRuntimePaths();
    return fsSync.existsSync(wrapperPath) && fsSync.existsSync(nativeBinaryPath);
  } catch {
    return false;
  }
}

export function getManagedCodexAcpStatus(): ManagedCodexAcpStatus {
  const version = getVersion();
  try {
    const { wrapperPath } = getRuntimePaths();
    if (inFlightInstall) return { state: 'installing', version };
    if (lastStatus.state === 'error') return { ...lastStatus, version };
    if (hasCompleteCurrentInstall()) return { state: 'ready', version, wrapperPath };
    return { state: 'not_installed', version };
  } catch (error) {
    return { state: 'unsupported', version, error: (error as Error).message };
  }
}

export function ensureManagedCodexAcp(): Promise<ManagedCodexAcpResult> {
  if (inFlightInstall) return inFlightInstall;
  inFlightInstall = installManagedCodexAcp().finally(() => {
    inFlightInstall = null;
  });
  return inFlightInstall;
}

async function installManagedCodexAcp(): Promise<ManagedCodexAcpResult> {
  const version = getVersion();
  const manifest = getManifest();
  const platformPackage = getPlatformPackage();
  const paths = getRuntimePaths();
  lastStatus = { state: 'installing', version };

  try {
    await fs.mkdir(paths.baseDir, { recursive: true });
    await cleanupTempDirs(paths.baseDir);

    if (hasCompleteCurrentInstall()) {
      lastStatus = { state: 'ready', version, wrapperPath: paths.wrapperPath };
      return { wrapperPath: paths.wrapperPath, version };
    }

    await fs.rm(paths.versionDir, { recursive: true, force: true });

    const stageDir = path.join(
      paths.baseDir,
      `.tmp-${version}-${process.pid}-${Date.now()}-${randomUUID()}`,
    );
    const installDir = path.join(stageDir, 'install');

    try {
      await fs.mkdir(stageDir, { recursive: true });
      const packagesToInstall = [...manifest.packages, platformPackage];
      for (const [index, pkg] of packagesToInstall.entries()) {
        const tarballPath = path.join(stageDir, `pkg-${index}.tgz`);
        await downloadAndVerify(pkg, tarballPath);
        await extractPackageTarball(tarballPath, packageInstallPath(installDir, pkg.packageName));
      }
      await chmodInstalledBins(installDir, platformPackage.packageName);

      const installPaths = getPathsForVersion(installDir, platformPackage.packageName);
      await fs.access(installPaths.nativeBinaryPath);
      if (getPlatform() === 'darwin') {
        await verifyMacCodeSignature(installPaths.nativeBinaryPath);
      }
      await validateWrapper(installPaths.wrapperPath);

      await fs.rename(installDir, paths.versionDir);
      await fs.rm(stageDir, { recursive: true, force: true });
    } catch (error) {
      await fs.rm(stageDir, { recursive: true, force: true });
      throw error;
    }

    await pruneOldManagedVersions(paths.baseDir, version);
    lastStatus = { state: 'ready', version, wrapperPath: paths.wrapperPath };
    return { wrapperPath: paths.wrapperPath, version };
  } catch (error) {
    lastStatus = { state: 'error', version, error: (error as Error).message };
    throw error;
  }
}

function getPathsForVersion(versionDir: string, nativePackageName: string) {
  const targetTriple = CODEX_VENDOR_TARGET_TRIPLES[platformKey()];
  if (!targetTriple) {
    throw new Error(`No codex vendor target triple for platform: ${platformKey()}`);
  }
  const nativeBinaryName = getPlatform() === 'win32' ? 'codex.exe' : 'codex';
  return {
    wrapperPath: path.join(packageInstallPath(versionDir, ENTRY_PACKAGE_NAME), 'dist', 'index.js'),
    nativeBinaryPath: path.join(
      packageInstallPath(versionDir, nativePackageName),
      'vendor',
      targetTriple,
      'bin',
      nativeBinaryName,
    ),
  };
}

async function cleanupTempDirs(baseDir: string): Promise<void> {
  const entries = await fs.readdir(baseDir, { withFileTypes: true }).catch(() => []);
  await Promise.all(
    entries
      .filter((entry) => entry.isDirectory() && entry.name.startsWith('.tmp-'))
      .map((entry) => fs.rm(path.join(baseDir, entry.name), { recursive: true, force: true })),
  );
}

async function downloadAndVerify(
  pkg: ManagedCodexAcpPackage,
  destinationPath: string,
): Promise<void> {
  await downloadToFile(pkg.tarballUrl, destinationPath);
  await verifyIntegrity(destinationPath, pkg.integrity, pkg.packageName);
}

async function downloadToFile(url: string, destinationPath: string, redirects = 0): Promise<void> {
  if (redirects > 5) throw new Error(`Too many redirects while downloading ${url}`);

  await new Promise<void>((resolve, reject) => {
    const request = https.get(url, (response) => {
      const statusCode = response.statusCode ?? 0;
      if (statusCode >= 300 && statusCode < 400 && response.headers.location) {
        response.resume();
        const redirectUrl = new URL(response.headers.location, url).toString();
        downloadToFile(redirectUrl, destinationPath, redirects + 1).then(resolve, reject);
        return;
      }

      if (statusCode !== 200) {
        response.resume();
        reject(new Error(`Download failed for ${url} with status ${statusCode}`));
        return;
      }

      pipeline(response, fsSync.createWriteStream(destinationPath)).then(resolve, reject);
    });

    request.setTimeout(DOWNLOAD_TIMEOUT_MS, () => {
      request.destroy(new Error(`Download timed out after ${DOWNLOAD_TIMEOUT_MS}ms: ${url}`));
    });
    request.on('error', reject);
  });
}

async function verifyIntegrity(
  filePath: string,
  expectedIntegrity: string,
  packageName: string,
): Promise<void> {
  const [algorithm, expectedDigest] = expectedIntegrity.split('-');
  if (algorithm !== 'sha512' || !expectedDigest) {
    throw new Error(`Unsupported integrity format for ${packageName}: ${expectedIntegrity}`);
  }

  const hash = createHash(algorithm);
  await new Promise<void>((resolve, reject) => {
    const stream = fsSync.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', resolve);
  });

  const actualDigest = hash.digest('base64');
  if (actualDigest !== expectedDigest) {
    throw new Error(`Integrity mismatch for ${packageName}`);
  }
}

async function extractPackageTarball(tarballPath: string, packageDir: string): Promise<void> {
  await fs.mkdir(packageDir, { recursive: true });
  await getTar().x({ file: tarballPath, cwd: packageDir, strip: 1 });
}

async function chmodInstalledBins(versionDir: string, nativePackageName: string): Promise<void> {
  const { wrapperPath, nativeBinaryPath } = getPathsForVersion(versionDir, nativePackageName);
  await fs.chmod(wrapperPath, 0o755);
  if (getPlatform() !== 'win32') await fs.chmod(nativeBinaryPath, 0o755);
}

async function verifyMacCodeSignature(nativeBinaryPath: string): Promise<void> {
  await runProcess('codesign', ['--verify', '--deep', '--strict', nativeBinaryPath], {
    timeoutMs: 10_000,
  });
  const details = await runProcess('codesign', ['-dv', '--verbose=2', nativeBinaryPath], {
    timeoutMs: 10_000,
  });
  const teamMatch = `${details.stdout}\n${details.stderr}`.match(/TeamIdentifier=(\S+)/);
  const actualTeamId = teamMatch?.[1];
  if (actualTeamId !== CODEX_APPLE_TEAM_ID) {
    throw new Error(
      // i18n-ignore (internal signature-verification diagnostic, logged not rendered)
      `Downloaded codex binary signed by unexpected team: expected ${CODEX_APPLE_TEAM_ID}, got ${actualTeamId ?? 'unknown'}`,
    );
  }
}

/**
 * `--version` (not `--help`) — the successor adapter treats unknown flags as a
 * normal server start and never exits, while `--version` prints and exits 0.
 */
async function validateWrapper(wrapperPath: string): Promise<void> {
  await runProcess(process.execPath, [wrapperPath, '--version'], {
    timeoutMs: SPAWN_TIMEOUT_MS,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', ...MANAGED_CODEX_ACP_ENV_OVERRIDES },
  });
}

/**
 * AUDIT-R1b: one-shot process execution routed through the daemon's
 * `host.exec` seam (PROTOCOL §5.14). Preserves the previous rejection contract
 * — non-zero exit / spawn error / timeout all reject with a descriptive Error
 * — so callers (`verifyMacCodeSignature`, `validateWrapper`) are unchanged.
 */
async function runProcess(
  command: string,
  args: string[],
  options: { timeoutMs: number; env?: NodeJS.ProcessEnv },
): Promise<SpawnResult> {
  const env = options.env
    ? (Object.fromEntries(
        Object.entries(options.env).filter(([, value]) => typeof value === 'string'),
      ) as Record<string, string>)
    : undefined;
  const result = await hostExec(command, {
    args,
    env,
    timeoutMs: options.timeoutMs,
  });
  if (result.timedOut) {
    throw new Error(`${command} timed out after ${options.timeoutMs}ms`);
  }
  if (result.exitCode !== 0) {
    throw new Error(`${command} exited with ${result.exitCode}: ${result.stderr || result.stdout}`);
  }
  return { stdout: result.stdout, stderr: result.stderr };
}

async function pruneOldManagedVersions(baseDir: string, currentVersion: string): Promise<void> {
  const entries = await fs.readdir(baseDir, { withFileTypes: true }).catch(() => []);
  const versions = entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.tmp-'))
    .map((entry) => entry.name)
    .filter((version) => version !== currentVersion)
    .sort(compareVersions)
    .reverse();
  const versionsToKeep = new Set([currentVersion, ...versions.slice(0, 1)]);

  await Promise.all(
    entries
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.tmp-'))
      .filter((entry) => !versionsToKeep.has(entry.name))
      .map((entry) => fs.rm(path.join(baseDir, entry.name), { recursive: true, force: true })),
  );
}

function compareVersions(a: string, b: string): number {
  const parse = (version: string) =>
    version.split('.').map((part) => Number.parseInt(part, 10) || 0);
  const left = parse(a);
  const right = parse(b);
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return a.localeCompare(b);
}

export const __managedCodexAcpTestUtils = {
  setOverrides(overrides: TestOverrides | null): void {
    testOverrides = overrides;
  },
  reset(): void {
    testOverrides = null;
    inFlightInstall = null;
    lastStatus = { state: 'not_installed', version: MANAGED_CODEX_ACP_VERSION };
  },
  getPlatformPackage,
};
