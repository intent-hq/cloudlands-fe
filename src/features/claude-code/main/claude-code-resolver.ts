/**
 * Claude Code command resolution
 *
 * Resolves the Claude Code ACP adapter command, preferring a direct binary
 * and falling back to npx with auto-approve if needed.
 */

import { spawn } from 'child_process';
import * as os from 'os';
import * as path from 'path';
import { Logger } from '../../../shared/logger';

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
 * Find the 'claude' CLI executable path (prerequisite for claude-code-acp)
 */
async function findClaudeCLIPath(): Promise<string | null> {
  if (cachedClaudeCodePath) {
    return cachedClaudeCodePath;
  }

  const { existsSync } = await import('fs');

  for (const p of CLAUDE_CLI_PATHS) {
    if (existsSync(p)) {
      cachedClaudeCodePath = p;
      return p;
    }
  }

  const nvmPath = await findNvmBinary('claude');
  if (nvmPath) {
    cachedClaudeCodePath = nvmPath;
    return nvmPath;
  }

  const pathFromEnv = await findBinaryInPath('claude');
  if (pathFromEnv) {
    cachedClaudeCodePath = pathFromEnv;
    return pathFromEnv;
  }

  return null;
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
