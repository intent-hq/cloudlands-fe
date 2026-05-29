/**
 * Pi command resolution
 *
 * Detects the installed `pi` engine binary (availability keys off `pi`, not
 * `pi-acp`). The adapter is always run via `npx -y pi-acp` (the adapter's
 * recommended zero-install path; `pi-acp` requires `pi` on PATH anyway), so we
 * do not require a globally-installed `pi-acp` binary.
 */

import * as os from 'os';
import * as path from 'path';
import {
  findBinary,
  getCommonNpmPaths,
} from '../../../shared/main/find-binary';

// Common paths to look for npx (adapter runner)
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

let cachedPiPath: string | null = null;
let cachedNpxPath: string | null = null;

/**
 * Clear cached paths to force re-detection on next check.
 * Call this when refreshing provider status.
 */
export function clearPiCache(): void {
  cachedPiPath = null;
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
    useEnhancedPath: true,
    useLoginShell: true,
  });

  if (result) {
    cachedNpxPath = result;
  }

  return result;
}

/**
 * Find the `pi` engine executable path.
 */
async function findPiPath(): Promise<string | null> {
  if (cachedPiPath) {
    return cachedPiPath;
  }

  const result = await findBinary('pi', {
    commonPaths: getCommonNpmPaths('pi'),
    cache: false,
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
 */
export async function isPiInstalled(): Promise<boolean> {
  const piPath = await findPiPath();
  return piPath !== null;
}

/**
 * Get the resolved path to the `pi` engine executable.
 * Returns null if not found.
 */
export async function getPiPath(): Promise<string | null> {
  return findPiPath();
}

export type PiResolvedCommand = {
  command: string;
  argsPrefix: string[];
  usesNpx: boolean;
};

/**
 * Resolve the command to run the Pi adapter.
 * Always runs the adapter via `npx -y pi-acp`. Returns null only when npx
 * cannot be resolved.
 */
export async function resolvePiCommand(): Promise<PiResolvedCommand | null> {
  const npxPath = await findNpxPath();
  if (npxPath) {
    return {
      command: npxPath,
      argsPrefix: ['-y', 'pi-acp'],
      usesNpx: true,
    };
  }

  return null;
}
