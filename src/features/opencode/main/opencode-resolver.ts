/**
 * OpenCode command resolution
 *
 * Resolves the OpenCode binary on the daemon host for the provider status
 * panel (`isOpenCodeInstalled`).
 */

import * as os from 'os';
import * as path from 'path';
import { findBinary, findBinaryStrict, getCommonNpmPaths } from '../../../shared/main/find-binary';

// Common paths to look for opencode
const OPENCODE_PATHS = [
  path.join(os.homedir(), '.opencode/bin/opencode'),
  '/usr/local/bin/opencode',
  '/usr/bin/opencode',
  '/opt/homebrew/bin/opencode',
  path.join(os.homedir(), '.local/bin/opencode'),
  path.join(os.homedir(), '.bun/bin/opencode'),
  path.join(os.homedir(), '.npm-global/bin/opencode'),
  // Windows paths
  ...(process.platform === 'win32'
    ? [
        path.join(os.homedir(), 'AppData', 'Roaming', 'npm', 'opencode.cmd'),
        path.join(os.homedir(), 'AppData', 'Roaming', 'npm', 'opencode'),
        path.join(os.homedir(), 'AppData', 'Local', 'Volta', 'bin', 'opencode.exe'),
        path.join(os.homedir(), 'scoop', 'shims', 'opencode.exe'),
        path.join(os.homedir(), '.local', 'bin', 'opencode.exe'),
        path.join(os.homedir(), '.local', 'bin', 'opencode.cmd'),
        path.join(os.homedir(), '.local', 'bin', 'opencode'),
      ]
    : []),
];

let cachedOpenCodePath: string | null = null;

/**
 * Clear cached paths to force re-detection on next check.
 * Call this when refreshing provider status.
 */
export function clearOpenCodeCache(): void {
  cachedOpenCodePath = null;
}

/**
 * Find the opencode executable path. `strict` keeps probe failures distinct
 * from "not found" (the lookup rejects instead of resolving null).
 */
async function findOpenCodePath(strict = false): Promise<string | null> {
  if (cachedOpenCodePath) {
    return cachedOpenCodePath;
  }

  const result = await (strict ? findBinaryStrict : findBinary)('opencode', {
    commonPaths: [...OPENCODE_PATHS, ...getCommonNpmPaths('opencode')],
    timeout: 3000,
    useEnhancedPath: false,
    useLoginShell: false,
  });

  if (result) {
    cachedOpenCodePath = result;
  }

  return result;
}

/**
 * Check if opencode is directly installed (not via npx fallback).
 * Used for accurate status detection in the provider status panel.
 * Rejects when the probe itself fails (daemon RPC error) — a failed probe
 * proves nothing about availability, so callers must not fold it to false.
 */
export async function isOpenCodeInstalled(): Promise<boolean> {
  const opencodePath = await findOpenCodePath(true);
  return opencodePath !== null;
}
