/**
 * SSH IPC Handlers
 *
 * Handles SSH operations for remote file system access.
 * Uses the real SSHManager for actual SSH connections.
 */

import { ipcMain } from 'electron';
import { createSafeValidatedHandler } from '../../../main/ipc-validation-middleware';
import { z } from 'zod';
import { Logger } from '../../../shared/logger';
import { sshManager } from '../../../shared/main/ssh-manager';
import { remoteRPCManager } from '../../../shared/main/remote-rpc-manager';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { hostExec } from '../../../shared/main/host-exec';
import SSHConfig, { LineType } from 'ssh-config';

interface ExecError extends Error {
  code?: number;
  stdout?: string;
  stderr?: string;
}

/**
 * SSH-agent / key discovery probes are routed through the daemon's `host.exec`
 * seam (PROTOCOL.md §5.14) — the FE no longer spawns `child_process`. The
 * wrapper preserves the legacy `promisify(exec)` contract call-sites rely on:
 * resolves `{ stdout, stderr }` on exit 0; on non-zero exit throws an Error
 * carrying `.code` / `.stdout` / `.stderr` so degrade-on-failure branches
 * (notably `ssh-add -l` exit 1 when the agent has no identities) still work.
 */
async function execAsync(command: string): Promise<{ stdout: string; stderr: string }> {
  const [shellCmd, shellFlag] =
    process.platform === 'win32' ? ['cmd.exe', '/c'] : ['/bin/sh', '-c'];
  const result = await hostExec(shellCmd, { args: [shellFlag, command] });
  if (result.exitCode !== 0) {
    const err = new Error(`Command failed: ${command}\n${result.stderr}`) as ExecError;
    err.stdout = result.stdout;
    err.stderr = result.stderr;
    err.code = result.exitCode;
    throw err;
  }
  return { stdout: result.stdout, stderr: result.stderr };
}

const logger = new Logger('SSH-IPC');

// ==================== SSH Config Parsing ====================

interface SSHConfigHost {
  name: string; // Host alias (e.g., "dev-server")
  hostname: string; // Actual hostname (e.g., "dev.example.com")
  user?: string;
  port?: number;
  identityFile?: string;
}

/**
 * Expand a simple glob pattern (supporting * and ?) against a directory listing.
 * Returns matching file paths sorted lexically, as OpenSSH specifies.
 */
async function expandGlob(pattern: string): Promise<string[]> {
  const dir = path.dirname(pattern);
  const base = path.basename(pattern);

  // If no glob characters in the basename, return the pattern as-is
  if (!base.includes('*') && !base.includes('?')) {
    return [pattern];
  }

  // Convert glob pattern to regex: * -> .*, ? -> ., escape the rest
  const regexStr = '^' + base.replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.') + '$';
  const regex = new RegExp(regexStr);

  try {
    const entries = await fs.promises.readdir(dir);
    const matched = entries.filter((e) => regex.test(e)).sort();
    return matched.map((e) => path.join(dir, e));
  } catch {
    // Directory doesn't exist or is inaccessible
    return [];
  }
}

/**
 * Resolve Include directives in SSH config content.
 * Reads included files, expands globs, and returns the fully merged config.
 *
 * Per OpenSSH spec:
 * - `~` expands to the user's home directory
 * - Relative paths are resolved relative to ~/.ssh/
 * - Glob patterns are resolved in lexical order
 */
