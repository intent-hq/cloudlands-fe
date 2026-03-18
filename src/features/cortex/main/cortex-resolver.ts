/**
 * Cortex command resolution
 *
 * Resolves the Cortex binary path for availability checking.
 * Cortex is a Snowflake coding agent that runs as a local binary.
 */

import * as os from 'os';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { Logger } from '../../../shared/logger';
import { findBinary, getCommonNpmPaths } from '../../../shared/main/find-binary';

const logger = new Logger('CortexResolver');

// Common paths to look for cortex binary
const CORTEX_PATHS = [
  path.join(os.homedir(), '.local/bin/cortex'),
  '/usr/local/bin/cortex',
  '/usr/bin/cortex',
  '/opt/homebrew/bin/cortex',
  path.join(os.homedir(), '.bun/bin/cortex'),
  path.join(os.homedir(), '.npm-global/bin/cortex'),
  // Windows paths
  ...(process.platform === 'win32' ? [
    path.join(os.homedir(), 'AppData', 'Roaming', 'npm', 'cortex.cmd'),
    path.join(os.homedir(), 'AppData', 'Roaming', 'npm', 'cortex'),
    path.join(os.homedir(), 'AppData', 'Local', 'Volta', 'bin', 'cortex.exe'),
    path.join(os.homedir(), 'scoop', 'shims', 'cortex.exe'),
  ] : []),
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
 * Find the cortex executable path
 */
async function findCortexPath(): Promise<string | null> {
  if (cachedCortexPath) {
    return cachedCortexPath;
  }

  const result = await findBinary('cortex', {
    commonPaths: [...CORTEX_PATHS, ...getCommonNpmPaths('cortex')],
    cache: false,
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
 */
export async function isCortexInstalled(): Promise<boolean> {
  const cortexPath = await findCortexPath();
  return cortexPath !== null;
}

/**
 * Get the resolved path to the cortex executable.
 * Returns null if not found.
 */
export async function getCortexPath(): Promise<string | null> {
  return findCortexPath();
}

/**
 * Resolve the path to the cortex-acp adapter script.
 * The adapter lives alongside this file in the source tree at
 * `src/features/cortex/cortex-acp/cortex-acp.ts` and is compiled to
 * the corresponding `.js` path in the dist output.
 */
function resolveCortexAcpScript(): string {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  return path.join(__dirname, '..', 'cortex-acp', 'cortex-acp.js');
}

export type CortexResolvedCommand = {
  command: string;
  argsPrefix: string[];
};

/**
 * Resolve the command to run Cortex ACP.
 * Returns the node command with the path to the cortex-acp adapter script.
 * The cortex CLI must be installed as a prerequisite (the adapter spawns it).
 */
export async function resolveCortexCommand(): Promise<CortexResolvedCommand | null> {
  const cortexCliPath = await findCortexPath();
  if (!cortexCliPath) {
    logger.warn('Cortex CLI not found — cortex-acp adapter requires the cortex CLI');
    return null;
  }

  const acpScript = resolveCortexAcpScript();
  logger.debug('Resolved cortex-acp script', { acpScript });

  return {
    command: process.execPath, // node
    argsPrefix: [acpScript],
  };
}

