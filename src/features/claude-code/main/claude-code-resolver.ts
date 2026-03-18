/**
 * Claude Code command resolution
 *
 * Resolves the Claude Code ACP adapter command, preferring a direct binary
 * and falling back to npx with auto-approve if needed.
 */

import * as os from 'os';
import * as path from 'path';
import { Logger } from '../../../shared/logger';
import { findBinary, getCommonNpmPaths } from '../../../shared/main/find-binary';

const logger = new Logger('ClaudeCodeResolver');

// Common paths to look for the 'claude' CLI binary (prerequisite for claude-code-acp)
const CLAUDE_CLI_PATHS = [
  '/usr/local/bin/claude',
  '/usr/bin/claude',
  '/opt/homebrew/bin/claude',
  path.join(os.homedir(), '.local/bin/claude'),
  path.join(os.homedir(), '.bun/bin/claude'),
  path.join(os.homedir(), '.npm-global/bin/claude'),
  // Windows paths
  ...(process.platform === 'win32' ? [
    path.join(os.homedir(), 'AppData', 'Roaming', 'npm', 'claude.cmd'),
    path.join(os.homedir(), 'AppData', 'Roaming', 'npm', 'claude'),
    path.join(os.homedir(), 'AppData', 'Local', 'Volta', 'bin', 'claude.exe'),
    path.join(os.homedir(), 'scoop', 'shims', 'claude.exe'),
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

let cachedClaudeCodePath: string | null = null;
let cachedNpxPath: string | null = null;

/**
 * Clear cached paths to force re-detection on next check.
 * Call this when refreshing provider status.
 */
export function clearClaudeCodeCache(): void {
  cachedClaudeCodePath = null;
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
 * Find the 'claude' CLI executable path (prerequisite for claude-code-acp)
 */
async function findClaudeCLIPath(): Promise<string | null> {
  if (cachedClaudeCodePath) {
    return cachedClaudeCodePath;
  }

  const result = await findBinary('claude', {
    commonPaths: [...CLAUDE_CLI_PATHS, ...getCommonNpmPaths('claude')],
    cache: false,
    timeout: 3000,
    useEnhancedPath: false,
    useLoginShell: false,
  });

  if (result) {
    cachedClaudeCodePath = result;
  }

  return result;
}

export type ClaudeCodeResolvedCommand = {
  command: string;
  argsPrefix: string[];
  usesNpx: boolean;
};

/**
 * Check if the 'claude' CLI is installed (prerequisite for claude-code-acp).
 * Used for accurate status detection in the provider status panel.
 */
export async function isClaudeCodeInstalled(): Promise<boolean> {
  const claudeCLIPath = await findClaudeCLIPath();
  return claudeCLIPath !== null;
}

/**
 * Get the resolved path to the 'claude' CLI executable.
 * Returns null if not found.
 */
export async function getClaudeCodePath(): Promise<string | null> {
  return findClaudeCLIPath();
}

/**
 * Resolve the command to run Claude Code ACP.
 * The 'claude' CLI must be installed as a prerequisite.
 * We always use npx @zed-industries/claude-code-acp as the ACP adapter.
 */
export async function resolveClaudeCodeCommand(): Promise<ClaudeCodeResolvedCommand | null> {
  // Check if 'claude' CLI is installed (prerequisite)
  const claudeCLIPath = await findClaudeCLIPath();
  if (!claudeCLIPath) {
    logger.warn('Claude CLI not found - claude-code-acp requires the claude CLI to be installed');
    return null;
  }

  // Always use npx to run the ACP adapter
  const npxPath = await findNpxPath();
  if (npxPath) {
    return {
      command: npxPath,
      argsPrefix: ['-y', '@zed-industries/claude-code-acp'],
      usesNpx: true,
    };
  }

  logger.warn('npx not found - cannot run claude-code-acp');
  return null;
}
