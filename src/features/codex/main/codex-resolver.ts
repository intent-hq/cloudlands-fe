/**
 * Codex command resolution
 *
 * Resolves the Codex ACP adapter command, preferring a direct binary
 * and falling back to npx with auto-approve if needed.
 */

import * as os from 'os';
import * as path from 'path';
import {
  findBinary,
  getCommonNpmPaths,
} from '../../../shared/main/find-binary';
import { execFileAsync } from '../../../shared/main/async-utils';
import { ensureManagedCodexAcp, MANAGED_CODEX_ACP_VERSION } from './codex-acp-manager';

/**
 * Pinned npx fallback for the Codex ACP adapter. Reuses the managed runtime
 * version so the last-resort npx path runs the same adapter release as the
 * managed install. intentd pins the same package/version in
 * `intent-providers/src/config.rs`.
 */
export const CODEX_ACP_NPX_PACKAGE = `@agentclientprotocol/codex-acp@${MANAGED_CODEX_ACP_VERSION}`;

/**
 * Pinned Codex CLI version for the npx MCP-server fallback. Bumping it is a
 * deliberate code change.
 */
const CODEX_CLI_NPX_VERSION = '0.144.6';
export const CODEX_CLI_NPX_PACKAGE = `@openai/codex@${CODEX_CLI_NPX_VERSION}`;

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
let cachedCodexAppServerVersionProbe: CodexAppServerVersionProbeResult | null = null;

export const MINIMUM_CODEX_APP_SERVER_VERSION = '0.128.0';
const CODEX_APP_SERVER_VERSION_TIMEOUT_MS = 1500;

/**
 * Clear cached paths to force re-detection on next check.
 * Call this when refreshing provider status.
 */
export function clearCodexCache(): void {
  cachedCodexPath = null;
  cachedCodexCliPath = null;
  cachedCodexMcpServerPath = null;
  cachedNpxPath = null;
  cachedCodexAppServerVersionProbe = null;
}

export type CodexAppServerVersionProbeResult =
  | { ok: true; version: string }
  | { ok: false; reason: string };

type CodexVersionProbeError = Error & {
  code?: string | number | null;
  killed?: boolean;
};

function parseCodexCliVersion(output: string): string | null {
  const match = output.match(
    /codex(?:-cli)?\s+([0-9]+\.[0-9]+\.[0-9]+)(?:[-+][0-9A-Za-z.-]+)?(?:\s|$)/i,
  );
  return match?.[1] ?? null;
}

function parseSemverCore(version: string): [number, number, number] | null {
  const match = version.match(/^([0-9]+)\.([0-9]+)\.([0-9]+)(?:[-+][0-9A-Za-z.-]+)?$/);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function compareSemver(a: string, b: string): number {
  const left = parseSemverCore(a);
  const right = parseSemverCore(b);
  if (!left && !right) return 0;
  if (!left) return -1;
  if (!right) return 1;
  for (let i = 0; i < 3; i += 1) {
    const diff = left[i] - right[i];
    if (diff !== 0) return diff;
  }
  return 0;
}

export async function probeCodexAppServerVersion(
  codexCliPath: string,
): Promise<CodexAppServerVersionProbeResult> {
  if (cachedCodexAppServerVersionProbe) return cachedCodexAppServerVersionProbe;

  try {
    const result = await execFileAsync(codexCliPath, ['--version'], {
      encoding: 'utf8',
      timeout: CODEX_APP_SERVER_VERSION_TIMEOUT_MS,
    });

    const version = parseCodexCliVersion(`${result.stdout || ''}\n${result.stderr || ''}`);
    const probeResult: CodexAppServerVersionProbeResult = version
      ? { ok: true, version }
      : { ok: false, reason: 'Unable to parse codex CLI version' };
    if (probeResult.ok) cachedCodexAppServerVersionProbe = probeResult;
    return probeResult;
  } catch (error) {
    const probeError = error as CodexVersionProbeError;
    let reason = probeError.message;
    if (probeError.code === 'ENOENT') {
      reason = 'codex CLI not found';
    } else if (typeof probeError.code === 'number') {
      reason = `codex --version exited with status ${probeError.code}`;
    } else if (probeError.killed) {
      reason = `codex --version timed out after ${CODEX_APP_SERVER_VERSION_TIMEOUT_MS}ms`;
    }
    return { ok: false, reason };
  }
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

export type CodexModelListCommandSource =
  | 'codex-app-server'
  | 'managed-codex-acp'
  | 'codex-acp'
  | 'npx-codex-acp';

export type CodexResolvedModelListCommand = CodexResolvedCommand & {
  source: CodexModelListCommandSource;
  codexCliVersion?: string;
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
      argsPrefix: ['-y', CODEX_ACP_NPX_PACKAGE],
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

  const codexCliPath = await findCodexCliPath();
  const versionProbe = codexCliPath ? await probeCodexAppServerVersion(codexCliPath) : null;
  if (
    codexCliPath &&
    versionProbe?.ok &&
    compareSemver(versionProbe.version, MINIMUM_CODEX_APP_SERVER_VERSION) >= 0
  ) {
    candidates.push({
      command: codexCliPath,
      argsPrefix: ['app-server', '--listen', 'stdio://'],
      usesNpx: false,
      source: 'codex-app-server',
      codexCliVersion: versionProbe.version,
    });
  }

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
      argsPrefix: ['-y', CODEX_ACP_NPX_PACKAGE],
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
      args: ['-y', CODEX_CLI_NPX_PACKAGE, 'mcp-server'],
      usesNpx: true,
    };
  }

  return null;
}
