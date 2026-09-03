/**
 * Binary/PATH discovery proxied to the daemon (`host.findBinary` / `host.env`,
 * PROTOCOL.md §5.14).
 *
 * The FE no longer probes the local machine for tools or PATH state — every
 * `findBinary()` cache miss forwards a JSON-RPC request to the running daemon, which
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
import { getBackendClient, onBackendReconnected } from '../../features/backend/main/backend.ipc';
import { JsonRpcError } from '../../features/backend/main/json-rpc-errors';

const logger = new Logger('FindBinary');

const SAFE_BINARY_NAME = /^[a-zA-Z0-9._-]+$/;

export const FIND_BINARY_POSITIVE_TTL_MS = 5_000;
export const FIND_BINARY_NEGATIVE_TTL_MS = 1_000;

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
  /** Accepted for backwards compatibility; the daemon owns retry policy. */
  retry?: boolean;
  /** Bypass a resolved TTL entry while still sharing an identical in-flight probe. */
  forceRefresh?: boolean;
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
let discoveryGeneration = 0;
let activeBackendClient: ReturnType<typeof getBackendClient> | null = null;
const binaryCache = new Map<string, { value: string | null; expiresAt: number }>();
const binaryInFlight = new Map<string, Promise<string | null>>();
const invalidationListeners = new Set<() => void>();

function hostEnvPathContext(env: HostEnvResult | null): string {
  return env ? `${env.path}\0${env.enhancedPath}` : '';
}

function invalidateDiscoveryResults(): void {
  discoveryGeneration += 1;
  binaryCache.clear();
  binaryInFlight.clear();
  for (const listener of invalidationListeners) listener();
}

/** Clear host-discovery state after a reconnect or backend identity change. */
export function invalidateHostDiscoveryCache(): void {
  cachedHostEnv = null;
  invalidateDiscoveryResults();
}

/** Subscribe a related host-discovery client to the same invalidation domain. */
export function onHostDiscoveryInvalidated(listener: () => void): () => void {
  invalidationListeners.add(listener);
  return () => invalidationListeners.delete(listener);
}

function currentBackendClient(): ReturnType<typeof getBackendClient> {
  const client = getBackendClient();
  if (activeBackendClient && activeBackendClient !== client) {
    invalidateHostDiscoveryCache();
  }
  activeBackendClient = client;
  return client;
}

onBackendReconnected(() => {
  activeBackendClient = null;
  invalidateHostDiscoveryCache();
});

interface HostEnvInitOptions {
  /** Keep retrying transient connection failures while the sidecar starts. */
  retryForMs?: number;
  retryDelayMs?: number;
  /** Stop retrying and ignore any in-flight response after startup moves on. */
  signal?: AbortSignal;
}

function isRetryableHostEnvError(error: unknown): boolean {
  // A JSON-RPC response proves the daemon is reachable; protocol/server errors
  // will not be fixed by reconnecting. Transport failures remain retryable.
  return !(error instanceof JsonRpcError);
}

function isWindows(): boolean {
  return process.platform === 'win32';
}

function uniquePaths(paths: string[]): string[] {
  return Array.from(new Set(paths.filter(Boolean)));
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
  const signal = options.signal;
  let lastError: unknown;
  const client = currentBackendClient();
  const generation = discoveryGeneration;

  if (signal?.aborted) return null;

  do {
    try {
      const result = await client.request<HostEnvResult>('host.env');
      if (signal?.aborted || generation !== discoveryGeneration) return null;
      const previousPathContext = hostEnvPathContext(cachedHostEnv);
      cachedHostEnv = result;
      if (previousPathContext !== hostEnvPathContext(result)) {
        invalidateDiscoveryResults();
      }
      return result;
    } catch (error) {
      lastError = error;
      if (!isRetryableHostEnvError(error)) break;
    }
    if (signal?.aborted) return null;
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

/**
 * Strict variant of `findBinary`: resolve a binary path via `host.findBinary`
 * with probe failures kept distinct from authoritative unavailability.
 * Returns the resolved path string, `null` when the daemon authoritatively
 * reports `available:false` (or the name is invalid — a deterministic local
 * verdict, not a probe failure), and REJECTS when the RPC itself fails
 * (daemon unreachable, timeout). Availability checks must use this so a
 * transient probe failure never masquerades as "not installed".
 */
export async function findBinaryStrict(
  name: string,
  options: FindBinaryOptions = {},
): Promise<string | null> {
  if (!SAFE_BINARY_NAME.test(name)) {
    logger.warn('Invalid binary name rejected', { name });
    return null;
  }

  const commonPaths = uniquePaths(options.commonPaths || []);

  const params: { name: string; commonPaths?: string[] } = { name };
  if (commonPaths.length > 0) {
    params.commonPaths = commonPaths;
  }

  const key = JSON.stringify([name, commonPaths]);
  const client = currentBackendClient();
  const cached = binaryCache.get(key);
  if (!options.forceRefresh && cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  const existing = binaryInFlight.get(key);
  if (existing) return existing;

  const generation = discoveryGeneration;
  const request = (async (): Promise<string | null> => {
    const result = await client.request<HostFindBinaryResult>('host.findBinary', params);
    let value: string | null;
    if (result?.available) {
      if (typeof result.path !== 'string' || result.path.length === 0) {
        throw new Error(`host.findBinary returned available:true without a path for "${name}"`);
      }
      value = result.path;
    } else {
      value = null;
    }

    if (generation === discoveryGeneration) {
      binaryCache.set(key, {
        value,
        expiresAt:
          Date.now() + (value === null ? FIND_BINARY_NEGATIVE_TTL_MS : FIND_BINARY_POSITIVE_TTL_MS),
      });
    }
    return value;
  })();
  binaryInFlight.set(key, request);
  void request
    .finally(() => {
      if (binaryInFlight.get(key) === request) binaryInFlight.delete(key);
    })
    .catch(() => {});
  return request;
}

/**
 * Resolve a binary path via `host.findBinary`. The daemon performs the actual
 * `which`/`where` + OS-common-dirs walk on the host where workspaces run; the
 * FE never probes the local machine. Results use short positive (5 s) and
 * authoritative-negative (1 s) TTLs, with `forceRefresh` available when a
 * caller must observe a new install immediately. Returns the resolved path string or `null` when
 * the daemon reports `available:false` or the request fails. Callers that
 * must distinguish a failed probe from authoritative unavailability use
 * `findBinaryStrict` instead.
 */
export async function findBinary(
  name: string,
  options: FindBinaryOptions = {},
): Promise<string | null> {
  try {
    return await findBinaryStrict(name, options);
  } catch (error) {
    logger.debug('host.findBinary request failed', {
      name,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}
