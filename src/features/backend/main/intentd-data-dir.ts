/**
 * Shared resolver for the intentd daemon's data dir (and the socket path
 * inside it). This is the single place in the FE that mirrors the daemon's
 * platform defaults — `Config::resolve` via
 * `directories::ProjectDirs::from("", "", "intentd").data_dir()`
 * (crates/intent-core/src/config.rs):
 *   - `INTENTD_DATA_DIR` (trimmed) wins on every platform.
 *   - win32  → `%APPDATA%\intentd\data` (fallback `~\AppData\Roaming`).
 *   - darwin → `~/Library/Application Support/intentd`.
 *   - other (Linux) → `$XDG_DATA_HOME/intentd`, fallback `~/.local/share/intentd`.
 *
 * Dependency-light on purpose (no Electron, no stores): it is consumed by the
 * sidecar manager, the backend transport resolver, and the debug-export
 * collector.
 */
import os from 'node:os';
import path from 'node:path';

/** Resolve the intentd data dir for `platform`, honoring `INTENTD_DATA_DIR`. */
export function resolveIntentdDataDir(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string {
  const dataDir = env.INTENTD_DATA_DIR?.trim();
  if (dataDir) return dataDir;
  if (platform === 'win32') {
    const appData = env.APPDATA?.trim() || path.win32.join(os.homedir(), 'AppData', 'Roaming');
    return path.win32.join(appData, 'intentd', 'data');
  }
  if (platform === 'darwin') {
    // i18n-ignore (filesystem path)
    return path.join(os.homedir(), 'Library', 'Application Support', 'intentd');
  }
  const xdgDataHome = env.XDG_DATA_HOME?.trim() || path.join(os.homedir(), '.local', 'share');
  return path.join(xdgDataHome, 'intentd');
}

/**
 * The daemon's UDS socket path: `<data dir>/intentd.sock`. On win32 the
 * daemon serves a named pipe derived from this path — callers that need the
 * connect target map it through `toLocalEndpoint` / `windowsPipeName`
 * (see `intentd-pipe-name.ts`).
 */
export function resolveIntentdSocketPath(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string {
  const dataDir = resolveIntentdDataDir(env, platform);
  return platform === 'win32'
    ? path.win32.join(dataDir, 'intentd.sock')
    : path.join(dataDir, 'intentd.sock');
}