async function resolveSSHConfigIncludes(
  configContent: string,
  visitedFiles: Set<string> = new Set(),
): Promise<string> {
  const lines = configContent.split('\n');
  const resultLines: string[] = [];
  const sshDir = path.join(os.homedir(), '.ssh');

  for (const line of lines) {
    const trimmedLine = line.trim();

    // Skip comments and empty lines for Include detection
    if (trimmedLine.startsWith('#') || trimmedLine === '') {
      resultLines.push(line);
      continue;
    }

    // Check for Include directive
    const includeMatch = trimmedLine.match(/^include\s+(.+)$/i);
    if (!includeMatch) {
      resultLines.push(line);
      continue;
    }

    // OpenSSH allows multiple space-separated patterns on a single Include line.
    // Split by whitespace to handle each pattern separately.
    const patterns = includeMatch[1].trim().split(/\s+/);

    for (const rawPattern of patterns) {
      let includePath = rawPattern;

      // Remove surrounding quotes if present
      if ((includePath.startsWith('"') && includePath.endsWith('"')) ||
          (includePath.startsWith("'") && includePath.endsWith("'"))) {
        includePath = includePath.slice(1, -1);
      }

      // Expand ~ to home directory
      includePath = includePath.replace(/^~/, os.homedir());

      // Relative paths are relative to ~/.ssh/ per OpenSSH spec
      if (!path.isAbsolute(includePath)) {
        includePath = path.join(sshDir, includePath);
      }

      // Expand globs
      const matchedFiles = await expandGlob(includePath);

      for (const filePath of matchedFiles) {
        const resolvedPath = path.resolve(filePath);

        // Guard against circular includes
        if (visitedFiles.has(resolvedPath)) {
          continue;
        }

        try {
          visitedFiles.add(resolvedPath);
          const fileContent = await fs.promises.readFile(resolvedPath, 'utf8');
          // Recursively resolve includes in the included file
          const resolved = await resolveSSHConfigIncludes(fileContent, visitedFiles);
          resultLines.push(resolved);
        } catch {
          // File doesn't exist or can't be read — skip silently (OpenSSH does the same)
        }
      }
    }
  }

  return resultLines.join('\n');
}

/**
 * Parse SSH config content and extract host entries.
 * Uses the ssh-config package for proper parsing with OpenSSH
 * first-match-wins semantics via SSHConfig.parse() and .compute().
 */
function parseSSHConfig(configContent: string): SSHConfigHost[] {
  const config = SSHConfig.parse(configContent);
  const hosts: SSHConfigHost[] = [];
  const seen = new Set<string>();

  // Iterate over top-level directives to find Host sections
  for (const line of config) {
    if (line.type !== LineType.DIRECTIVE || line.param !== 'Host') {
      continue;
    }

    // Collect host names from the Host directive value
    const hostNames: string[] = [];
    if (typeof line.value === 'string') {
      // Single host name or space-separated names in a string
      for (const name of line.value.split(/\s+/)) {
        hostNames.push(name);
      }
    } else if (Array.isArray(line.value)) {
      // Multi-value Host directive (e.g., Host foo bar)
      for (const item of line.value) {
        hostNames.push(item.val);
      }
    }

    for (const hostName of hostNames) {
      // Skip wildcards and negations
      if (hostName.includes('*') || hostName.includes('?') || hostName.startsWith('!')) {
        continue;
      }

      // Deduplicate (a host name may appear in multiple Host directives)
      if (seen.has(hostName)) {
        continue;
      }
      seen.add(hostName);

      // Resolve effective config using first-match-wins semantics
      const resolved = config.compute(hostName);

      // Map IdentityFile: ssh-config returns string[] for repeatable directives
      let identityFile: string | undefined;
      if (resolved.IdentityFile) {
        const idFile = Array.isArray(resolved.IdentityFile)
          ? resolved.IdentityFile[0]
          : resolved.IdentityFile;
        if (idFile) {
          identityFile = idFile.replace(/^~/, os.homedir());
        }
      }

      // Map Port: ssh-config returns it as a string
      let port: number | undefined;
      if (resolved.Port) {
        const portStr = Array.isArray(resolved.Port) ? resolved.Port[0] : resolved.Port;
        const parsed = parseInt(portStr, 10);
        if (!isNaN(parsed)) {
          port = parsed;
        }
      }

      const hostname = Array.isArray(resolved.HostName)
        ? resolved.HostName[0]
        : resolved.HostName;
      const user = Array.isArray(resolved.User)
        ? resolved.User[0]
        : resolved.User;

      hosts.push({
        name: hostName,
        hostname: hostname ?? hostName,
        user: user || undefined,
        port,
        identityFile,
      });
    }
  }

  return hosts;
}

// ==================== SSH Key Discovery ====================

interface SSHKeyInfo {
  path: string;
  name: string;
  fingerprint?: string;
}

/**
 * Discover SSH keys in ~/.ssh/ directory
 */
