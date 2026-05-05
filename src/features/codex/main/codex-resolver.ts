/**
 * Codex command resolution
 *
 * Resolves the Codex ACP adapter command, preferring a direct binary
 * and falling back to npx with auto-approve if needed.
 */

import * as os from 'os';
import * as path from 'path';
import { findBinary, getCommonNpmPaths } from '../../../shared/main/find-binary';
import { ensureManagedCodexAcp } from './codex-acp-manager';

// Common paths to look for codex-acp
const CODEX_PATHS = [
  '/usr/local/bin/codex-acp',
  '/usr/bin/codex-acp',
  '/opt/homebrew/bin/codex-acp',
  path.join(os.homedir(), '.local/bin/codex-acp'),
  path.join(os.homedir(), '.bun/bin/codex-acp'),
  path.join(os.homedir(), '.npm-global/bin/codex-acp'),
  // Windows paths
  ...(process.platform === 'win32'
    ? [
        path.join(os.homedir(), 'AppData', 'Roaming', 'npm', 'codex-acp.cmd'),
        path.join(os.homedir(), 'AppData', 'Roaming', 'npm', 'codex-acp'),
        path.join(os.homedir(), 'AppData', 'Local', 'Volta', 'bin', 'codex-acp.exe'),
        path.join(os.homedir(), 'scoop', 'shims', 'codex-acp.exe'),
        path.join(os.homedir(), '.local', 'bin', 'codex-acp.exe'),
        path.join(os.homedir(), '.local', 'bin', 'codex-acp.cmd'),
        path.join(os.homedir(), '.local', 'bin', 'codex-acp'),
      ]
    : []),
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
  ...(process.platform === 'win32'
    ? [
        path.join(os.homedir(), 'AppData', 'Roaming', 'npm', 'codex.cmd'),
        path.join(os.homedir(), 'AppData', 'Roaming', 'npm', 'codex'),
        path.join(os.homedir(), 'AppData', 'Local', 'Volta', 'bin', 'codex.exe'),
        path.join(os.homedir(), 'scoop', 'shims', 'codex.exe'),
        path.join(os.homedir(), '.local', 'bin', 'codex.exe'),
        path.join(os.homedir(), '.local', 'bin', 'codex.cmd'),
        path.join(os.homedir(), '.local', 'bin', 'codex'),
      ]
    : []),
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
  ...(process.platform === 'win32'
    ? [
        path.join(os.homedir(), 'AppData', 'Roaming', 'npm', 'codex-mcp-server.cmd'),
        path.join(os.homedir(), 'AppData', 'Roaming', 'npm', 'codex-mcp-server'),
        path.join(os.homedir(), 'AppData', 'Local', 'Volta', 'bin', 'codex-mcp-server.exe'),
        path.join(os.homedir(), 'scoop', 'shims', 'codex-mcp-server.exe'),
        path.join(os.homedir(), '.local', 'bin', 'codex-mcp-server.exe'),
        path.join(os.homedir(), '.local', 'bin', 'codex-mcp-server.cmd'),
        path.join(os.homedir(), '.local', 'bin', 'codex-mcp-server'),
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
 * Find the codex-acp executable path
 */
async function findCodexPath(): Promise<string | null> {
  if (cachedCodexPath) {
    return cachedCodexPath;
  }

  const result = await findBinary('codex-acp', {
    commonPaths: [...CODEX_PATHS, ...getCommonNpmPaths('codex-acp')],
    cache: false,
    timeout: 3000,
    useEnhancedPath: false,
    useLoginShell: false,
  });

  if (result) {
    cachedCodexPath = result;
  }

  return result;
}

/**
 * Find the codex CLI executable path
 */
async function findCodexCliPath(): Promise<string | null> {
  if (cachedCodexCliPath) {
    return cachedCodexCliPath;
  }

  const result = await findBinary('codex', {
    commonPaths: [...CODEX_CLI_PATHS, ...getCommonNpmPaths('codex')],
    cache: false,
    timeout: 3000,
    useEnhancedPath: false,
    useLoginShell: false,
  });

  if (result) {
    cachedCodexCliPath = result;
  }

  return result;
}

/**
 * Find the codex MCP server executable path
 */
async function findCodexMcpServerPath(): Promise<string | null> {
  if (cachedCodexMcpServerPath) {
    return cachedCodexMcpServerPath;
  }

  const result = await findBinary('codex-mcp-server', {
    commonPaths: [...CODEX_MCP_SERVER_PATHS, ...getCommonNpmPaths('codex-mcp-server')],
    cache: false,
    timeout: 3000,
    useEnhancedPath: false,
    useLoginShell: false,
  });

  if (result) {
    cachedCodexMcpServerPath = result;
  }

  return result;
}

export type CodexResolvedCommand = {
  command: string;
  argsPrefix: string[];
  usesNpx: boolean;
  env?: Record<string, string>;
};

export type CodexModelListCommandSource = 'managed-codex-acp' | 'codex-acp' | 'npx-codex-acp';

export type CodexResolvedModelListCommand = CodexResolvedCommand & {
  source: CodexModelListCommandSource;
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

async function resolveManagedCodexAcpCommand(): Promise<CodexResolvedCommand | null> {
  try {
    const { wrapperPath } = await ensureManagedCodexAcp();
    return {
      command: process.execPath,
      argsPrefix: [wrapperPath],
      usesNpx: false,
      env: { ELECTRON_RUN_AS_NODE: '1' },
    };
  } catch {
    return null;
  }
}

/**
 * Resolve the command to run Codex ACP.
 * Prefer a direct binary, fall back to npx with auto-approve.
 */
export async function resolveCodexCommand(): Promise<CodexResolvedCommand | null> {
  const managedCommand = await resolveManagedCodexAcpCommand();
  if (managedCommand) {
    return managedCommand;
  }

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

/**
 * Resolve ordered candidates for dynamic Codex model listing.
 *
 * Prefer the managed Codex ACP runtime, then a user-installed codex-acp binary,
 * then the npx bridge.
 */
export async function resolveCodexModelListCommands(): Promise<CodexResolvedModelListCommand[]> {
  const candidates: CodexResolvedModelListCommand[] = [];

  const managedCommand = await resolveManagedCodexAcpCommand();
  if (managedCommand) {
    candidates.push({ ...managedCommand, source: 'managed-codex-acp' });
  }

  const codexPath = await findCodexPath();
  if (codexPath) {
    candidates.push({ command: codexPath, argsPrefix: [], usesNpx: false, source: 'codex-acp' });
  }

  const npxPath = await findNpxPath();
  if (npxPath) {
    candidates.push({
      command: npxPath,
      argsPrefix: ['-y', '@zed-industries/codex-acp'],
      usesNpx: true,
      source: 'npx-codex-acp',
    });
  }

  return candidates;
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
