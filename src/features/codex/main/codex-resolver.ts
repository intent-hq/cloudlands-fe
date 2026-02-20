/**
 * Codex command resolution
 *
 * Resolves the Codex ACP adapter command, preferring a direct binary
 * and falling back to npx with auto-approve if needed.
 */

import { spawn } from 'child_process';
import * as os from 'os';
import * as path from 'path';
import { Logger } from '../../../shared/logger';

const logger = new Logger('CodexResolver');

// Common paths to look for codex-acp
const CODEX_PATHS = [
  '/usr/local/bin/codex-acp',
  '/usr/bin/codex-acp',
  '/opt/homebrew/bin/codex-acp',
  path.join(os.homedir(), '.local/bin/codex-acp'),
  path.join(os.homedir(), '.bun/bin/codex-acp'),
  path.join(os.homedir(), '.npm-global/bin/codex-acp'),
  // Windows paths
  ...(process.platform === 'win32' ? [
    path.join(os.homedir(), 'AppData', 'Roaming', 'npm', 'codex-acp.cmd'),
    path.join(os.homedir(), 'AppData', 'Roaming', 'npm', 'codex-acp'),
    path.join(os.homedir(), 'AppData', 'Local', 'Volta', 'bin', 'codex-acp.exe'),
    path.join(os.homedir(), 'scoop', 'shims', 'codex-acp.exe'),
  ] : []),
];

// Common paths to look for codex CLI
const CODEX_CLI_PATHS = [
  '/usr/local/bin/codex',
  '/usr/bin/codex',
  '/opt/homebrew/bin/codex',
  path.join(os.homedir(), '.local/bin/codex'),
  path.join(os.homedir(), '.bun/bin/codex'),
  path.join(os.homedir(), '.npm-global/bin/codex'),
  // Windows paths
  ...(process.platform === 'win32' ? [
    path.join(os.homedir(), 'AppData', 'Roaming', 'npm', 'codex.cmd'),
    path.join(os.homedir(), 'AppData', 'Roaming', 'npm', 'codex'),
    path.join(os.homedir(), 'AppData', 'Local', 'Volta', 'bin', 'codex.exe'),
    path.join(os.homedir(), 'scoop', 'shims', 'codex.exe'),
  ] : []),
];

