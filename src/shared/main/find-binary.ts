/**
 * Binary/PATH discovery proxied to the daemon (`host.findBinary` / `host.env`,
 * PROTOCOL.md §5.14).
 *
 * The FE no longer probes the local machine for tools or PATH state — every
 * `findBinary()` call forwards a JSON-RPC request to the running daemon, which
 * owns the actual `which`/`where` + OS-common-dirs walk on whichever host the
 * workspace targets (local or remote). `getEnhancedPath()` returns the cached
 * `host.env.enhancedPath` from the most recent `initializeHostEnv()` so callers
 * that synchronously inject a PATH into a spawned child still get the daemon's
 * authoritative environment instead of the laptop's `process.env.PATH`.
 *
 * `getCommonNpmPaths` / `getCommonNpxPaths` are kept as pure hint constructors
 * (no `fs.existsSync`, no `fs.readdirSync`) so existing resolvers can pass
 * `commonPaths` to the daemon without changing their call sites.
 */
import * as os from 'os';
import * as path from 'path';
import { Logger } from '../logger';
import { getBackendClient } from '../../features/backend/main/backend.ipc';

const logger = new Logger('FindBinary');

const SAFE_BINARY_NAME = /^[a-zA-Z0-9._-]+$/;
const binaryCache = new Map<string, string | null>();

export interface FindBinaryOptions {
  /** Extra OS-host paths to probe verbatim before the OS-common dirs (daemon-side). */
  commonPaths?: string[];
  /** Accepted for backwards compatibility; the daemon decides extension preference. */
  preferExtensions?: string[];
  /** Accepted for backwards compatibility; login-shell probing happens daemon-side. */
  useLoginShell?: boolean;
  /** Accepted for backwards compatibility; the daemon owns the PATH it searches. */
  useEnhancedPath?: boolean;
  /** Accepted for backwards compatibility; the daemon owns lookup timeouts. */
  timeout?: number;
  /** Cache the resolved path locally to avoid repeating wire calls. */
  cache?: boolean;
  /** Accepted for backwards compatibility; the daemon owns retry policy. */
  retry?: boolean;
}

interface HostFindBinaryResult {
  available: boolean;
  path?: string;
  version?: string;
}

interface HostEnvResult {
  path: string;
  pathEntries: string[];
  enhancedPath: string;
  shell: string;
  home: string;
  varNames: string[];
}

let cachedHostEnv: HostEnvResult | null = null;

interface HostEnvInitOptions {
  /** Keep retrying transient connection failures while the sidecar starts. */
  retryForMs?: number;
  retryDelayMs?: number;
}

function isWindows(): boolean {
  return process.platform === 'win32';
}

function uniquePaths(paths: string[]): string[] {
  return Array.from(new Set(paths.filter(Boolean)));
}

function cacheKey(name: string, commonPaths: string[]): string {
  return `${name}\0${JSON.stringify(commonPaths)}`;
}

/**
 * Seed and cache the daemon-owned environment (`host.env`). Call once at
 * startup so synchronous consumers of `getEnhancedPath()` see the BE's
 * authoritative PATH instead of the renderer process's local PATH.
 */
export async function initializeHostEnv(
  options: HostEnvInitOptions = {},
): Promise<HostEnvResult | null> {
  const deadline = Date.now() + (options.retryForMs ?? 0);
  const retryDelayMs = options.retryDelayMs ?? 100;
  let lastError: unknown;

  do {
    try {
      const result = await getBackendClient().request<HostEnvResult>('host.env');
      cachedHostEnv = result;
      return result;
    } catch (error) {
      lastError = error;
    }
    if (Date.now() >= deadline) break;
    await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
  } while (true);

  logger.warn('host.env request failed', {
    error: lastError instanceof Error ? lastError.message : String(lastError),
  });
  cachedHostEnv = null;
  return null;
}

/** Read-only access to the last cached host environment (or null if not yet seeded). */
export function getCachedHostEnv(): HostEnvResult | null {
  return cachedHostEnv;
}

/**
 * Return the daemon's enhanced PATH if it was seeded by `initializeHostEnv()`,
 * otherwise fall back to `process.env.PATH`. No local filesystem probing.
 */
export function getEnhancedPath(): string {
  if (cachedHostEnv?.enhancedPath) {
    return cachedHostEnv.enhancedPath;
  }
  return process.env.PATH ?? '';
}

/**
 * Static list of OS-common candidate paths for a node-installed binary. Used
 * as a hint passed verbatim to `host.findBinary` via `commonPaths`; the daemon
 * is the one that verifies existence on the actual host.
 */
