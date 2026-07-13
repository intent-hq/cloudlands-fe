/**
 * Droid command resolution
 *
 * Resolves the Factory Droid CLI binary. Droid is installed via the Factory
 * install script (no npm package), so there is no npx fallback — only a
 * direct binary lookup on PATH and common install locations.
 */

import * as os from 'os';
import * as path from 'path';
import { findBinary } from '../../../shared/main/find-binary';

// Common paths to look for droid
const DROID_PATHS = [
  path.join(os.homedir(), '.factory/bin/droid'),
  path.join(os.homedir(), '.local/bin/droid'),
  '/usr/local/bin/droid',
  '/usr/bin/droid',
  '/opt/homebrew/bin/droid',
  // Windows paths
  ...(process.platform === 'win32'
    ? [
        path.join(os.homedir(), '.factory', 'bin', 'droid.exe'),
        path.join(os.homedir(), '.local', 'bin', 'droid.exe'),
        path.join(os.homedir(), '.local', 'bin', 'droid.cmd'),
        path.join(os.homedir(), '.local', 'bin', 'droid'),
      ]
    : []),
];

let cachedDroidPath: string | null = null;

/**
 * Clear cached path to force re-detection on next check.
 * Call this when refreshing provider status.
 */
export function clearDroidCache(): void {
  cachedDroidPath = null;
}

/**
 * Find the droid executable path
 */
async function findDroidPath(): Promise<string | null> {
  if (cachedDroidPath) {
    return cachedDroidPath;
  }

  const result = await findBinary('droid', {
    commonPaths: DROID_PATHS,
    cache: false,
    timeout: 3000,
    useEnhancedPath: false,
    useLoginShell: false,
  });

  if (result) {
    cachedDroidPath = result;
  }

  return result;
}

/**
 * Check if droid is installed.
 * Used for accurate status detection in the provider status panel.
 */
export async function isDroidInstalled(): Promise<boolean> {
  const droidPath = await findDroidPath();
  return droidPath !== null;
}

/**
 * Get the resolved path to the droid executable.
 * Returns null if not found.
 */
export async function getDroidPath(): Promise<string | null> {
  return findDroidPath();
}

export type DroidResolvedCommand = {
  command: string;
  argsPrefix: string[];
};

/**
 * Resolve the command to run Droid.
 * Only a direct binary is supported (no npx fallback).
 */
export async function resolveDroidCommand(): Promise<DroidResolvedCommand | null> {
  const droidPath = await findDroidPath();
  if (droidPath) {
    return { command: droidPath, argsPrefix: [] };
  }
  return null;
}

