/**
 * Pi command resolution
 *
 * Detects the installed `pi` engine binary (availability keys off `pi`, not
 * `pi-acp`). The adapter is always run via `npx -y pi-acp@<PI_ACP_VERSION>`
 * (the adapter's recommended zero-install path; `pi-acp` requires `pi` on PATH
 * anyway), so we do not require a globally-installed `pi-acp` binary.
 */

import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs/promises';
import {
  findBinary,
  getCommonNpmPaths,
} from '../../../shared/main/find-binary';
import { hostExec } from '../../../shared/main/host-exec';

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

const PI_MCP_ADAPTER_PACKAGE = 'pi-mcp-adapter';
const PI_MCP_ADAPTER_INSTALL_SOURCE = `npm:${PI_MCP_ADAPTER_PACKAGE}`;

/**
 * Pinned pi-acp adapter version for the npx launch path. The adapter is always
 * run via npx, so this pin controls the adapter release cadence — bumping it
 * is a deliberate code change.
 */
const PI_ACP_VERSION = '0.0.31';
export const PI_ACP_NPX_PACKAGE = `pi-acp@${PI_ACP_VERSION}`;

type PiSettings = {
  packages?: unknown;
};

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

function getPiAgentDir(): string {
  return process.env.PI_CODING_AGENT_DIR || path.join(os.homedir(), '.pi', 'agent');
}

function packageEntryMatchesPiMcpAdapter(entry: unknown): boolean {
  if (typeof entry !== 'string') return false;
  const normalized = entry.trim().replace(/^npm:/, '').split('@')[0];
  return normalized === PI_MCP_ADAPTER_PACKAGE;
}

async function isPiMcpAdapterInSettings(): Promise<boolean> {
  const settingsPath = path.join(getPiAgentDir(), 'settings.json');
  try {
    const raw = await fs.readFile(settingsPath, 'utf-8');
    const settings = JSON.parse(raw) as PiSettings;
    return Array.isArray(settings.packages)
      ? settings.packages.some(packageEntryMatchesPiMcpAdapter)
      : false;
  } catch {
    return false;
  }
}

/**
 * Check whether pi-mcp-adapter is installed in Pi's package manager.
 *
 * Pi loads packages from the agent settings file (`~/.pi/agent/settings.json`,
 * or `$PI_CODING_AGENT_DIR/settings.json`) where `pi install npm:<package>`
 * persists package sources in `packages[]`; the installed payload lives under
 * the agent package directory, but Pi only loads packages listed in settings.
 * Reading settings avoids spawning Pi on the hot path, with `pi list` as a
 * compatibility fallback if Pi changes the settings shape.
 */
export async function isPiMcpAdapterInstalled(): Promise<boolean> {
  if (await isPiMcpAdapterInSettings()) {
    return true;
  }

  const piPath = await getPiPath();
  if (!piPath) return false;

  try {
    const result = await hostExec(piPath, {
      args: ['list'],
      timeoutMs: 10_000,
    });
    if (result.timedOut || result.exitCode !== 0) {
      return false;
    }
    return result.stdout.split(/\r?\n/).some((line) => line.includes(PI_MCP_ADAPTER_PACKAGE));
  } catch {
    return false;
  }
}

export async function installPiMcpAdapter(): Promise<{ success: boolean; error?: string }> {
  const piPath = await getPiPath();
  if (!piPath) {
    return { success: false, error: 'Pi CLI not found. Please install Pi first.' };
  }

  try {
    const result = await hostExec(piPath, {
      args: ['install', PI_MCP_ADAPTER_INSTALL_SOURCE],
      timeoutMs: 120_000,
    });
    if (result.timedOut) {
      return { success: false, error: 'pi install timed out' };
    }
    if (result.exitCode !== 0) {
      return {
        success: false,
        error: result.stderr || `pi install exited with code ${result.exitCode}`,
      };
    }
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: (error as Error).message || 'Failed to install pi-mcp-adapter',
    };
  }
}

export type PiResolvedCommand = {
  command: string;
  argsPrefix: string[];
  usesNpx: boolean;
};

/**
 * Resolve the command to run the Pi adapter.
 * Always runs the adapter via `npx -y pi-acp@<PI_ACP_VERSION>`. Returns null
 * only when npx cannot be resolved.
 */
export async function resolvePiCommand(): Promise<PiResolvedCommand | null> {
  const npxPath = await findNpxPath();
  if (npxPath) {
    return {
      command: npxPath,
      argsPrefix: ['-y', PI_ACP_NPX_PACKAGE],
      usesNpx: true,
    };
  }

  return null;
}
