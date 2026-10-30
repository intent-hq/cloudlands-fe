/**
 * Pi command resolution
 *
 * Detects the installed `pi` engine binary (availability keys off `pi`, not
 * `pi-acp`). The pi ACP adapter itself is spawned — and pinned — by intentd,
 * which also delivers MCP tools to pi through its bundled extension.
 */

import { findBinary, findBinaryStrict, getCommonNpmPaths } from '../../../shared/main/find-binary';

let cachedPiPath: string | null = null;

/**
 * Clear cached paths to force re-detection on next check.
 * Call this when refreshing provider status.
 */
export function clearPiCache(): void {
  cachedPiPath = null;
}

/**
 * Find the `pi` engine executable path. `strict` keeps probe failures
 * distinct from "not found" (the lookup rejects instead of resolving null).
 */
async function findPiPath(strict = false): Promise<string | null> {
  if (cachedPiPath) {
    return cachedPiPath;
  }

  const result = await (strict ? findBinaryStrict : findBinary)('pi', {
    commonPaths: getCommonNpmPaths('pi'),
    timeout: 3000,
    useEnhancedPath: true,
    useLoginShell: true,
  });

  if (result) {
    cachedPiPath = result;
  }

  return result;
}

/**
 * Check if the `pi` engine is installed.
 * Used for accurate status detection in the provider status panel.
 * Rejects when the probe itself fails (daemon RPC error) — a failed probe
 * proves nothing about availability, so callers must not fold it to false.
 */
export async function isPiInstalled(): Promise<boolean> {
  const piPath = await findPiPath(true);
  return piPath !== null;
}

/**
 * Get the resolved path to the `pi` engine executable.
 * Returns null if not found.
 */
export async function getPiPath(): Promise<string | null> {
  return findPiPath();
}