export function getCommonNpmPaths(binaryName: string): string[] {
  const homeDir = os.homedir();

  if (isWindows()) {
    const appData = process.env.APPDATA || path.join(homeDir, 'AppData', 'Roaming');
    const localAppData = process.env.LOCALAPPDATA || path.join(homeDir, 'AppData', 'Local');
    const userProfile = process.env.USERPROFILE || homeDir;

    return uniquePaths([
      path.join(appData, 'npm', `${binaryName}.cmd`),
      path.join(appData, 'npm', binaryName),
      path.join(localAppData, 'npm', `${binaryName}.cmd`),
      path.join(localAppData, 'npm', binaryName),
      path.join(appData, 'nvm', `${binaryName}.cmd`),
      path.join(appData, 'nvm', binaryName),
      path.join(localAppData, 'Volta', 'bin', `${binaryName}.exe`),
      path.join(localAppData, 'Volta', 'bin', `${binaryName}.cmd`),
      path.join(userProfile, 'scoop', 'shims', `${binaryName}.exe`),
      path.join(userProfile, 'scoop', 'shims', `${binaryName}.cmd`),
      path.join(localAppData, 'Programs', binaryName, `${binaryName}.exe`),
      path.join(localAppData, 'Programs', binaryName, `${binaryName}.cmd`),
      path.join(localAppData, 'Programs', binaryName, 'bin', `${binaryName}.exe`),
      path.join(localAppData, 'Programs', binaryName, 'bin', `${binaryName}.cmd`),
      path.join(homeDir, '.local', 'bin', `${binaryName}.exe`),
      path.join(homeDir, '.local', 'bin', `${binaryName}.cmd`),
      path.join(homeDir, '.local', 'bin', binaryName),
    ]);
  }

  const homebrewNodeVersions = ['18', '20', '22'];

  return uniquePaths([
    `/usr/local/bin/${binaryName}`,
    `/usr/bin/${binaryName}`,
    `/opt/homebrew/bin/${binaryName}`,
    path.join(homeDir, '.local', 'bin', binaryName),
    path.join(homeDir, '.bun', 'bin', binaryName),
    path.join(homeDir, '.npm-global', 'bin', binaryName),
    path.join(homeDir, '.npm-packages', 'bin', binaryName),
    path.join(homeDir, 'npm', 'bin', binaryName),
    path.join(homeDir, '.volta', 'bin', binaryName),
    path.join(homeDir, '.fnm', 'aliases', 'default', 'bin', binaryName),
    path.join(homeDir, '.asdf', 'shims', binaryName),
    path.join(homeDir, 'n', 'bin', binaryName),
    `/usr/local/n/bin/${binaryName}`,
    `/usr/local/opt/node/bin/${binaryName}`,
    `/opt/homebrew/opt/node/bin/${binaryName}`,
    ...homebrewNodeVersions.flatMap((version) => [
      `/usr/local/opt/node@${version}/bin/${binaryName}`,
      `/opt/homebrew/opt/node@${version}/bin/${binaryName}`,
    ]),
  ]);
}

export function getCommonNpxPaths(): string[] {
  return getCommonNpmPaths('npx');
}

export function clearBinaryCache(name?: string): void {
  if (name) {
    const prefix = `${name}\0`;
    for (const key of binaryCache.keys()) {
      if (key === name || key.startsWith(prefix)) {
        binaryCache.delete(key);
      }
    }
    return;
  }

  binaryCache.clear();
}

/**
 * Resolve a binary path via `host.findBinary`. The daemon performs the actual
 * `which`/`where` + OS-common-dirs walk on the host where workspaces run; the
 * FE never probes the local machine. Returns the resolved path string or
 * `null` when the daemon reports `available:false` or the request fails.
 */
export async function findBinary(
  name: string,
  options: FindBinaryOptions = {},
): Promise<string | null> {
  if (!SAFE_BINARY_NAME.test(name)) {
    logger.warn('Invalid binary name rejected', { name });
    return null;
  }

  const useCache = options.cache !== false;
  const commonPaths = uniquePaths(options.commonPaths || []);
  const key = cacheKey(name, commonPaths);

  if (useCache && binaryCache.has(key)) {
    return binaryCache.get(key) ?? null;
  }

  const params: { name: string; commonPaths?: string[] } = { name };
  if (commonPaths.length > 0) {
    params.commonPaths = commonPaths;
  }

  try {
    const result = await getBackendClient().request<HostFindBinaryResult>(
      'host.findBinary',
      params,
    );
    const resolved =
      result?.available && typeof result.path === 'string' && result.path.length > 0
        ? result.path
        : null;
    if (useCache) {
      binaryCache.set(key, resolved);
    }
    return resolved;
  } catch (error) {
    logger.debug('host.findBinary request failed', {
      name,
      error: error instanceof Error ? error.message : String(error),
    });
    if (useCache) {
      binaryCache.set(key, null);
    }
    return null;
  }
}
