/**
 * Codex command resolution
 *
 * Resolves the codex CLI and the Codex MCP server command. The Codex ACP
 * adapter is spawned by intentd, which owns its package pin — nothing here
 * resolves an adapter runtime.
 */

import * as os from 'os';
import * as path from 'path';
import { findBinary, getCommonNpmPaths } from '../../../shared/main/find-binary';

/**
 * Pinned Codex CLI version for the npx MCP-server fallback. Bumping it is a
 * deliberate code change.
 */
const CODEX_CLI_NPX_VERSION = '0.144.6';
export const CODEX_CLI_NPX_PACKAGE = `@openai/codex@${CODEX_CLI_NPX_VERSION}`;

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

let cachedCodexCliPath: string | null = null;
let cachedCodexMcpServerPath: string | null = null;
let cachedNpxPath: string | null = null;

/**
 * Clear cached paths to force re-detection on next check.
 * Call this when refreshing provider status.
 */
export function clearCodexCache(): void {
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
      args: ['-y', CODEX_CLI_NPX_PACKAGE, 'mcp-server'],
      usesNpx: true,
    };
  }

  return null;
}
