/**
 * OpenCode command resolution
 *
 * Resolves the OpenCode command, preferring a direct binary
 * and falling back to npx with auto-approve if needed.
 */

import * as os from 'os';
import * as path from 'path';
import {
  findBinary,
  getCommonNpmPaths,
} from '../../../shared/main/find-binary';

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

// Common paths to look for npx (fallback runner)
const NPX_PATHS = [
  '/usr/local/bin/npx',
  '/usr/bin/npx',
  '/opt/homebrew/bin/npx',
  '/opt/homebrew/opt/node/bin/npx',
  '/opt/homebrew/opt/node@20/bin/npx',
  '/opt/homebrew/opt/node@18/bin/npx',
  path.join(os.homedir(), '.volta/bin/npx'),
  path.join(os.homedir(), '.fnm/aliases/default/bin/npx'),
  path.join(os.homedir(), '.asdf/shims/npx'),
  path.join(os.homedir(), '.npm-global/bin/npx'),
  // Windows paths
  ...(process.platform === 'win32'
    ? [
        path.join(os.homedir(), 'AppData', 'Roaming', 'npm', 'npx.cmd'),
        path.join(os.homedir(), 'AppData', 'Roaming', 'npm', 'npx'),
        path.join(os.homedir(), 'AppData', 'Local', 'Volta', 'bin', 'npx.exe'),
        path.join(os.homedir(), 'scoop', 'shims', 'npx.exe'),
      ]
    : []),
];

let cachedOpenCodePath: string | null = null;
let cachedNpxPath: string | null = null;

/**
 * Clear cached paths to force re-detection on next check.
 * Call this when refreshing provider status.
 */
export function clearOpenCodeCache(): void {
  cachedOpenCodePath = null;
  cachedNpxPath = null;
}

async function findNpxPath(): Promise<string | null> {
  if (cachedNpxPath) {
    return cachedNpxPath;
  }

  const result = await findBinary('npx', {
    commonPaths: [...NPX_PATHS, ...getCommonNpmPaths('npx')],
    cache: false,
    timeout: 3000,
    useEnhancedPath: false,
    useLoginShell: false,
  });

  if (result) {
    cachedNpxPath = result;
  }

  return result;
}

/**
 * Find the opencode executable path
 */
async function findOpenCodePath(): Promise<string | null> {
  if (cachedOpenCodePath) {
    return cachedOpenCodePath;
  }

  const result = await findBinary('opencode', {
    commonPaths: [...OPENCODE_PATHS, ...getCommonNpmPaths('opencode')],
    cache: false,
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
 */
export async function isOpenCodeInstalled(): Promise<boolean> {
  const opencodePath = await findOpenCodePath();
  return opencodePath !== null;
}

/**
 * Get the resolved path to the opencode executable.
 * Returns null if not found.
 */
export async function getOpenCodePath(): Promise<string | null> {
  return findOpenCodePath();
}

export type OpenCodeResolvedCommand = {
  command: string;
  argsPrefix: string[];
  usesNpx: boolean;
};

/**
 * Resolve the command to run OpenCode.
 * Prefer a direct binary, fall back to npx with auto-approve.
 */
export async function resolveOpenCodeCommand(): Promise<OpenCodeResolvedCommand | null> {
  const opencodePath = await findOpenCodePath();
  if (opencodePath) {
    return { command: opencodePath, argsPrefix: [], usesNpx: false };
  }

  const npxPath = await findNpxPath();
  if (npxPath) {
    return {
      command: npxPath,
      argsPrefix: ['-y', 'opencode'],
      usesNpx: true,
    };
  }

  return null;
}
