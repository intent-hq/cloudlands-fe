/**
 * Pi command resolution
 *
 * Detects the installed `pi` engine binary (availability keys off `pi`, not
 * `pi-acp`) and manages the pi-mcp-adapter package. The pi ACP adapter itself
 * is spawned — and pinned — by intentd.
 */

import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs/promises';
import { findBinary, getCommonNpmPaths } from '../../../shared/main/find-binary';
import { hostExec } from '../../../shared/main/host-exec';
import { m } from '../../../shared/paraglide/messages.js';

let cachedPiPath: string | null = null;

const PI_MCP_ADAPTER_PACKAGE = 'pi-mcp-adapter';
const PI_MCP_ADAPTER_INSTALL_SOURCE = `npm:${PI_MCP_ADAPTER_PACKAGE}`;

type PiSettings = {
  packages?: unknown;
};

/**
 * Clear cached paths to force re-detection on next check.
 * Call this when refreshing provider status.
 */
export function clearPiCache(): void {
  cachedPiPath = null;
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
    return { success: false, error: m.pi_resolver_cliNotFound_error() };
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
      error: (error as Error).message || m.pi_resolver_adapterInstallFailed_error(),
    };
  }
}

