/**
 * Claude Code command resolution
 *
 * Resolves the Claude Code ACP adapter command. The adapter always runs via
 * npx with a pinned package version so every install executes the same,
 * release-cadence-controlled adapter — direct claude-agent-acp binaries are
 * intentionally not probed. The 'claude' CLI remains a prerequisite.
 */

import * as os from 'os';
import * as path from 'path';
import { Logger } from '../../../shared/logger';
import {
  findBinary,
  getCommonNpmPaths,
} from '../../../shared/main/find-binary';
import { CLAUDE_AGENT_ACP_NPX_SPEC } from '../../../shared/constants/claude-code';

const logger = new Logger('ClaudeCodeResolver');

export {
  CLAUDE_AGENT_ACP_NPX_SPEC,
  CLAUDE_AGENT_ACP_PACKAGE,
  CLAUDE_AGENT_ACP_VERSION,
  CLAUDE_CODE_NPX_MISSING_WARNING,
} from '../../../shared/constants/claude-code';

// Common paths to look for the 'claude' CLI binary (prerequisite for claude-agent-acp)
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
    path.join(os.homedir(), '.local', 'bin', 'claude.exe'),
    path.join(os.homedir(), '.local', 'bin', 'claude.cmd'),
    path.join(os.homedir(), '.local', 'bin', 'claude'),
  ] : []),
];

// Common paths to look for npx (the adapter always runs through npx)
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
 * Find the 'claude' CLI executable path (prerequisite for claude-agent-acp)
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
 * Detailed resolution result so callers can distinguish "claude CLI missing"
 * from "npx missing" and surface the right user-facing warning.
 */
export type ClaudeCodeResolution =
  | { ok: true; resolved: ClaudeCodeResolvedCommand }
  | { ok: false; reason: 'claude-cli-missing' | 'npx-missing' };

/**
 * Check if the 'claude' CLI is installed (prerequisite for claude-agent-acp).
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
 * Check whether npx is available for running the Claude Code ACP adapter.
 */
export async function isNpxAvailableForClaudeCode(): Promise<boolean> {
  return (await findNpxPath()) !== null;
}

/**
 * Resolve the command to run Claude Code ACP with an explicit failure reason.
 * The 'claude' CLI must be installed as a prerequisite; the adapter itself
 * always runs via `npx -y <package>@<pinned version>` — direct binaries are
 * never used, so every install runs the pinned adapter release.
 */
export async function resolveClaudeCodeCommandDetailed(): Promise<ClaudeCodeResolution> {
  // Check if 'claude' CLI is installed (prerequisite)
  const claudeCLIPath = await findClaudeCLIPath();
  if (!claudeCLIPath) {
    logger.warn('Claude CLI not found - claude-agent-acp requires the claude CLI to be installed');
    return { ok: false, reason: 'claude-cli-missing' };
  }

  const npxPath = await findNpxPath();
  if (!npxPath) {
    logger.warn('npx not found - cannot run claude-agent-acp');
    return { ok: false, reason: 'npx-missing' };
  }

  return {
    ok: true,
    resolved: {
      command: npxPath,
      argsPrefix: ['-y', CLAUDE_AGENT_ACP_NPX_SPEC],
      usesNpx: true,
    },
  };
}

/**
 * Resolve the command to run Claude Code ACP.
 * Returns null when the claude CLI or npx is missing; use
 * `resolveClaudeCodeCommandDetailed()` when the failure reason matters.
 */
export async function resolveClaudeCodeCommand(): Promise<ClaudeCodeResolvedCommand | null> {
  const resolution = await resolveClaudeCodeCommandDetailed();
  return resolution.ok ? resolution.resolved : null;
}
