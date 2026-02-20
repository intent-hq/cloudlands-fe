/**
 * OpenCode command resolution
 *
 * Resolves the OpenCode command, preferring a direct binary
 * and falling back to npx with auto-approve if needed.
 */

import { spawn } from 'child_process';
import * as os from 'os';
import * as path from 'path';
import { Logger } from '../../../shared/logger';

const logger = new Logger('OpenCodeResolver');

// Common paths to look for opencode
const OPENCODE_PATHS = [
  '/usr/local/bin/opencode',
  '/usr/bin/opencode',
  '/opt/homebrew/bin/opencode',
  path.join(os.homedir(), '.local/bin/opencode'),
  path.join(os.homedir(), '.bun/bin/opencode'),
  path.join(os.homedir(), '.npm-global/bin/opencode'),
  // Windows paths
  ...(process.platform === 'win32' ? [
    path.join(os.homedir(), 'AppData', 'Roaming', 'npm', 'opencode.cmd'),
    path.join(os.homedir(), 'AppData', 'Roaming', 'npm', 'opencode'),
    path.join(os.homedir(), 'AppData', 'Local', 'Volta', 'bin', 'opencode.exe'),
    path.join(os.homedir(), 'scoop', 'shims', 'opencode.exe'),
  ] : []),
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
  ...(process.platform === 'win32' ? [
    path.join(os.homedir(), 'AppData', 'Roaming', 'npm', 'npx.cmd'),
    path.join(os.homedir(), 'AppData', 'Roaming', 'npm', 'npx'),
    path.join(os.homedir(), 'AppData', 'Local', 'Volta', 'bin', 'npx.exe'),
    path.join(os.homedir(), 'scoop', 'shims', 'npx.exe'),
  ] : []),
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

async function findBinaryInPath(binary: string): Promise<string | null> {
  return new Promise((resolve) => {
    const command = process.platform === 'win32' ? 'where' : 'which';
    const child = spawn(command, [binary], { windowsHide: true });

    let stdout = '';
    let stderr = '';
    const timeoutId = setTimeout(() => {
      child.kill();
      resolve(null);
    }, 3000);

    child.stdout.on('data', (data: Buffer) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    child.on('error', () => {
      clearTimeout(timeoutId);
      resolve(null);
    });

    child.on('close', (code) => {
      clearTimeout(timeoutId);
      if (code === 0 && stdout.trim().length > 0) {
        const firstPath = stdout.trim().split(/\r?\n/)[0].trim();
        resolve(firstPath || null);
        return;
      }
      if (stderr) {
        logger.debug('Path lookup stderr', { stderr });
      }
      resolve(null);
    });
  });
}

async function findNvmBinary(binary: string): Promise<string | null> {
  const { existsSync, readdirSync } = await import('fs');
  const nvmRoot = path.join(os.homedir(), '.nvm', 'versions', 'node');
  if (!existsSync(nvmRoot)) {
    return null;
  }

  try {
    const entries = readdirSync(nvmRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));

    for (const versionDir of entries) {
      const candidate = path.join(nvmRoot, versionDir, 'bin', binary);
      if (existsSync(candidate)) {
        return candidate;
      }
    }
  } catch (error) {
    logger.debug('Failed to scan nvm directories', { error: (error as Error).message });
  }

  return null;
}

async function findNpxPath(): Promise<string | null> {
  if (cachedNpxPath) {
    return cachedNpxPath;
  }

  const { existsSync } = await import('fs');

  for (const p of NPX_PATHS) {
    if (existsSync(p)) {
      cachedNpxPath = p;
      return p;
    }
  }

  const nvmPath = await findNvmBinary('npx');
  if (nvmPath) {
    cachedNpxPath = nvmPath;
    return nvmPath;
  }

  const pathFromEnv = await findBinaryInPath('npx');
  if (pathFromEnv) {
    cachedNpxPath = pathFromEnv;
    return pathFromEnv;
  }

  return null;
}

/**
 * Find the opencode executable path
 */
async function findOpenCodePath(): Promise<string | null> {
  if (cachedOpenCodePath) {
    return cachedOpenCodePath;
  }

  const { existsSync } = await import('fs');

  for (const p of OPENCODE_PATHS) {
    if (existsSync(p)) {
      cachedOpenCodePath = p;
      return p;
    }
  }

  const nvmPath = await findNvmBinary('opencode');
  if (nvmPath) {
    cachedOpenCodePath = nvmPath;
    return nvmPath;
  }

  const pathFromEnv = await findBinaryInPath('opencode');
  if (pathFromEnv) {
    cachedOpenCodePath = pathFromEnv;
    return pathFromEnv;
  }

  return null;
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
