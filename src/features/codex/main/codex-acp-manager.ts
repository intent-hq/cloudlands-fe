import {
  createHash,
  randomUUID,
} from 'crypto';
import { app } from 'electron';
import * as fsSync from 'fs';
import { promises as fs } from 'fs';
import * as https from 'https';
import { createRequire } from 'module';
import * as path from 'path';
import { pipeline } from 'stream/promises';
import { hostExec } from '../../../shared/main/host-exec';

export const MANAGED_CODEX_ACP_VERSION = '0.13.0';
const CODEX_ACP_APPLE_TEAM_ID = 'MQ55VZLNZQ';
const DOWNLOAD_TIMEOUT_MS = 60_000;
const SPAWN_TIMEOUT_MS = 30_000;

type ManagedCodexAcpPackage = {
  packageName: string;
  tarballUrl: string;
  integrity: string;
};

type SupportedPlatformKey = 'darwin-arm64' | 'darwin-x64' | 'linux-x64' | 'win32-x64';

export const MANAGED_CODEX_ACP_INTEGRITY: {
  wrapper: ManagedCodexAcpPackage;
  platforms: Record<SupportedPlatformKey, ManagedCodexAcpPackage>;
} = {
  wrapper: {
    packageName: '@zed-industries/codex-acp',
    tarballUrl: 'https://registry.npmjs.org/@zed-industries/codex-acp/-/codex-acp-0.13.0.tgz',
    integrity: 'sha512-Ep3gINMVB8qQL3kozJxEzG4YP7NmWUb5s+8yu8tQ7YSPfaIPXBIQQmO5sQk2Uu2av+gIC2EchbwaSSG3Mo17YQ==',
  },
  platforms: {
    'darwin-arm64': {
      packageName: '@zed-industries/codex-acp-darwin-arm64',
      tarballUrl:
        'https://registry.npmjs.org/@zed-industries/codex-acp-darwin-arm64/-/codex-acp-darwin-arm64-0.13.0.tgz',
      integrity: 'sha512-SNJbpxOD1b98pK1Qw2pZjFJbfYBICheRs3mYvLMgHABehdypaeYKnEmEGp3Bu/gUT6JFAtOPRtaU+sfxKzgCvw==',
    },
    'darwin-x64': {
      packageName: '@zed-industries/codex-acp-darwin-x64',
      tarballUrl:
        'https://registry.npmjs.org/@zed-industries/codex-acp-darwin-x64/-/codex-acp-darwin-x64-0.13.0.tgz',
      integrity: 'sha512-R5CQi2mmi9Nk2P6t48T5JoOQx0jWnP9DzLf5jcTnCLqk1tsg9XtASpLBtsedll9MesBax6aflDvz+0dyWW+3Mw==',
    },
    'linux-x64': {
      packageName: '@zed-industries/codex-acp-linux-x64',
      tarballUrl:
        'https://registry.npmjs.org/@zed-industries/codex-acp-linux-x64/-/codex-acp-linux-x64-0.13.0.tgz',
      integrity: 'sha512-sWNfyeuwEHPo6DSbcjklnBr7M8+MWd2b9oVbIqgwxryTPpm0ZPF3U28PWR3/vGxS5UmhGiZIShe9tqx8FsvvBg==',
    },
    'win32-x64': {
      packageName: '@zed-industries/codex-acp-win32-x64',
      tarballUrl:
        'https://registry.npmjs.org/@zed-industries/codex-acp-win32-x64/-/codex-acp-win32-x64-0.13.0.tgz',
      integrity: 'sha512-675+tZlhzDMBJUrgiTnbcCMB15MQ8B0Ih/GmzB9MqW/FDFJqOFjXe4P+M7joePzQqa7QYwf36le50sDokXDrew==',
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
    throw new Error(`Unsupported platform/arch for managed codex-acp: ${getPlatform()}/${getArch()}`);
  }
  return pkg;
}

function packageInstallPath(versionDir: string, packageName: string): string {
  const [scope, name] = packageName.split('/');
  if (!scope || !name) throw new Error(`Unexpected package name: ${packageName}`);
  return path.join(versionDir, 'node_modules', scope, name);
}

function getRuntimePaths(): {
  baseDir: string;
  versionDir: string;
  wrapperPath: string;
  nativeBinaryPath: string;
} {
  const version = getVersion();
  const manifest = getManifest();
  const platformPackage = getPlatformPackage();
  const baseDir = path.join(app.getPath('userData'), 'runtimes', 'codex-acp');
  const versionDir = path.join(baseDir, version);
  const wrapperPath = path.join(
    packageInstallPath(versionDir, manifest.wrapper.packageName),
    'bin',
    'codex-acp.js',
  );
  const nativeBinaryName = getPlatform() === 'win32' ? 'codex-acp.exe' : 'codex-acp';
  const nativeBinaryPath = path.join(
    packageInstallPath(versionDir, platformPackage.packageName),
    'bin',
    nativeBinaryName,
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

    const stageDir = path.join(paths.baseDir, `.tmp-${version}-${process.pid}-${Date.now()}-${randomUUID()}`);
    const installDir = path.join(stageDir, 'install');
    const wrapperTarballPath = path.join(stageDir, 'codex-acp.tgz');
    const nativeTarballPath = path.join(stageDir, 'codex-acp-native.tgz');

    try {
      await fs.mkdir(stageDir, { recursive: true });
      await downloadAndVerify(manifest.wrapper, wrapperTarballPath);
      await downloadAndVerify(platformPackage, nativeTarballPath);
      await extractPackageTarball(wrapperTarballPath, packageInstallPath(installDir, manifest.wrapper.packageName));
      await extractPackageTarball(nativeTarballPath, packageInstallPath(installDir, platformPackage.packageName));
      await chmodInstalledBins(installDir, manifest.wrapper.packageName, platformPackage.packageName);

      const installPaths = getPathsForVersion(installDir, manifest.wrapper.packageName, platformPackage.packageName);
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

function getPathsForVersion(versionDir: string, wrapperPackageName: string, nativePackageName: string) {
  const nativeBinaryName = getPlatform() === 'win32' ? 'codex-acp.exe' : 'codex-acp';
  return {
    wrapperPath: path.join(packageInstallPath(versionDir, wrapperPackageName), 'bin', 'codex-acp.js'),
    nativeBinaryPath: path.join(packageInstallPath(versionDir, nativePackageName), 'bin', nativeBinaryName),
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

async function downloadAndVerify(pkg: ManagedCodexAcpPackage, destinationPath: string): Promise<void> {
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

async function chmodInstalledBins(
  versionDir: string,
  wrapperPackageName: string,
  nativePackageName: string,
): Promise<void> {
  const { wrapperPath, nativeBinaryPath } = getPathsForVersion(
    versionDir,
    wrapperPackageName,
    nativePackageName,
  );
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
  if (actualTeamId !== CODEX_ACP_APPLE_TEAM_ID) {
    throw new Error(
      `Downloaded codex-acp binary signed by unexpected team: expected ${CODEX_ACP_APPLE_TEAM_ID}, got ${actualTeamId ?? 'unknown'}`,
    );
  }
}

async function validateWrapper(wrapperPath: string): Promise<void> {
  await runProcess(process.execPath, [wrapperPath, '--help'], {
    timeoutMs: SPAWN_TIMEOUT_MS,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
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
    ? Object.fromEntries(
        Object.entries(options.env).filter(([, value]) => typeof value === 'string'),
      ) as Record<string, string>
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
    throw new Error(
      `${command} exited with ${result.exitCode}: ${result.stderr || result.stdout}`,
    );
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
  const parse = (version: string) => version.split('.').map((part) => Number.parseInt(part, 10) || 0);
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