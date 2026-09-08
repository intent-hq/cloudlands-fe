/**
 * Cortex command resolution
 *
 * Resolves the Cortex binary path for availability checking.
 * Cortex is a Snowflake coding agent that runs as a local binary.
 */

import * as os from 'os';
import * as path from 'path';
import { findBinary, findBinaryStrict, getCommonNpmPaths } from '../../../shared/main/find-binary';

// Common paths to look for cortex binary
const CORTEX_PATHS = [
  path.join(os.homedir(), '.local/bin/cortex'),
  '/usr/local/bin/cortex',
  '/usr/bin/cortex',
  '/opt/homebrew/bin/cortex',
  path.join(os.homedir(), '.bun/bin/cortex'),
  path.join(os.homedir(), '.npm-global/bin/cortex'),
  // Windows paths
  ...(process.platform === 'win32'
    ? [
        path.join(os.homedir(), 'AppData', 'Roaming', 'npm', 'cortex.cmd'),
        path.join(os.homedir(), 'AppData', 'Roaming', 'npm', 'cortex'),
        path.join(os.homedir(), 'AppData', 'Local', 'Volta', 'bin', 'cortex.exe'),
        path.join(os.homedir(), 'scoop', 'shims', 'cortex.exe'),
      ]
    : []),
];

let cachedCortexPath: string | null = null;

/**
 * Clear cached paths to force re-detection on next check.
 * Call this when refreshing provider status.
 */
export function clearCortexCache(): void {
  cachedCortexPath = null;
}

/**
 * Find the cortex executable path. `strict` keeps probe failures distinct
 * from "not found" (the lookup rejects instead of resolving null).
 */
async function findCortexPath(strict = false): Promise<string | null> {
  if (cachedCortexPath) {
    return cachedCortexPath;
  }

  const result = await (strict ? findBinaryStrict : findBinary)('cortex', {
    commonPaths: [...CORTEX_PATHS, ...getCommonNpmPaths('cortex')],
    timeout: 3000,
    useEnhancedPath: false,
    useLoginShell: false,
  });

  if (result) {
    cachedCortexPath = result;
  }

  return result;
}

/**
 * Check if cortex is directly installed.
 * Used for accurate status detection in the provider status panel.
 * Rejects when the probe itself fails (daemon RPC error) — a failed probe
 * proves nothing about availability, so callers must not fold it to false.
 */
export async function isCortexInstalled(): Promise<boolean> {
  const cortexPath = await findCortexPath(true);
  return cortexPath !== null;
}

/**
 * Get the resolved path to the cortex executable.
 * Returns null if not found.
 */
export async function getCortexPath(): Promise<string | null> {
  return findCortexPath();
}