// Common paths to look for codex MCP server binary
const CODEX_MCP_SERVER_PATHS = [
  '/usr/local/bin/codex-mcp-server',
  '/usr/bin/codex-mcp-server',
  '/opt/homebrew/bin/codex-mcp-server',
  path.join(os.homedir(), '.local/bin/codex-mcp-server'),
  path.join(os.homedir(), '.bun/bin/codex-mcp-server'),
  path.join(os.homedir(), '.npm-global/bin/codex-mcp-server'),
  // Windows paths
  ...(process.platform === 'win32' ? [
    path.join(os.homedir(), 'AppData', 'Roaming', 'npm', 'codex-mcp-server.cmd'),
    path.join(os.homedir(), 'AppData', 'Roaming', 'npm', 'codex-mcp-server'),
    path.join(os.homedir(), 'AppData', 'Local', 'Volta', 'bin', 'codex-mcp-server.exe'),
    path.join(os.homedir(), 'scoop', 'shims', 'codex-mcp-server.exe'),
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

let cachedCodexPath: string | null = null;
let cachedCodexCliPath: string | null = null;
let cachedCodexMcpServerPath: string | null = null;
let cachedNpxPath: string | null = null;

/**
 * Clear cached paths to force re-detection on next check.
 * Call this when refreshing provider status.
 */
export function clearCodexCache(): void {
  cachedCodexPath = null;
  cachedCodexCliPath = null;
  cachedCodexMcpServerPath = null;
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
 * Find the codex-acp executable path
 */
async function findCodexPath(): Promise<string | null> {
  if (cachedCodexPath) {
    return cachedCodexPath;
  }

  const { existsSync } = await import('fs');

  for (const p of CODEX_PATHS) {
    if (existsSync(p)) {
      cachedCodexPath = p;
      return p;
    }
  }

  const nvmPath = await findNvmBinary('codex-acp');
  if (nvmPath) {
    cachedCodexPath = nvmPath;
    return nvmPath;
  }

  const pathFromEnv = await findBinaryInPath('codex-acp');
  if (pathFromEnv) {
    cachedCodexPath = pathFromEnv;
    return pathFromEnv;
  }

  return null;
}

/**
 * Find the codex CLI executable path
 */
async function findCodexCliPath(): Promise<string | null> {
  if (cachedCodexCliPath) {
    return cachedCodexCliPath;
  }

  const { existsSync } = await import('fs');

  for (const p of CODEX_CLI_PATHS) {
    if (existsSync(p)) {
      cachedCodexCliPath = p;
      return p;
    }
  }

  const nvmPath = await findNvmBinary('codex');
  if (nvmPath) {
    cachedCodexCliPath = nvmPath;
    return nvmPath;
  }

  const pathFromEnv = await findBinaryInPath('codex');
  if (pathFromEnv) {
    cachedCodexCliPath = pathFromEnv;
    return pathFromEnv;
  }

  return null;
}

/**
 * Find the codex MCP server executable path
 */
async function findCodexMcpServerPath(): Promise<string | null> {
  if (cachedCodexMcpServerPath) {
    return cachedCodexMcpServerPath;
  }

  const { existsSync } = await import('fs');

  for (const p of CODEX_MCP_SERVER_PATHS) {
    if (existsSync(p)) {
      cachedCodexMcpServerPath = p;
      return p;
    }
  }

  const nvmPath = await findNvmBinary('codex-mcp-server');
  if (nvmPath) {
    cachedCodexMcpServerPath = nvmPath;
    return nvmPath;
  }

  const pathFromEnv = await findBinaryInPath('codex-mcp-server');
  if (pathFromEnv) {
    cachedCodexMcpServerPath = pathFromEnv;
    return pathFromEnv;
  }

  return null;
}

export type CodexResolvedCommand = {
  command: string;
  argsPrefix: string[];
  usesNpx: boolean;
};

/**
 * Check if codex is directly installed (not via npx fallback).
 * Used for accurate status detection in the provider status panel.
 */
export async function isCodexInstalled(): Promise<boolean> {
  const codexPath = await findCodexCliPath();
  return codexPath !== null;
}

/**
 * Get the resolved path to the 'codex' CLI executable.
 * Returns null if not found.
 */
export async function getCodexPath(): Promise<string | null> {
  return findCodexCliPath();
}

/**
 * Resolve the command to run Codex ACP.
 * Prefer a direct binary, fall back to npx with auto-approve.
 */
export async function resolveCodexCommand(): Promise<CodexResolvedCommand | null> {
  const codexPath = await findCodexPath();
  if (codexPath) {
    return { command: codexPath, argsPrefix: [], usesNpx: false };
  }

  const npxPath = await findNpxPath();
  if (npxPath) {
    return {
      command: npxPath,
      argsPrefix: ['-y', '@zed-industries/codex-acp'],
      usesNpx: true,
    };
  }

  return null;
}

export type CodexResolvedMcpCommand = {
  command: string;
  args: string[];
  usesNpx: boolean;
};

/**
 * Resolve the command to run Codex MCP server.
 * Prefer a dedicated MCP server binary, then codex CLI, then npx.
 */
export async function resolveCodexMcpCommand(): Promise<CodexResolvedMcpCommand | null> {
  const mcpPath = await findCodexMcpServerPath();
  if (mcpPath) {
    return { command: mcpPath, args: [], usesNpx: false };
  }

  const cliPath = await findCodexCliPath();
  if (cliPath) {
    return { command: cliPath, args: ['mcp-server'], usesNpx: false };
  }

  const npxPath = await findNpxPath();
  if (npxPath) {
    return {
      command: npxPath,
      args: ['-y', '@openai/codex', 'mcp-server'],
      usesNpx: true,
    };
  }

  return null;
}
