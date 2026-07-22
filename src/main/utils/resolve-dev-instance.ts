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
