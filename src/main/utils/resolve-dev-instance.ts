// NOTE: Git-specific environment variables are applied per-command in shared/git/git-env.ts
// to avoid leaking non-interactive settings into user terminals.

import * as path from 'path';

// Base userData directory name for cloudlands-fe on all platforms, in both dev and
// packaged builds (e.g. ~/Library/Application Support/intent-cloudlands on macOS).
// Decoupled from the Electron app name so renaming the app cannot silently move data.
export const USER_DATA_DIR_NAME = 'intent-cloudlands';

/**
 * Compute the base userData directory for cloudlands-fe from the platform appData
 * directory (Electron's app.getPath('appData')). Pure so it is testable without
 * Electron; callers pass the resolved appData path in.
 */
export function resolveUserDataBasePath(appDataPath: string): string {
  return path.join(appDataPath, USER_DATA_DIR_NAME);
}

// Base dev port used only for deriving display instance numbers in window/menu titles
// (kept in sync with scripts/dev-launcher.mjs PORT_CONFIG.devPort.start). Userland
// namespacing uses the absolute DEV_PORT via resolveDevUserDataDirName() below.
const DEV_PORT_BASE = 5190;

export function resolveDevInstance(): string {
  const envInstance = (process.env.DEV_INSTANCE || '').trim();
  if (envInstance) return envInstance;

  const devPort = Number(process.env.DEV_PORT);
  if (Number.isFinite(devPort) && devPort >= DEV_PORT_BASE) {
    return String(devPort - DEV_PORT_BASE + 1);
  }

  return '';
}

/**
 * Compute the cloudlands-fe dev-mode userData subdirectory name, namespaced by the
 * absolute DEV_PORT so parallel Electron dev apps (e.g. reference Intent builds that
 * use "dev-instance-N") cannot collide on the SingletonLock. Deterministic per port
 * so settings/logs persist across runs.
 *
 * Returns null in production (no DEV_PORT and not in development) so callers keep
 * Electron's default userData path unchanged.
 */
export function resolveDevUserDataDirName(): string | null {
  const isDev = process.env.NODE_ENV === 'development';
  if (!isDev) return null;

  const rawPort = (process.env.DEV_PORT || '').trim();
  const devPort = Number(rawPort);
  if (rawPort && Number.isFinite(devPort) && devPort > 0) {
    return `cloudlands-dev-${devPort}`;
  }
  return 'cloudlands-dev';
}

// Parent directory (under the platform appData dir) holding per-dev-port intentd data
// directories. Deliberately outside the intent-cloudlands/cloudlands-dev-* userData
// namespace so dev-launcher.mjs stale-profile pruning never deletes daemon data, and
// deliberately short: the socket inside it must fit macOS's ~104-byte sun_path limit.
export const DEV_INTENTD_DIR_NAME = 'intentd-fe';

// Data-dir segment used in dev when DEV_PORT is unset/unusable.
const DEV_INTENTD_FALLBACK_SEGMENT = 'dev';

/**
 * Compute the per-DEV_PORT intentd data directory for dev builds:
 * `<appData>/intentd-fe/<DEV_PORT>` (e.g.
 * `~/Library/Application Support/intentd-fe/5190` on macOS), falling back to
 * `<appData>/intentd-fe/dev` when DEV_PORT is unset or not a positive number.
 *
 * Deterministic per port so daemon data persists across runs, and distinct per port so
 * parallel dev instances cannot adopt each other's (or the installed app's) daemon.
 * Pure so it is testable without Electron; callers pass the resolved appData path in.
 */
export function resolveDevIntentdDataDir(
  appDataPath: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const rawPort = (env.DEV_PORT || '').trim();
  const devPort = Number(rawPort);
  const segment =
    rawPort && Number.isFinite(devPort) && devPort > 0
      ? String(devPort)
      : DEV_INTENTD_FALLBACK_SEGMENT;
  return path.join(appDataPath, DEV_INTENTD_DIR_NAME, segment);
}

/**
 * Whether a dev build should replace `INTENTD_DATA_DIR` with the per-port dir from
 * [[resolveDevIntentdDataDir]].
 *
 * Any inherited `INTENTD_DATA_DIR` is replaced unconditionally — a host-injected value
 * (e.g. from the installed app's environment) otherwise makes the dev instance adopt the
 * legacy workspace catalog. An explicit transport override (`INTENTD_SOCKET`,
 * `INTENTD_WS_URL`, `INTENTD_TCP`) still wins: those name a connection target directly,
 * so replacing the data dir must not move it.
 */
export function shouldIsolateDevIntentdDataDir(
  env: NodeJS.ProcessEnv = process.env,
  isDev: boolean = env.NODE_ENV === 'development',
): boolean {
  if (!isDev) return false;
  if (env.INTENTD_SOCKET?.trim()) return false;
  if (env.INTENTD_WS_URL?.trim()) return false;
  if (env.INTENTD_TCP?.trim()) return false;
  return true;
}