async function discoverSSHKeys(): Promise<SSHKeyInfo[]> {
  const sshDir = path.join(os.homedir(), '.ssh');
  const keys: SSHKeyInfo[] = [];

  try {
    const files = await fs.promises.readdir(sshDir);

    // Common private key patterns (files without .pub extension that have matching .pub)
    const commonKeyNames = ['id_rsa', 'id_ed25519', 'id_ecdsa', 'id_dsa', 'identity'];
    const excludeNames = ['known_hosts', 'config', 'authorized_keys', 'known_hosts.old'];

    for (const file of files) {
      // Skip .pub files, known_hosts, config, etc.
      if (file.endsWith('.pub') || excludeNames.includes(file)) {
        continue;
      }

      const filePath = path.join(sshDir, file);
      const pubFilePath = filePath + '.pub';

      // Check if it's a private key (has matching .pub file)
      try {
        await fs.promises.access(pubFilePath);

        // It has a .pub file, so it's likely a private key
        const keyInfo: SSHKeyInfo = {
          path: filePath,
          name: file,
        };

        // Try to get fingerprint from .pub file
        try {
          const { stdout } = await execAsync(`ssh-keygen -lf "${pubFilePath}" 2>/dev/null`);
          const match = stdout.match(/^\d+\s+(\S+)/);
          if (match) {
            keyInfo.fingerprint = match[1];
          }
        } catch {
          // Fingerprint extraction failed, that's ok
        }

        keys.push(keyInfo);
      } catch {
        // No matching .pub file, check if it's a common key name
        if (commonKeyNames.includes(file)) {
          keys.push({
            path: filePath,
            name: file,
          });
        }
      }
    }

    // Sort keys: common names first, then alphabetically
    keys.sort((a, b) => {
      const aIsCommon = commonKeyNames.includes(a.name);
      const bIsCommon = commonKeyNames.includes(b.name);
      if (aIsCommon && !bIsCommon) return -1;
      if (!aIsCommon && bIsCommon) return 1;
      return a.name.localeCompare(b.name);
    });

    return keys;
  } catch (error) {
    logger.warn('Failed to read SSH directory', {
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

// ==================== SSH Agent Detection ====================

interface SSHAgentStatus {
  available: boolean;
  socketPath?: string;
  identities: Array<{
    fingerprint: string;
    comment: string;
    type: string;
  }>;
  error?: string;
}

/**
 * Check if SSH agent is available and list loaded identities
 */
async function getSSHAgentStatus(): Promise<SSHAgentStatus> {
  // Try multiple methods to find the SSH agent socket:
  // 1. SSH_AUTH_SOCK environment variable (standard)
  // 2. macOS launchd socket (for GUI apps that don't inherit shell env)
  let socketPath = process.env.SSH_AUTH_SOCK;

  logger.info('Checking SSH agent status', {
    SSH_AUTH_SOCK: socketPath || '(not set)',
    platform: process.platform,
  });

  // On macOS, GUI apps don't inherit shell environment variables.
  // Try to find the launchd-managed SSH agent socket.
  if (!socketPath && process.platform === 'darwin') {
    try {
      // macOS stores the launchd socket path - try to get it via launchctl
      const { stdout: launchdOutput } = await execAsync(
        'launchctl getenv SSH_AUTH_SOCK 2>/dev/null || true',
      );
      const trimmedPath = launchdOutput.trim();
      if (trimmedPath && trimmedPath !== '') {
        socketPath = trimmedPath;
        logger.info('Found SSH agent socket via launchctl', { socketPath });
      }
    } catch {
      // Fallback: check common macOS launchd socket locations
      try {
        const { stdout: globResult } = await execAsync(
          'ls -1d /private/tmp/com.apple.launchd.*/Listeners 2>/dev/null | head -1 || true',
        );
        const foundPath = globResult.trim();
        if (foundPath && foundPath !== '') {
          socketPath = foundPath;
          logger.info('Found SSH agent socket via glob', { socketPath });
        }
      } catch {
        // Continue without socket
      }
    }
  }

  if (!socketPath) {
    return {
      available: false,
      identities: [],
      error: 'SSH agent not found. On macOS, ensure you have run: ssh-add',
    };
  }

  try {
    // Check if socket exists
    await fs.promises.access(socketPath);

    // Run ssh-add -l to list identities
    // On macOS, we need to set SSH_AUTH_SOCK for the ssh-add command if it wasn't in our env
    const envPrefix = process.env.SSH_AUTH_SOCK ? '' : `SSH_AUTH_SOCK="${socketPath}" `;
    const { stdout } = await execAsync(`${envPrefix}ssh-add -l 2>&1`);

    const identities: SSHAgentStatus['identities'] = [];

    // Parse output: "256 SHA256:xxx... comment (type)"
    const lines = stdout.split('\n').filter((line) => line.trim());
    for (const line of lines) {
      // Handle "The agent has no identities."
      if (line.includes('no identities')) {
        return {
          available: true,
          socketPath,
          identities: [],
        };
      }

      const match = line.match(/^\d+\s+(\S+)\s+(.*?)\s+\((\w+)\)$/);
      if (match) {
        identities.push({
          fingerprint: match[1],
          comment: match[2],
          type: match[3],
        });
      }
    }

    return {
      available: true,
      socketPath,
      identities,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    // With `ssh-add -l 2>&1` the "no identities" line lands on stdout, so the
    // wrapper's `err.stderr` (and hence `err.message`) is empty on exit 1 —
    // also inspect `.stdout` from the reconstructed exec contract.
    const errorStdout =
      typeof (error as { stdout?: unknown })?.stdout === 'string'
        ? ((error as { stdout: string }).stdout)
        : '';

    // ssh-add -l exits with code 1 when agent has no identities
    if (errorMessage.includes('no identities') || errorStdout.includes('no identities')) {
      return {
        available: true,
        socketPath,
        identities: [],
      };
    }

    return {
      available: false,
      socketPath,
      identities: [],
      error: errorMessage,
    };
  }
}

// Validation schemas
const TestConnectionSchema = z.object({
  host: z.string(),
  port: z.number().optional().default(22),
  username: z.string(),
  password: z.string().optional(),
  privateKey: z.string().optional(),
  privateKeyPath: z.string().optional(),
  useAgent: z.boolean().optional(),
  transport: z.enum(['ssh', 'websocket']).optional(),
  wsUrl: z.string().optional(),
});

const ListDirectorySchema = z.object({
  host: z.string().optional(),
  port: z.number().optional().default(22),
  username: z.string().optional(),
  password: z.string().optional(),
  privateKey: z.string().optional(),
  privateKeyPath: z.string().optional(),
  useAgent: z.boolean().optional(),
  transport: z.enum(['ssh', 'websocket']).optional(),
  wsUrl: z.string().optional(),
  path: z.string(),
  workspaceId: z.string().optional(),
});

/**
 * Register SSH IPC handlers
 */
export function registerSSHHandlers(): void {
  // Remove any existing handlers before registering to prevent duplicates
  const handlers = [
    'test_ssh_connection',
    'ssh:listDirectory',
    'ssh:get-config-hosts',
    'ssh:list-keys',
    'ssh:get-agent-status',
    'ssh:test-connection',
  ];

  // Remove existing handlers
  for (const channel of handlers) {
    try {
      ipcMain.removeHandler(channel);
    } catch {
      // Handler might not exist, that's ok
    }
  }

  // ==================== SSH Config Hosts ====================
  ipcMain.handle('ssh:get-config-hosts', async () => {
    try {
      const configPath = path.join(os.homedir(), '.ssh', 'config');
      const configContent = await fs.promises.readFile(configPath, 'utf8');

      // Resolve Include directives before parsing
      const visitedFiles = new Set<string>();
      visitedFiles.add(path.resolve(configPath));
      const resolvedContent = await resolveSSHConfigIncludes(configContent, visitedFiles);

      const hosts = parseSSHConfig(resolvedContent);

      logger.info('Parsed SSH config hosts', { count: hosts.length });

      return {
        success: true,
        hosts,
      };
    } catch (error) {
      // Config file might not exist
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return {
          success: true,
          hosts: [],
        };
      }

      logger.warn('Failed to parse SSH config', {
        error: error instanceof Error ? error.message : String(error),
      });

      return {
        success: false,
        hosts: [],
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  // ==================== SSH Key Discovery ====================
  ipcMain.handle('ssh:list-keys', async () => {
    try {
      const keys = await discoverSSHKeys();

      logger.info('Discovered SSH keys', { count: keys.length });

      return {
        success: true,
        keys,
      };
    } catch (error) {
      logger.warn('Failed to discover SSH keys', {
        error: error instanceof Error ? error.message : String(error),
      });

      return {
        success: false,
        keys: [],
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  // ==================== SSH Agent Status ====================
  ipcMain.handle('ssh:get-agent-status', async () => {
    try {
      const status = await getSSHAgentStatus();

      logger.info('Got SSH agent status', {
        available: status.available,
        identityCount: status.identities.length,
      });

      return {
        success: true,
        ...status,
      };
    } catch (error) {
      logger.warn('Failed to get SSH agent status', {
        error: error instanceof Error ? error.message : String(error),
      });

      return {
        success: false,
        available: false,
        identities: [],
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  // Test SSH connection - uses real SSHManager
  ipcMain.handle(
    'test_ssh_connection',
    createSafeValidatedHandler(
      TestConnectionSchema,
      async (_event, config) => {
        const connectionId = `test-${Date.now()}`;

        try {
          logger.info('Testing SSH connection', { host: config.host, username: config.username });

          // Validate that we have at least one auth method
          if (
            !config.password &&
            !config.privateKey &&
            !config.privateKeyPath &&
            !config.useAgent
          ) {
            return {
              success: false,
              error:
                'No authentication method provided. Please provide a password, private key, or enable SSH agent.',
            };
          }

          // Attempt real SSH connection
          await sshManager.connect(connectionId, {
            host: config.host,
            port: config.port || 22,
            username: config.username,
            password: config.password,
            privateKey: config.privateKey,
            privateKeyPath: config.privateKeyPath,
            useAgent: config.useAgent,
            transport: config.transport,
            wsUrl: config.wsUrl,
          });

          // Connection successful - disconnect immediately since this is just a test
          await sshManager.disconnect(connectionId);

          logger.info('SSH connection test successful', { host: config.host });

          return {
            success: true,
            message: 'Connection successful',
          };
        } catch (error) {
          logger.error('Failed to test SSH connection', error as Error, {
            host: config.host,
            username: config.username,
          });

          // Make sure to clean up on failure
          try {
            await sshManager.disconnect(connectionId);
          } catch {
            // Ignore cleanup errors
          }

          return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
          };
        }
      },
      'test_ssh_connection',
    ),
  );

  // List directory - uses RPC when workspaceId is available, SSH fallback for pre-workspace setup
  ipcMain.handle(
    'ssh:listDirectory',
    createSafeValidatedHandler(
      ListDirectorySchema,
      async (_event, config) => {
        try {
          // When workspaceId is provided, use RPC (workspace already exists)
          if (config.workspaceId) {
            logger.info('Listing directory via RPC', {
              workspaceId: config.workspaceId,
              path: config.path,
            });

            const rpcClient = await remoteRPCManager.getClient(config.workspaceId);
            const result = await rpcClient.listDir({ path: config.path });

            const files = result.entries.map((entry) => ({
              name: entry.name,
              type: entry.type === 'directory' ? 'directory' : 'file',
              size: entry.size,
              modified: entry.mtime,
            }));

            return {
              success: true,
              files,
              path: config.path,
            };
          }

          // SSH fallback for pre-workspace setup (e.g., RemoteFilePicker)
          const connectionId = `list-dir-${Date.now()}`;

          logger.info('Listing SSH directory', {
            host: config.host,
            path: config.path,
            username: config.username,
          });

          if (!config.host || !config.username) {
            return {
              success: false,
              error: 'host and username are required when workspaceId is not provided',
            };
          }

          // Connect to SSH
          await sshManager.connect(connectionId, {
            host: config.host,
            port: config.port || 22,
            username: config.username,
            password: config.password,
            privateKey: config.privateKey,
            privateKeyPath: config.privateKeyPath,
            useAgent: config.useAgent,
            transport: config.transport,
            wsUrl: config.wsUrl,
          });

          // List directory using ls command
          let result;
          try {
            result = await sshManager.executeCommand(
              connectionId,
              `ls -la --time-style=long-iso "${config.path}" 2>/dev/null | tail -n +2`,
              { timeout: 30000 },
            );

            if (result.exitCode !== 0) {
              return {
                success: false,
                error: `Failed to list directory: ${result.stderr || 'Unknown error'}`,
              };
            }

            // Parse ls output
            const files: Array<{ name: string; type: string; size: number; modified?: string }> = [];
            const lines = result.stdout.split('\n').filter((line) => line.trim());

            for (const line of lines) {
              const parts = line.split(/\s+/);
              if (parts.length < 8) continue;

              const permissions = parts[0];
              const size = parseInt(parts[4], 10);
              const date = `${parts[5]} ${parts[6]}`;
              const name = parts.slice(7).join(' ');

              // Skip . and .. entries
              if (name === '.' || name === '..') continue;

              files.push({
                name,
                type: permissions.startsWith('d') ? 'directory' : 'file',
                size,
                modified: date,
              });
            }

            return {
              success: true,
              files,
              path: config.path,
            };
          } finally {
            // Always disconnect, even if parsing throws
            await sshManager.disconnect(connectionId);
          }
        } catch (error) {
          logger.error('Failed to list directory', error as Error, {
            host: config.host,
            path: config.path,
          });

          return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
          };
        }
      },
      'ssh:listDirectory',
    ),
  );

  // ==================== Enhanced Test Connection with Readiness Checks ====================
  const EnhancedTestConnectionSchema = z.object({
    host: z.string(),
    port: z.number().optional().default(22),
    username: z.string(),
    password: z.string().optional(),
    privateKey: z.string().optional(),
    privateKeyPath: z.string().optional(),
    useAgent: z.boolean().optional(),
    transport: z.enum(['ssh', 'websocket']).optional(),
    wsUrl: z.string().optional(),
    repositoryPath: z.string(),
    branch: z.string().optional(),
  });

  ipcMain.handle(
    'ssh:test-connection',
    createSafeValidatedHandler(
      EnhancedTestConnectionSchema,
      async (_event, config) => {
        const connectionId = `test-full-${Date.now()}`;

        // Result structure
        const result: {
          success: boolean;
          checks: {
            ssh: { passed: boolean; error?: string };
            shell: { passed: boolean; error?: string };
            git: { passed: boolean; version?: string; error?: string };
            repo: { passed: boolean; error?: string };
            branch?: { passed: boolean; error?: string };
            node: { passed: boolean; version?: string; error?: string };
            auggie: { passed: boolean; path?: string; error?: string };
          };
          warnings: {
            gitVersion?: string;
            nodeVersion?: string;
            diskSpace?: string;
          };
        } = {
          success: false,
          checks: {
            ssh: { passed: false, error: undefined },
            shell: { passed: false, error: undefined },
            git: { passed: false, version: undefined, error: undefined },
            repo: { passed: false, error: undefined },
            node: { passed: false, version: undefined, error: undefined },
            auggie: { passed: false, path: undefined, error: undefined },
          },
          warnings: {
            gitVersion: undefined,
            nodeVersion: undefined,
            diskSpace: undefined,
          },
        };

        try {
          logger.info('Running enhanced connection test', {
            host: config.host,
            username: config.username,
            repositoryPath: config.repositoryPath,
          });

          // Validate auth method
          if (
            !config.password &&
            !config.privateKey &&
            !config.privateKeyPath &&
            !config.useAgent
          ) {
            result.checks.ssh.error =
              'No authentication method provided. Please provide a password, private key, or enable SSH agent.';
            return result;
          }

          // 1. SSH Connection Check
          try {
            await sshManager.connect(connectionId, {
              host: config.host,
              port: config.port || 22,
              username: config.username,
              password: config.password,
              privateKey: config.privateKey,
              privateKeyPath: config.privateKeyPath,
              useAgent: config.useAgent,
              transport: config.transport,
              wsUrl: config.wsUrl,
            });
            result.checks.ssh.passed = true;
          } catch (error) {
            result.checks.ssh.error = error instanceof Error ? error.message : String(error);
            return result; // Can't continue without SSH
          }

          // 2. Shell Check
          try {
            const shellResult = await sshManager.executeCommand(connectionId, 'echo "shell-ok"', {
              timeout: 10000,
            });
            if (shellResult.exitCode === 0 && shellResult.stdout.includes('shell-ok')) {
              result.checks.shell.passed = true;
            } else {
              result.checks.shell.error = 'Shell not responding as expected';
            }
          } catch (error) {
            result.checks.shell.error = error instanceof Error ? error.message : String(error);
          }

          // 3. Git Check
          try {
            const gitResult = await sshManager.executeCommand(connectionId, 'git --version', {
              timeout: 10000,
            });
            if (gitResult.exitCode === 0) {
              result.checks.git.passed = true;
              const versionMatch = gitResult.stdout.match(/git version (\d+\.\d+\.\d+)/);
              if (versionMatch) {
                result.checks.git.version = versionMatch[1];
                // Check for git version < 2.20 (worktree support may have issues)
                const [major, minor] = versionMatch[1].split('.').map(Number);
                if (major < 2 || (major === 2 && minor < 20)) {
                  result.warnings.gitVersion = `Git version ${versionMatch[1]} is below 2.20; worktrees may have issues`;
                }
              }
            } else {
              result.checks.git.error = 'Git is not installed';
            }
          } catch (error) {
            result.checks.git.error = error instanceof Error ? error.message : String(error);
          }

          // 4. Repository Path Check
          try {
            const repoPath = config.repositoryPath.replace(/^~/, `$HOME`);
            const repoResult = await sshManager.executeCommand(
              connectionId,
              `test -d "${repoPath}" && git -C "${repoPath}" rev-parse --git-dir 2>&1`,
              { timeout: 10000 },
            );
            if (repoResult.exitCode === 0) {
              result.checks.repo.passed = true;
            } else {
              if (repoResult.stdout.includes('not a git repository') || repoResult.stderr.includes('not a git repository')) {
                result.checks.repo.error = 'Path exists but is not a git repository';
              } else {
                result.checks.repo.error = 'Path does not exist or is not accessible';
              }
            }
          } catch (error) {
            result.checks.repo.error = error instanceof Error ? error.message : String(error);
          }

          // 4b. Branch Check (optional - only if branch specified)
          if (config.branch && result.checks.repo.passed) {
            result.checks.branch = { passed: false, error: undefined };
            try {
              const repoPath = config.repositoryPath.replace(/^~/, `$HOME`);
              const branchResult = await sshManager.executeCommand(
                connectionId,
                `git -C "${repoPath}" show-ref --verify --quiet "refs/heads/${config.branch}" 2>/dev/null || git -C "${repoPath}" show-ref --verify --quiet "refs/remotes/origin/${config.branch}" 2>/dev/null; echo "EXIT:$?"`,
                { timeout: 10000 },
              );
              // Parse the exit code from stdout since bash -l -c wrapping may lose it
              const exitMatch = branchResult.stdout.match(/EXIT:(\d+)/);
              const actualExitCode = exitMatch ? parseInt(exitMatch[1], 10) : branchResult.exitCode;
              if (actualExitCode === 0) {
                result.checks.branch.passed = true;
              } else {
                result.checks.branch.error = `Branch '${config.branch}' not found in repository`;
              }
            } catch (error) {
              result.checks.branch.error = error instanceof Error ? error.message : String(error);
            }
          }

          // 5. Node.js Check - use login shell to get correct PATH
          try {
            // Try login shell first to pick up nvm/fnm/etc
            const nodeResult = await sshManager.executeCommand(
              connectionId,
              '($SHELL -l -c "node --version" 2>/dev/null || ' +
                '/bin/bash -l -c "node --version" 2>/dev/null || ' +
                'node --version 2>/dev/null) | head -1',
              { timeout: 15000 },
            );
            if (nodeResult.exitCode === 0 && nodeResult.stdout.trim()) {
              const versionMatch = nodeResult.stdout.match(/v(\d+)\./);
              if (versionMatch) {
                result.checks.node.passed = true;
                result.checks.node.version = nodeResult.stdout.trim();
                const majorVersion = parseInt(versionMatch[1], 10);
                if (majorVersion < 18) {
                  result.warnings.nodeVersion = `Node.js ${nodeResult.stdout.trim()} is below v18; intent-server requires Node 18+`;
                }
              } else {
                result.checks.node.error = 'Could not parse Node.js version';
              }
            } else {
              result.checks.node.error = 'Node.js is not installed';
            }
          } catch (error) {
            result.checks.node.error = error instanceof Error ? error.message : String(error);
          }

          // 6. Auggie Check - use same discovery strategy as intent-server
          // Non-interactive SSH shells don't have the user's PATH, so we need to:
          // 1. Try login shell with command -v
          // 2. Check common npm global paths
          // 3. Scan nvm/fnm directories
          try {
            let auggiePath: string | null = null;

            // Strategy 1: Try login shell (loads user's .bashrc/.zshrc PATH)
            const loginShellResult = await sshManager.executeCommand(
              connectionId,
              // Try user's default shell first, fall back to common shells
              '($SHELL -l -c "command -v auggie" 2>/dev/null || ' +
                '/bin/bash -l -c "command -v auggie" 2>/dev/null || ' +
                '/bin/zsh -l -c "command -v auggie" 2>/dev/null) | head -1',
              { timeout: 15000 },
            );
            if (loginShellResult.exitCode === 0 && loginShellResult.stdout.trim()) {
              const candidate = loginShellResult.stdout.trim().split('\n').pop()?.trim();
              if (candidate && !candidate.includes('not found')) {
                auggiePath = candidate;
              }
            }

            // Strategy 2: Check common hardcoded paths (same as intent-server)
            if (!auggiePath) {
              const commonPaths = [
                '/usr/local/bin/auggie',
                '/opt/homebrew/bin/auggie',
                '$HOME/.npm-global/bin/auggie',
                '$HOME/.npm-packages/bin/auggie',
                '$HOME/.local/bin/auggie',
                '$HOME/npm/bin/auggie',
                '$HOME/.volta/bin/auggie',
                '$HOME/.fnm/aliases/default/bin/auggie',
                '$HOME/.asdf/shims/auggie',
                '$HOME/n/bin/auggie',
                '/usr/local/n/bin/auggie',
                '/usr/local/opt/node/bin/auggie',
                '/opt/homebrew/opt/node/bin/auggie',
              ];

              const checkPathsScript = commonPaths
                .map((p) => `[ -x "${p}" ] && echo "${p}"`)
                .join(' || ');

              const pathsResult = await sshManager.executeCommand(
                connectionId,
                checkPathsScript + ' || true',
                { timeout: 10000 },
              );
              if (pathsResult.exitCode === 0 && pathsResult.stdout.trim()) {
                auggiePath = pathsResult.stdout.trim().split('\n')[0];
              }
            }

            // Strategy 3: Scan nvm directories
            if (!auggiePath) {
              const nvmResult = await sshManager.executeCommand(
                connectionId,
                'ls -d $HOME/.nvm/versions/node/*/bin/auggie 2>/dev/null | sort -rV | head -1',
                { timeout: 10000 },
              );
              if (nvmResult.exitCode === 0 && nvmResult.stdout.trim()) {
                auggiePath = nvmResult.stdout.trim();
              }
            }

            // Strategy 4: Scan fnm directories
            if (!auggiePath) {
              const fnmResult = await sshManager.executeCommand(
                connectionId,
                'ls -d $HOME/.fnm/node-versions/*/installation/bin/auggie 2>/dev/null | head -1',
                { timeout: 10000 },
              );
              if (fnmResult.exitCode === 0 && fnmResult.stdout.trim()) {
                auggiePath = fnmResult.stdout.trim();
              }
            }

            if (auggiePath) {
              result.checks.auggie.passed = true;
              result.checks.auggie.path = auggiePath;
            } else {
              result.checks.auggie.error = 'Auggie is not installed. Run: npm install -g @augmentcode/auggie';
            }
          } catch (error) {
            result.checks.auggie.error = error instanceof Error ? error.message : String(error);
          }

          // 7. Disk Space Check (warning only)
          try {
            const repoPath = config.repositoryPath.replace(/^~/, `$HOME`);
            const dfResult = await sshManager.executeCommand(
              connectionId,
              `df -h "${repoPath}" 2>/dev/null | tail -1 | awk '{print $4}'`,
              { timeout: 10000 },
            );
            if (dfResult.exitCode === 0 && dfResult.stdout.trim()) {
              const available = dfResult.stdout.trim();
              // Parse the available space (e.g., "890M", "1.5G", "500K")
              const match = available.match(/^([\d.]+)([KMGT])?/i);
              if (match) {
                const value = parseFloat(match[1]);
                const unit = (match[2] || 'K').toUpperCase();
                const sizeInMB =
                  unit === 'K' ? value / 1024 : unit === 'M' ? value : unit === 'G' ? value * 1024 : value * 1024 * 1024;
                if (sizeInMB < 1024) {
                  result.warnings.diskSpace = `Only ${available} free disk space; at least 1GB recommended`;
                }
              }
            }
          } catch {
            // Disk space check is non-critical, ignore errors
          }

          // Determine overall success (all critical checks must pass)
          result.success =
            result.checks.ssh.passed &&
            result.checks.shell.passed &&
            result.checks.git.passed &&
            result.checks.repo.passed &&
            (!config.branch || (result.checks.branch?.passed ?? false)) &&
            result.checks.node.passed &&
            result.checks.auggie.passed;

          return result;
        } catch (error) {
          logger.error('Enhanced connection test failed', error as Error);
          return result;
        } finally {
          // Always clean up connection
          try {
            await sshManager.disconnect(connectionId);
          } catch {
            // Ignore cleanup errors
          }
        }
      },
      'ssh:test-connection',
    ),
  );

  logger.info('SSH IPC handlers registered');
}
