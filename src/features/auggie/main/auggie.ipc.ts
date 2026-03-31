import { exec } from 'child_process';
import { promisify } from 'util';
import { ipcMain } from 'electron';
import ElectronStore from 'electron-store';
import { existsSync, readdirSync, readFileSync } from 'fs';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import * as https from 'https';
import {
  AUGGIE_APPLE_TEAM_ID,
  AUGGIE_BINARY_BASE_URL,
  MINIMUM_AUGGIE_VERSION,
  MINIMUM_NODE_VERSION,
} from '../../../shared/constants/auggie';
import { execAsync, execAsyncWithRetry, execFileAsyncWithRetry } from '../../../shared/git/git-env';

const rawExec = promisify(exec);
import { AUGGIE_CHANNELS } from '../../../shared/ipc/channels';
import { Logger } from '../../../shared/logger';
import { findAuggieAsync } from '../../../shared/main/async-utils';
import { findBinary } from '../../../shared/main/find-binary';
import { checkGitVersion } from './version-checks';

const logger = new Logger('AuggieIPC');

// Settings store for accessing user-configured auggie path
let settingsStore: ElectronStore | null = null;

function getSettingsStore(): ElectronStore {
  if (!settingsStore) {
    settingsStore = new ElectronStore({ name: 'settings' });
  }
  return settingsStore;
}

// ============================================================================
// Auggie CLI Version Requirements
// ============================================================================

/**
 * Parse a semver version string into its components.
 * Prerelease suffixes (e.g., -beta.1, -rc.1) are ignored for comparison purposes.
 * Returns null if the version string is invalid.
 */
function parseVersion(
  versionString: string,
): { major: number; minor: number; patch: number } | null {
  // Extract version number from strings like "auggie version 0.14.0-beta.1 (commit abc123)"
  // The regex captures major.minor.patch, ignoring any prerelease suffix
  const match = versionString.match(/(\d+)\.(\d+)(?:\.(\d+))?/);
  if (!match) return null;

  return {
    major: parseInt(match[1], 10),
    minor: parseInt(match[2], 10),
    patch: match[3] ? parseInt(match[3], 10) : 0,
  };
}

/**
 * Compare two version strings.
 * Returns:
 *   -1 if version1 < version2
 *    0 if version1 === version2
 *    1 if version1 > version2
 *   null if either version is invalid
 */
function compareVersions(version1: string, version2: string): number | null {
  const v1 = parseVersion(version1);
  const v2 = parseVersion(version2);

  if (!v1 || !v2) return null;

  if (v1.major !== v2.major) return v1.major > v2.major ? 1 : -1;
  if (v1.minor !== v2.minor) return v1.minor > v2.minor ? 1 : -1;
  if (v1.patch !== v2.patch) return v1.patch > v2.patch ? 1 : -1;

  return 0;
}

/**
 * Check if a version meets the minimum required version.
 */
function meetsMinimumVersion(version: string, minimum: string = MINIMUM_AUGGIE_VERSION): boolean {
  const comparison = compareVersions(version, minimum);
  // If comparison is null (invalid version), assume it doesn't meet requirements
  return comparison !== null && comparison >= 0;
}

// ============================================================================
// Node.js Version Check
// ============================================================================

/**
 * Check the installed Node.js version.
 *
 * IMPORTANT: This uses rawExec with process.env (NOT execAsyncWithRetry) to
 * match how the agent process is actually spawned. The agent (acp-provider.ts)
 * uses `...process.env` without any PATH enhancement. If we used
 * execAsyncWithRetry, it would go through buildGitEnv() → getEnhancedPath()
 * which adds ESSENTIAL_SYSTEM_PATHS (including /opt/homebrew/bin), potentially
 * finding a different node (e.g. Homebrew's v24) than what the agent actually
 * runs with (e.g. nvm's v18).
 */
async function checkNodeVersion(): Promise<{
  nodeVersion?: string;
  nodeVersionOk: boolean;
}> {
  // Check the node version using process.env directly (NOT the enhanced/auggie PATH).
  // The agent process is spawned via acp-provider with `...process.env` — it does
  // NOT use getEnhancedPath() or getAuggieExecPATH(). So `#!/usr/bin/env node`
  // resolves `node` using the exact PATH the app was launched with.
  //
  // We use rawExec (promisified child_process.exec) instead of execAsyncWithRetry
  // because the latter goes through buildGitEnv() → getEnhancedPath(), which adds
  // ESSENTIAL_SYSTEM_PATHS (including /opt/homebrew/bin). That can shadow the user's
  // nvm/volta node with Homebrew's node, giving a false "version OK" result.
  // Retry up to 3 times to handle transient spawn errors (e.g. EAGAIN).
  const MAX_RETRIES = 3;
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const { stdout } = await rawExec('node --version', {
        timeout: 5000,
        env: process.env,
        windowsHide: true,
      });
      const version = (stdout || '').trim();
      if (version) {
        const versionOk = meetsMinimumVersion(version, MINIMUM_NODE_VERSION);
        logger.info('Node.js version check (runtime PATH)', { version, versionOk });
        return { nodeVersion: version, nodeVersionOk: versionOk };
      }
    } catch (err) {
      lastError = err;
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'EAGAIN' || code === 'EBADF') {
        logger.warn(
          `Node version check attempt ${attempt}/${MAX_RETRIES} failed with ${code}, retrying...`,
        );
        await new Promise((resolve) => setTimeout(resolve, 200 * attempt));
        continue;
      }
      // Non-transient error — no point retrying
      break;
    }
  }

  logger.warn('Node not found on PATH', { error: lastError });
  // If `node --version` fails, auggie can't run.
  return { nodeVersionOk: false };
}

// ============================================================================
// Helper Functions
// ============================================================================

function getEnhancedPath(): string {
  const pathSeparator = process.platform === 'win32' ? ';' : ':';
  const paths = new Set<string>();

  // Start with current PATH
  if (process.env.PATH) {
    process.env.PATH.split(pathSeparator).forEach((p) => paths.add(p));
  }

  const homeDir = os.homedir();

  // Try to read PATH from shell profiles (for macOS GUI apps)
  if (process.platform === 'darwin') {
    const shellProfiles = [
      path.join(homeDir, '.zshrc'),
      path.join(homeDir, '.bash_profile'),
      path.join(homeDir, '.bashrc'),
      path.join(homeDir, '.profile'),
    ];

    for (const profile of shellProfiles) {
      if (existsSync(profile)) {
        try {
          const content = readFileSync(profile, 'utf8');
          // Look for PATH exports
          const pathMatches = content.match(/export\s+PATH=["']?([^"'\n]+)["']?/gm);
          if (pathMatches) {
            for (const match of pathMatches) {
              const pathValue = match.replace(/export\s+PATH=["']?/, '').replace(/["']?$/, '');
              // Expand $PATH references
              const expandedPath = pathValue.replace(
                /\$PATH/g,
                Array.from(paths).join(pathSeparator),
              );
              // Expand $HOME references
              const finalPath = expandedPath.replace(/\$HOME/g, homeDir).replace(/~/g, homeDir);
              finalPath.split(pathSeparator).forEach((p) => {
                if (p && !p.includes('$')) {
                  paths.add(p);
                }
              });
            }
          }
        } catch (e) {
          // Ignore errors reading shell profiles
        }
      }
    }
  }

  // Add common npm/node locations (platform-specific)
  const commonPaths: string[] = [];

  if (process.platform === 'win32') {
    // Windows-specific paths
    const appData = process.env.APPDATA || '';
    const localAppData = process.env.LOCALAPPDATA || '';
    const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
    const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';

    if (appData) {
      commonPaths.push(path.join(appData, 'npm')); // npm global bin on Windows
      commonPaths.push(path.join(appData, 'nvm')); // nvm-windows
    }
    if (localAppData) {
      commonPaths.push(path.join(localAppData, 'Volta', 'bin'));
      commonPaths.push(path.join(localAppData, 'fnm'));
    }
    commonPaths.push(path.join(programFiles, 'nodejs'));
    commonPaths.push(path.join(programFilesX86, 'nodejs'));
    commonPaths.push(path.join(homeDir, '.npm-global'));
  } else {
    // Unix paths
    commonPaths.push(
      '/usr/local/bin',
      '/usr/bin',
      '/bin',
      '/usr/sbin',
      '/sbin',
      path.join(homeDir, '.npm-global', 'bin'),
      path.join(homeDir, '.npm-packages', 'bin'),
      path.join(homeDir, '.local', 'bin'),
      '/opt/homebrew/bin', // Apple Silicon Macs
      '/opt/homebrew/sbin',
      '/usr/local/opt/node/bin',
      '/usr/local/opt/node@18/bin',
      '/usr/local/opt/node@20/bin',
      '/usr/local/opt/node@22/bin',
      path.join(homeDir, '.volta', 'bin'),
      path.join(homeDir, '.fnm', 'aliases', 'default', 'bin'),
      path.join(homeDir, '.asdf', 'shims'),
      path.join(homeDir, 'n', 'bin'),
      '/usr/local/n/versions/node',
    );
  }

  // Add NVM paths (Unix-style nvm)
  if (process.platform !== 'win32') {
    const nvmDir = path.join(homeDir, '.nvm', 'versions', 'node');
    if (existsSync(nvmDir)) {
      try {
        const nodeDirs = readdirSync(nvmDir);
        for (const dir of nodeDirs) {
          paths.add(path.join(nvmDir, dir, 'bin'));
        }
      } catch (e) {
        // Ignore
      }
    }
  }

  // Add common npm global bin directories (without calling npm since it might not be available)
  const npmGlobalPaths =
    process.platform === 'win32'
      ? [path.join(process.env.APPDATA || '', 'npm'), path.join(homeDir, '.npm-global')].filter(
          Boolean,
        )
      : [
          path.join(homeDir, '.npm-global', 'bin'),
          path.join(homeDir, '.npm-packages', 'bin'),
          path.join(homeDir, 'npm', 'bin'),
          '/usr/local/lib/node_modules/npm/bin',
          '/opt/homebrew/lib/node_modules/npm/bin',
        ];
  npmGlobalPaths.forEach((p) => {
    if (existsSync(p)) {
      paths.add(p);
    }
  });

  // Add all common paths
  commonPaths.forEach((p) => paths.add(p));

  const finalPath = Array.from(paths).join(pathSeparator);

  // Log the enhanced PATH for debugging (only log first few paths to avoid clutter)
  const pathArray = Array.from(paths);
  logger.debug('Enhanced PATH created', {
    totalPaths: pathArray.length,
    samplePaths: pathArray.slice(0, 10),
    includesHomebrew: pathArray.includes('/opt/homebrew/bin'),
    includesNvm: pathArray.some((p) => p.includes('.nvm')),
  });

  return finalPath;
}
async function execWithEnhancedPath(
  command: string,
  options: { cwd?: string; maxBuffer?: number; timeout?: number } = {},
): Promise<{ stdout: string; stderr: string }> {
  const enhancedPath = getEnhancedPath();
  // Use retry-enabled exec to handle transient errors like EAGAIN
  return execAsyncWithRetry(command, {
    ...options,
    env: {
      PATH: enhancedPath,
    },
  });
}

async function saveAuggiePath(auggiePath: string): Promise<void> {
  const savedPathFile = path.join(os.homedir(), '.augment', 'auggie-path');
  const augmentDir = path.join(os.homedir(), '.augment');

  try {
    if (!existsSync(augmentDir)) {
      await fs.mkdir(augmentDir, { recursive: true });
    }

    await fs.writeFile(savedPathFile, auggiePath, 'utf8');
    logger.debug('Saved auggie path to file', { file: savedPathFile });

    // Verify the file is immediately readable (handles file system sync delays)
    for (let verifyAttempt = 0; verifyAttempt < 5; verifyAttempt++) {
      try {
        const verifyContent = await fs.readFile(savedPathFile, 'utf8');
        if (verifyContent.trim() === auggiePath) {
          logger.debug('Verified saved auggie path file is readable', {
            attempt: verifyAttempt + 1,
          });
          break;
        }
      } catch (verifyError) {
        logger.debug('File not yet readable, retrying', {
          attempt: verifyAttempt + 1,
          error: (verifyError as Error).message,
        });
      }

      if (verifyAttempt < 4) {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    }
  } catch (error) {
    logger.debug('Could not save auggie path', { error: (error as Error).message });
  }
}

async function findAuggieInEnhancedPath(): Promise<string | null> {
  const foundPath = await findBinary('auggie', {
    cache: false,
    useLoginShell: false,
    retry: true,
  });

  if (foundPath) {
    logger.info('Found auggie via enhanced PATH search', { path: foundPath });
    return foundPath;
  }

  logger.debug('Enhanced PATH search for auggie failed');
  return null;
}

export async function findAuggiePathAsync(): Promise<string | null> {
  // 0. Check for Intent-managed binary first (highest priority)
  const managedBinary = path.join(
    os.homedir(),
    '.augment',
    'bin',
    process.platform === 'win32' ? 'auggie.exe' : 'auggie',
  );
  if (existsSync(managedBinary)) {
    logger.info('Found Intent-managed auggie binary', { path: managedBinary });
    return managedBinary;
  }

  // 1. First check if user has configured a custom auggie path in settings
  try {
    const store = getSettingsStore();
    const userConfiguredPath = store.get('auggiePath') as string | undefined;
    if (userConfiguredPath && userConfiguredPath.trim()) {
      const trimmedPath = userConfiguredPath.trim();
      if (existsSync(trimmedPath)) {
        logger.info('Using user-configured auggie path from settings', { path: trimmedPath });
        return trimmedPath;
      } else {
        logger.warn('User-configured auggie path does not exist', { path: trimmedPath });
      }
    }
  } catch (e) {
    logger.debug('Error reading auggie path from settings', { error: (e as Error).message });
  }

  // 2. Check if we have a saved path in ~/.augment/auggie-path (auto-discovered cache)
  // Use retry logic to handle file system sync delays after installation
  const savedPathFile = path.join(os.homedir(), '.augment', 'auggie-path');
  for (let attempt = 0; attempt < 3; attempt++) {
    logger.debug('Checking for saved auggie path', {
      file: savedPathFile,
      exists: existsSync(savedPathFile),
      attempt: attempt + 1,
    });
    if (existsSync(savedPathFile)) {
      try {
        const savedPath = readFileSync(savedPathFile, 'utf8').trim();
        logger.debug('Read saved auggie path', {
          savedPath,
          exists: savedPath ? existsSync(savedPath) : false,
          attempt: attempt + 1,
        });
        if (savedPath && existsSync(savedPath)) {
          logger.info('Using saved auggie path', { path: savedPath, attempt: attempt + 1 });

          return savedPath;
        }
      } catch (e) {
        logger.debug('Error reading saved path', {
          error: (e as Error).message,
          attempt: attempt + 1,
        });
      }
    }

    // Wait a bit before retrying (only if not the last attempt)
    if (attempt < 2) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  // 3. Use shared async discovery (checks common paths + nvm/fnm scan without spawning shells).
  // This is more reliable than `which` in Electron GUI contexts where PATH may be incomplete
  // (e.g., after reboot when launched from Finder, not terminal).
  const asyncResult = await findAuggieAsync();
  if (asyncResult) {
    logger.info('Found auggie via async discovery', { path: asyncResult });
    await saveAuggiePath(asyncResult);
    return asyncResult;
  }

  // 4. Try using the enhanced PATH (covers common Node/NPM locations even if Electron PATH is stale)
  const enhancedPathResult = await findAuggieInEnhancedPath();
  if (enhancedPathResult) {
    await saveAuggiePath(enhancedPathResult);
    return enhancedPathResult;
  }

  // 5. Run shared binary lookup with platform-appropriate PATH/login-shell behavior
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA || '';
    const windowsAuggiePaths = [
      path.join(appData, 'npm', 'auggie.cmd'),
      path.join(appData, 'npm', 'auggie'),
      path.join(os.homedir(), '.npm-global', 'auggie.cmd'),
      path.join(os.homedir(), '.npm-global', 'auggie'),
    ];

    const windowsPathResult = await findBinary('auggie', {
      commonPaths: windowsAuggiePaths,
      cache: false,
      useLoginShell: false,
      retry: true,
    });

    if (windowsPathResult) {
      logger.info('Found auggie at Windows common path', { path: windowsPathResult });
      await saveAuggiePath(windowsPathResult);
      return windowsPathResult;
    }
  } else {
    const foundPath = await findBinary('auggie', { cache: false, retry: true });
    if (foundPath) {
      logger.info('Found auggie via login shell', { path: foundPath });
      await saveAuggiePath(foundPath);
      return foundPath;
    }

    logger.debug('Could not find auggie via login shell');
  }

  logger.warn('Could not find auggie');
  return null;
}

// Default timeout for auggie commands (30 seconds)
const DEFAULT_AUGGIE_TIMEOUT_MS = 30_000;

// ============================================================================
// OAuth Helper Functions
// ============================================================================

import { createRequire } from 'module';

// Create require function for ESM context to access Node.js built-in modules
const requireNode = createRequire(import.meta.url);
const fsSync = requireNode('fs') as typeof import('fs');

/**
 * Build a PATH string for executing the auggie CLI binary.
 *
 * On macOS, GUI apps launched from Finder have a severely limited PATH
 * (/usr/bin:/bin:/usr/sbin:/sbin). If auggie was installed via nvm/fnm,
 * the `node` binary lives in the same bin directory as auggie. Without
 * including that directory, the #!/usr/bin/env node shebang in the auggie
 * script can't find node, causing silent execution failures.
 *
 * This function prepends the auggie binary's parent directory to the
 * enhanced PATH so the correct node binary is always discoverable.
 */
function getAuggieExecPATH(auggiePath: string | null): string {
  const enhancedPath = getEnhancedPath();
  if (!auggiePath) {
    return enhancedPath;
  }
  const auggieBinDir = path.dirname(auggiePath);
  const sep = process.platform === 'win32' ? ';' : ':';
  return `${auggieBinDir}${sep}${enhancedPath}`;
}

async function executeAuggieCommand(
  args: string,
  options: { timeout?: number; stdin?: string } = {},
): Promise<{ stdout: string; stderr: string }> {
  const timeout = options.timeout ?? DEFAULT_AUGGIE_TIMEOUT_MS;
  // PERF: Use async path finding to avoid blocking main thread
  const auggiePath = await findAuggiePathAsync();

  const executablePath = auggiePath || 'auggie';
  const argsArray = args.split(' ').filter(Boolean);
  logger.debug('Executing auggie command', {
    path: executablePath,
    args: argsArray,
    timeout,
    hasStdin: !!options.stdin,
  });

  // If stdin is provided, use spawn instead of exec to pipe input
  if (options.stdin) {
    return executeAuggieWithStdin(executablePath, argsArray, options.stdin, timeout);
  }

  if (!auggiePath) {
    // Try to execute directly in case it's in PATH but not found by our search
    return execWithEnhancedPath(`auggie ${args}`, { timeout });
  }

  const auggieEnvPath = getAuggieExecPATH(auggiePath);

  // On Windows, npm-installed commands (both .cmd wrappers and non-.cmd shims)
  // cannot be executed with execFile (no shell). Always use exec (shell-based) on Windows.
  if (process.platform === 'win32') {
    return execAsyncWithRetry(`"${auggiePath}" ${args}`, {
      timeout,
      env: { PATH: auggieEnvPath },
    });
  }

  // On macOS/Linux, use execFile (no shell) when we have the full path - more robust
  // against EAGAIN because it doesn't spawn a shell process
  return execFileAsyncWithRetry(auggiePath, argsArray, {
    timeout,
    env: { PATH: auggieEnvPath },
  });
}

async function executeAuggieWithStdin(
  auggiePath: string,
  args: string[],
  stdinData: string,
  timeout: number,
): Promise<{ stdout: string; stderr: string }> {
  const { spawn } = requireNode('child_process') as typeof import('child_process');

  return new Promise((resolve, reject) => {
    const enhancedEnv = {
      ...process.env,
      PATH: getAuggieExecPATH(auggiePath),
    };

    // On Windows, .cmd/.bat files need shell: true to be executed via spawn.
    // On macOS, don't use shell: true - /bin/sh may not be accessible
    // in macOS GUI apps launched from Finder.
    const isWindowsCmdFile =
      process.platform === 'win32' && (auggiePath.endsWith('.cmd') || auggiePath.endsWith('.bat'));

    // On Windows with shell: true, quote the path to handle spaces (e.g. C:\Users\John Doe\...)
    const spawnCommand = isWindowsCmdFile ? `"${auggiePath}"` : auggiePath;

    const child = spawn(spawnCommand, args, {
      env: enhancedEnv,
      shell: isWindowsCmdFile,
      windowsHide: true,
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data: Buffer) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    child.on('error', (err) => {
      reject(err);
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(new Error(stderr || `Command exited with code ${code}`));
      }
    });

    // Set up timeout
    const timeoutId = setTimeout(() => {
      child.kill();
      reject(new Error(`Command timed out after ${timeout}ms`));
    }, timeout);

    child.on('close', () => {
      clearTimeout(timeoutId);
    });

    // Handle stdin EPIPE errors (child process may exit before consuming all input)
    child.stdin.on('error', (error) => {
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.includes('EPIPE')) {
        // Benign: child process exited before reading all stdin data
        logger.debug('Stdin EPIPE (child exited before consuming input)');
      } else {
        logger.error('Stdin error:', error);
      }
    });

    // Write stdin and close
    child.stdin.write(stdinData);
    child.stdin.end();
  });
}

// ============================================================================
// Model Parsing Helper
// ============================================================================

/**
 * Parse auggie model list output and extract model information.
 * Returns an array of models with value and label, or empty array if parsing fails.
 *
 * Expected CLI output format:
 *   Available models:
 *    - Display Name [model-id]
 *    - Default Model [model-id]  (default)
 *        Description text on next line
 */
function parseModelListOutput(
  stdout: string,
): Array<{ value: string; label: string; description?: string }> {
  const models: Array<{ value: string; label: string; description?: string }> = [];
  const lines = stdout.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const trimmedLine = lines[i].trim();

    // Skip empty lines and headers
    if (!trimmedLine || trimmedLine.startsWith('Available models')) {
      continue;
    }

    // Match the format: " - Model Name [model-id]" with optional trailing content like "(default)"
    const modelMatch = trimmedLine.match(/^-\s+(.+?)\s*\[([^\]]+)\]/);
    if (modelMatch) {
      const label = modelMatch[1].trim();
      const value = modelMatch[2].trim();

      // Check if the next line is a description (indented, doesn't start with -)
      let description: string | undefined;
      if (i + 1 < lines.length) {
        const nextLine = lines[i + 1].trim();
        if (nextLine && !nextLine.startsWith('-') && !nextLine.startsWith('Available')) {
          description = nextLine;
          i++; // Skip the description line
        }
      }

      models.push({ value, label, ...(description ? { description } : {}) });
    }
  }

  return models;
}

/**
 * Parse auggie model list --json output.
 * Returns an array of models with rich metadata, or null if parsing fails.
 */
function parseModelListJson(
  stdout: string,
): Array<{
  value: string;
  label: string;
  description?: string;
  modelGroupPriority?: number;
  isLegacyModel?: boolean;
  costTier?: number;
  badges?: Array<{ color: string; label: string; variant?: string }>;
  effortLevels?: string[];
  isDefault?: boolean;
  priority?: number;
}> | null {
  try {
    const parsed = JSON.parse(stdout);
    if (!parsed || !Array.isArray(parsed.models)) {
      return null;
    }

    return parsed.models
      .filter(
        (m: Record<string, unknown>) =>
          typeof m.shortName === 'string' && typeof m.displayName === 'string',
      )
      .map((m: Record<string, unknown>) => ({
        value: m.shortName as string,
        label: m.displayName as string,
        ...(m.description ? { description: m.description as string } : {}),
        ...(m.modelGroupPriority != null
          ? { modelGroupPriority: m.modelGroupPriority as number }
          : {}),
        ...(m.isLegacyModel ? { isLegacyModel: true } : {}),
        ...(m.costTier != null ? { costTier: m.costTier as number } : {}),
        ...(Array.isArray(m.badges) && m.badges.length > 0 ? { badges: m.badges } : {}),
        ...(Array.isArray(m.effortLevels) && m.effortLevels.length > 0
          ? { effortLevels: m.effortLevels }
          : {}),
        ...(m.isDefault ? { isDefault: true } : {}),
        ...(m.priority != null ? { priority: m.priority as number } : {}),
      }));
  } catch {
    return null;
  }
}

// ============================================================================
// Main Process Handlers
// ============================================================================

export function setupAuggieIPC() {
  // Check if auggie is available
  ipcMain.handle(AUGGIE_CHANNELS.CHECK_AVAILABILITY, async () => {
    try {
      logger.debug('Checking auggie availability');

      // Try to run auggie --version
      try {
        const { stdout, stderr } = await executeAuggieCommand('--version');

        // Check if we got a version output
        const isAvailable =
          (stdout &&
            (stdout.includes('auggie') ||
              stdout.includes('version') ||
              /\d+\.\d+\.\d+/.test(stdout))) ||
          (stderr && (stderr.includes('auggie') || stderr.includes('version')));

        logger.info('Auggie availability check', { isAvailable, stdout, stderr });

        return {
          success: true,
          available: isAvailable,
        };
      } catch (error) {
        const errnoError = error as NodeJS.ErrnoException;
        const errorMessage = (error as Error).message;
        // If command fails with ENOENT, auggie is not installed
        if (errnoError.code === 'ENOENT' || errorMessage.includes('not found')) {
          logger.info('Auggie not found in PATH');
          return {
            success: true,
            available: false,
          };
        }

        // For other errors, still try to determine if auggie exists
        logger.warn('Error checking auggie, but may still be available', { error: errorMessage });
        return {
          success: true,
          available: false,
        };
      }
    } catch (error) {
      logger.error('Failed to check auggie availability', { error: (error as Error).message });
      return {
        success: false,
        error: (error as Error).message,
      };
    }
  });

  // Get the resolved auggie path (for displaying in settings)
  ipcMain.handle(AUGGIE_CHANNELS.GET_PATH, async () => {
    try {
      const resolvedPath = await findAuggiePathAsync();
      return {
        success: true,
        path: resolvedPath,
      };
    } catch (error) {
      logger.error('Failed to get auggie path', { error: (error as Error).message });
      return {
        success: false,
        error: (error as Error).message,
      };
    }
  });

  // Get installation/authentication status for Auggie CLI
  ipcMain.handle(AUGGIE_CHANNELS.STATUS, async () => {
    // Check if the managed binary exists (binary install is always available as fallback)
    const managedBinaryPath = path.join(
      os.homedir(),
      '.augment',
      'bin',
      process.platform === 'win32' ? 'auggie.exe' : 'auggie',
    );
    const supportedBinaryPlatforms: Record<string, string[]> = {
      darwin: ['arm64'],
      linux: ['x64'],
      win32: ['x64'],
    };
    const managedBinaryInstalled = existsSync(managedBinaryPath);
    const binaryInstallAvailable =
      managedBinaryInstalled ||
      (supportedBinaryPlatforms[process.platform]?.includes(process.arch) ?? false);

    const status: {
      installed: boolean;
      authenticated: boolean;
      version?: string;
      versionOk: boolean;
      minimumVersion: string;
      authDetails?: string;
      nodeVersion?: string;
      nodeVersionOk: boolean;
      gitInstalled: boolean;
      gitVersion?: string;
      binaryInstallAvailable: boolean;
      managedBinaryInstalled: boolean;
    } = {
      installed: false,
      authenticated: false,
      versionOk: false,
      minimumVersion: MINIMUM_AUGGIE_VERSION,
      nodeVersionOk: false,
      gitInstalled: false,
      binaryInstallAvailable,
      managedBinaryInstalled,
    };

    try {
      // Check Node.js and Git versions in parallel (independent of auggie status).
      // Use Promise.allSettled so one failure doesn't drop the other's result.
      const [nodeSettled, gitSettled] = await Promise.allSettled([
        checkNodeVersion(),
        checkGitVersion(),
      ]);

      if (nodeSettled.status === 'fulfilled') {
        status.nodeVersion = nodeSettled.value.nodeVersion;
        status.nodeVersionOk = nodeSettled.value.nodeVersionOk;
        if (!status.nodeVersionOk) {
          if (status.nodeVersion) {
            logger.warn('Node.js version is below minimum required', {
              current: status.nodeVersion,
              minimum: MINIMUM_NODE_VERSION,
            });
          } else {
            logger.warn('Node.js not found on system', {
              minimum: MINIMUM_NODE_VERSION,
            });
          }
        }
      } else {
        logger.debug('Failed to check Node.js version', { error: nodeSettled.reason });
      }

      if (gitSettled.status === 'fulfilled') {
        status.gitInstalled = gitSettled.value.gitInstalled;
        status.gitVersion = gitSettled.value.gitVersion;
      } else {
        logger.debug('Failed to check Git version', { error: gitSettled.reason });
      }

      // Check installation by running --version
      try {
        const { stdout, stderr } = await executeAuggieCommand('--version', { timeout: 8000 });
        const versionOutput = (stdout || '').trim() || (stderr || '').trim();
        status.installed =
          !!versionOutput &&
          (versionOutput.includes('auggie') ||
            versionOutput.includes('version') ||
            /\d+\.\d+\.\d+/.test(versionOutput));
        status.version = versionOutput || undefined;

        // Check if version meets minimum requirements
        if (status.installed && status.version) {
          status.versionOk = meetsMinimumVersion(status.version);
          if (!status.versionOk) {
            logger.warn('Auggie CLI version is below minimum required', {
              current: status.version,
              minimum: MINIMUM_AUGGIE_VERSION,
            });
          }
        }
      } catch (error) {
        const errnoError = error as NodeJS.ErrnoException;
        const errorMessage = (error as Error).message;
        if (errnoError.code === 'ENOENT' || errorMessage.includes('not found')) {
          logger.info('Auggie not found while fetching status');
          return {
            success: true,
            data: status,
          };
        }
        // Command exists but failed unexpectedly - return error instead of installed: false
        // This shows "Something went wrong" instead of misleading setup screen
        logger.warn('Error while running auggie --version during status check', {
          error: errorMessage,
        });
        return {
          success: false,
          error: `Auggie CLI failed: ${errorMessage}. Please try again.`,
          data: status,
        };
      }

      // If not installed or version is too old, return early
      if (!status.installed || !status.versionOk) {
        return {
          success: true,
          data: status,
        };
      }

      // Check authentication via session file or environment variable first (fast path)
      try {
        const sessionPath = path.join(os.homedir(), '.augment', 'session.json');
        let sessionFileExists = false;
        try {
          await fs.access(sessionPath);
          sessionFileExists = true;
        } catch {
          // File does not exist
        }
        if (sessionFileExists) {
          // Verify the session file has valid content
          const sessionContent = await fs.readFile(sessionPath, 'utf8');
          const session = JSON.parse(sessionContent);
          if (session.accessToken) {
            status.authenticated = true;
            status.authDetails = 'Found valid session at ~/.augment/session.json';
          }
        } else if (process.env.AUGMENT_SESSION_AUTH) {
          status.authenticated = true;
          status.authDetails = 'Using AUGMENT_SESSION_AUTH environment variable';
        }
      } catch (sessionError) {
        logger.debug('Session check failed during auggie status', { error: sessionError });
      }

      // If still unauthenticated, try a lightweight whoami check
      if (!status.authenticated) {
        try {
          const { stdout } = await executeAuggieCommand('whoami', { timeout: 8000 });
          const identity = (stdout || '').trim();
          if (identity) {
            status.authenticated = true;
            status.authDetails = `Authenticated as ${identity}`;
          }
        } catch (authError) {
          logger.info('Auggie auth check failed (likely needs login)', {
            error: (authError as Error).message,
          });
        }
      }

      return {
        success: true,
        data: status,
      };
    } catch (error) {
      logger.error('Failed to get auggie status', { error: (error as Error).message });
      return {
        success: false,
        error: (error as Error).message,
      };
    }
  });

  /**
   * Download a standalone auggie binary when Node.js is not available or is an incompatible version.
   * Downloads a pre-built binary from GitHub releases and saves it to ~/.augment/bin/auggie.
   */
  async function downloadAuggieBinary(): Promise<{ success: boolean }> {
    const platform = process.platform;
    const arch = process.arch;

    // Map platform/arch to asset name
    const assetMap: Record<string, Record<string, string>> = {
      darwin: {
        arm64: 'auggie-darwin-arm64',
      },
      linux: {
        x64: 'auggie-linux-x64',
      },
      win32: {
        x64: 'auggie-windows-x64.exe',
      },
    };

    const assetName = assetMap[platform]?.[arch];
    if (!assetName) {
      throw new Error(`Unsupported platform/arch: ${platform}/${arch}`);
    }

    const url = `${AUGGIE_BINARY_BASE_URL}/${assetName}`;
    const binDir = path.join(os.homedir(), '.augment', 'bin');
    const binaryName = platform === 'win32' ? 'auggie.exe' : 'auggie';
    const binaryPath = path.join(binDir, binaryName);
    const downloadTimeoutMs = 60_000;

    logger.info('Auggie install: downloading binary', {
      url,
      path: binaryPath,
    });

    // Create ~/.augment/bin/ directory if it doesn't exist
    await fs.mkdir(binDir, { recursive: true });

    // Download the binary, following redirects (GitHub releases redirect to S3)
    await new Promise<void>((resolve, reject) => {
      const download = (downloadUrl: string, redirectCount = 0) => {
        if (redirectCount > 5) {
          reject(new Error('Too many redirects'));
          return;
        }

        const request = https.get(downloadUrl, (response) => {
          // Follow redirects (GitHub releases return 302)
          if (
            response.statusCode &&
            response.statusCode >= 300 &&
            response.statusCode < 400 &&
            response.headers.location
          ) {
            response.resume();
            download(response.headers.location, redirectCount + 1);
            return;
          }

          if (response.statusCode !== 200) {
            response.resume();
            reject(new Error(`Download failed with status ${response.statusCode}`));
            return;
          }

          const chunks: Buffer[] = [];
          response.on('data', (chunk: Buffer) => chunks.push(chunk));
          response.on('end', async () => {
            try {
              await fs.writeFile(binaryPath, Buffer.concat(chunks));
              resolve();
            } catch (err) {
              reject(err);
            }
          });
          response.on('error', reject);
        });

        request.setTimeout(downloadTimeoutMs, () => {
          request.destroy(new Error(`Download timed out after ${downloadTimeoutMs}ms`));
        });
        request.on('error', reject);
      };

      download(url);
    });

    // Set execute permissions on macOS/Linux
    if (platform !== 'win32') {
      await fs.chmod(binaryPath, 0o755);
    }

    // Verify code signature on macOS before running the binary
    if (platform === 'darwin') {
      try {
        await execFileAsyncWithRetry('codesign', ['--verify', '--deep', '--strict', binaryPath], {
          timeout: 10_000,
        });
      } catch (codesignErr) {
        try {
          await fs.unlink(binaryPath);
        } catch {
          // ignore cleanup errors
        }
        throw new Error(
          `Downloaded binary failed code signature verification: ${(codesignErr as Error).message}`,
        );
      }

      // Verify signing identity if Team ID is configured
      if (AUGGIE_APPLE_TEAM_ID) {
        try {
          const { stderr: codesignInfo } = await execAsync(
            `codesign -d --verbose=2 "${binaryPath}"`,
            { timeout: 10_000 },
          );
          const teamMatch = codesignInfo.match(/TeamIdentifier=(\S+)/);
          const actualTeamId = teamMatch?.[1];
          if (actualTeamId !== AUGGIE_APPLE_TEAM_ID) {
            try {
              await fs.unlink(binaryPath);
            } catch {
              /* ignore */
            }
            throw new Error(
              `Downloaded binary signed by unexpected team: expected ${AUGGIE_APPLE_TEAM_ID}, got ${actualTeamId || 'unknown'}`,
            );
          }
        } catch (identityErr) {
          if ((identityErr as Error).message.includes('unexpected team')) throw identityErr;
          // If codesign -d itself fails, treat as verification failure
          try {
            await fs.unlink(binaryPath);
          } catch {
            /* ignore */
          }
          throw new Error(
            `Failed to verify binary signing identity: ${(identityErr as Error).message}`,
          );
        }
      }
    }

    let versionOutput: string;
    try {
      const result = await execFileAsyncWithRetry(binaryPath, ['--version'], {
        timeout: 10_000,
      });
      versionOutput = (result.stdout || '').trim();
    } catch (verifyErr) {
      try {
        await fs.unlink(binaryPath);
      } catch {
        // ignore cleanup errors
      }
      throw new Error(`Downloaded binary failed verification: ${(verifyErr as Error).message}`);
    }

    // Verify downloaded binary meets minimum version requirement
    if (!meetsMinimumVersion(versionOutput)) {
      try {
        await fs.unlink(binaryPath);
      } catch {
        // ignore cleanup errors
      }
      const parsed = parseVersion(versionOutput);
      const displayVersion = parsed
        ? `${parsed.major}.${parsed.minor}.${parsed.patch}`
        : versionOutput;
      throw new Error(
        `Downloaded binary version ${displayVersion} is below minimum required version ${MINIMUM_AUGGIE_VERSION}`,
      );
    }

    await saveAuggiePath(binaryPath);
    logger.info('Auggie install: binary download succeeded', { path: binaryPath });

    return { success: true };
  }

  // Install auggie using npm
  ipcMain.handle(AUGGIE_CHANNELS.INSTALL, async () => {
    try {
      logger.info('Auggie install: starting');

      // Pre-check: ensure Node.js 22+ is available before attempting install
      const nodeCheck = await checkNodeVersion();
      if (!nodeCheck.nodeVersionOk) {
        const versionInfo = nodeCheck.nodeVersion
          ? ` (found ${nodeCheck.nodeVersion})`
          : ' (not found)';
        logger.warn('Node.js version check failed before install', {
          version: nodeCheck.nodeVersion,
        });

        // No compatible Node.js — try downloading standalone binary instead
        logger.info(
          'Auggie install: Node.js not available or incompatible, trying binary download path',
        );
        let binaryDownloadAttempted = false;
        try {
          binaryDownloadAttempted = true;
          const result = await downloadAuggieBinary();
          if (result.success) return result;
        } catch (err) {
          logger.warn('Auggie install: binary download failed', { error: err });
          // If the error is "Unsupported platform/arch", the download was never actually attempted
          if (err instanceof Error && err.message.startsWith('Unsupported platform/arch')) {
            binaryDownloadAttempted = false;
          }
        }

        // If binary download was attempted but failed, return a download-specific error
        if (binaryDownloadAttempted) {
          return {
            success: false,
            error:
              'Failed to download or install auggie. Please check your internet connection and try again. If the problem persists, check file permissions on ~/.augment/bin.',
            errorType: 'binary_download_failed',
          };
        }

        // Unsupported platform — binary download was never attempted, return the Node.js error
        return {
          success: false,
          error: `Node.js ${MINIMUM_NODE_VERSION.split('.')[0]}+ is required to install auggie${versionInfo}. Please install Node.js ${MINIMUM_NODE_VERSION.split('.')[0]} or later from https://nodejs.org`,
          errorType: nodeCheck.nodeVersion ? 'node_too_old' : 'missing_npm',
        };
      }

      logger.info('Auggie install: Node.js found, using npm install path');

      // Try to find npm in common locations - expanded list (platform-specific)
      const npmPaths: string[] = [];
      if (process.platform === 'win32') {
        // Windows npm locations
        const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
        const appData = process.env.APPDATA || '';
        npmPaths.push(
          path.join(programFiles, 'nodejs', 'npm.cmd'),
          path.join(programFiles, 'nodejs', 'npm'),
        );
        if (appData) {
          npmPaths.push(path.join(appData, 'npm', 'npm.cmd'), path.join(appData, 'nvm', 'npm.cmd'));
        }
        npmPaths.push(
          path.join(os.homedir(), '.npm-global', 'npm.cmd'),
          path.join(os.homedir(), '.npm-global', 'npm'),
        );
        if (process.env.LOCALAPPDATA) {
          npmPaths.push(path.join(process.env.LOCALAPPDATA, 'Volta', 'bin', 'npm.exe'));
        }
      } else {
        npmPaths.push(
          '/usr/local/bin/npm',
          '/usr/bin/npm',
          '/opt/homebrew/bin/npm',
          '/opt/homebrew/opt/node/bin/npm',
          '/opt/homebrew/opt/node@20/bin/npm',
          '/opt/homebrew/opt/node@18/bin/npm',
          path.join(os.homedir(), '.volta/bin/npm'),
          path.join(os.homedir(), '.fnm/aliases/default/bin/npm'),
          path.join(os.homedir(), '.asdf/shims/npm'),
          path.join(os.homedir(), 'n/bin/npm'),
          path.join(os.homedir(), '.npm-global/bin/npm'),
          '/Applications/Node.app/Contents/MacOS/npm',
        );
      }

      // Add Homebrew Cellar paths dynamically (macOS only)
      if (process.platform !== 'win32') {
        const cellarPaths = ['/usr/local/Cellar/node', '/opt/homebrew/Cellar/node'];
        for (const cellarPath of cellarPaths) {
          if (existsSync(cellarPath)) {
            try {
              const versions = readdirSync(cellarPath);
              for (const version of versions) {
                npmPaths.push(path.join(cellarPath, version, 'bin/npm'));
              }
            } catch (e) {
              // Ignore
            }
          }
        }
      }

      let npmPath: string | null = null;
      let npmVersion: string | null = null;

      // First try direct paths (more reliable when launched from Finder)
      logger.debug('Checking for npm in direct paths...');
      for (const testPath of npmPaths) {
        try {
          if (existsSync(testPath)) {
            // On Windows, .cmd files need shell execution; on Unix use execFile
            const isCmd = testPath.endsWith('.cmd') || testPath.endsWith('.bat');
            const { stdout } = isCmd
              ? await execAsyncWithRetry(`"${testPath}" --version`, { timeout: 5000 })
              : await execFileAsyncWithRetry(testPath, ['--version'], { timeout: 5000 });
            npmPath = testPath;
            npmVersion = stdout.trim();
            logger.info('Found npm at direct path', { path: npmPath, version: npmVersion });
            break;
          }
        } catch (err) {
          logger.debug(`Failed to test npm at ${testPath}:`, err);
        }
      }

      // If not found via direct paths, try to find npm via nvm
      if (!npmPath) {
        const nvmDir = path.join(os.homedir(), '.nvm/versions/node');
        if (existsSync(nvmDir)) {
          try {
            const versions = readdirSync(nvmDir).sort().reverse();
            for (const version of versions) {
              const npmBin = path.join(nvmDir, version, 'bin/npm');
              if (existsSync(npmBin)) {
                // Use execFile for robustness against EAGAIN
                const { stdout } = await execFileAsyncWithRetry(npmBin, ['--version'], {
                  timeout: 5000,
                });
                npmPath = npmBin;
                npmVersion = stdout.trim();
                logger.info('Found npm via nvm', { path: npmPath, version: npmVersion });
                break;
              }
            }
          } catch (err) {
            logger.debug('Failed to check nvm paths', { error: err });
          }
        }
      }

      // Finally, check if npm is available with enhanced PATH
      if (!npmPath) {
        try {
          const npmCheckCommand = process.platform === 'win32' ? 'where npm' : 'which npm';
          const { stdout: foundPath } = await execWithEnhancedPath(npmCheckCommand, {
            timeout: 5000,
          });
          // Verify it actually works
          const versionResult = await execWithEnhancedPath('npm --version', { timeout: 5000 });
          npmPath = 'npm'; // Use npm from PATH
          npmVersion = versionResult.stdout.trim();
          logger.info('Found npm in enhanced PATH', {
            path: foundPath.trim(),
            version: npmVersion,
          });
        } catch (npmCheckError) {
          logger.debug('npm not found in enhanced PATH', { error: npmCheckError });
        }
      }

      // If npm not found, try to find node and use npx as fallback
      if (!npmPath) {
        logger.debug('npm not found, checking for node/npx as fallback...');
        const nodePaths: string[] = [];
        if (process.platform === 'win32') {
          const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
          nodePaths.push(
            path.join(programFiles, 'nodejs', 'node.exe'),
            path.join(os.homedir(), '.volta', 'bin', 'node.exe'),
          );
          if (process.env.APPDATA) {
            nodePaths.push(path.join(process.env.APPDATA, 'nvm', 'node.exe'));
          }
        } else {
          nodePaths.push(
            '/usr/local/bin/node',
            '/usr/bin/node',
            '/opt/homebrew/bin/node',
            '/opt/homebrew/opt/node/bin/node',
            path.join(os.homedir(), '.volta/bin/node'),
            path.join(os.homedir(), '.fnm/aliases/default/bin/node'),
            path.join(os.homedir(), '.asdf/shims/node'),
            path.join(os.homedir(), 'n/bin/node'),
          );
        }

        let nodeFound = false;
        for (const nodePath of nodePaths) {
          if (existsSync(nodePath)) {
            try {
              const { stdout } = await execAsync(`"${nodePath}" --version`, { timeout: 5000 });
              logger.info('Found node but not npm', { path: nodePath, version: stdout.trim() });
              nodeFound = true;

              // Try to use npx if available
              const npxSuffix = process.platform === 'win32' ? 'npx.cmd' : 'npx';
              const nodeBasename = path.basename(nodePath);
              const npxPath = path.join(path.dirname(nodePath), npxSuffix);
              if (existsSync(npxPath)) {
                npmPath = npxPath;
                logger.info('Found npx, will use it to install auggie', { path: npxPath });
              }
              break;
            } catch (err) {
              // Continue
            }
          }
        }

        if (!npmPath) {
          const errorMsg = nodeFound
            ? 'Node.js is installed but npm/npx is not available. Please reinstall Node.js.'
            : 'npm is not installed or not in PATH. Please install Node.js and npm first.';
          logger.error('Package manager not found', { nodeFound, errorMsg });
          return {
            success: false,
            error: errorMsg,
            errorType: 'missing_npm',
          };
        }
      }

      // Use npm/npx to install auggie globally with enhanced PATH
      let npmCommand: string;
      if (npmPath === 'npm') {
        // npm is in PATH, use it directly
        npmCommand =
          process.platform === 'win32'
            ? 'npm.cmd install -g @augmentcode/auggie'
            : 'npm install -g @augmentcode/auggie';
      } else if (npmPath && npmPath.endsWith('npx')) {
        // Using npx as fallback
        npmCommand = `"${npmPath}" -y @augmentcode/auggie`;
        logger.info('Using npx to run auggie directly without global install');
      } else {
        // Use direct path to npm
        npmCommand = `"${npmPath}" install -g @augmentcode/auggie`;
      }

      logger.info('Installing auggie with command', { command: npmCommand });

      const { stdout, stderr } =
        npmPath === 'npm'
          ? await execWithEnhancedPath(npmCommand, { timeout: 60000 })
          : await execAsync(npmCommand, {
              env: {
                ...process.env,
                PATH: getEnhancedPath(),
              },
              timeout: 60000,
            });

      logger.info('Auggie installation output', { stdout, stderr });

      // Derive auggie path from npm path (they're in the same bin directory)
      // This is more reliable than `which auggie` since shell caches may not be updated
      let auggiePath: string | null = null;

      logger.info('Looking for auggie after installation', { npmPath });

      if (npmPath && npmPath !== 'npm') {
        // npm is at something like /path/to/bin/npm, so auggie is at /path/to/bin/auggie
        const binDir = path.dirname(npmPath);
        // On Windows, npm installs auggie.cmd; on Unix it's just auggie
        const auggieNames = process.platform === 'win32' ? ['auggie.cmd', 'auggie'] : ['auggie'];
        for (const name of auggieNames) {
          const derivedAuggiePath = path.join(binDir, name);
          logger.info('Checking derived auggie path', {
            binDir,
            derivedAuggiePath,
            exists: existsSync(derivedAuggiePath),
          });
          if (existsSync(derivedAuggiePath)) {
            auggiePath = derivedAuggiePath;
            logger.info('Derived auggie path from npm location', { auggiePath });
            break;
          }
        }
      } else if (npmPath === 'npm') {
        // npm was found in PATH, resolve its actual location first
        logger.info('npm found in PATH, resolving actual location');
        try {
          let resolvedNpmPath: string | null = null;
          if (process.platform === 'win32') {
            // On Windows, use 'where npm' to find its location
            const { stdout: npmWhere } = await execWithEnhancedPath('where npm', {
              timeout: 10000,
            });
            // 'where' may return multiple lines; take the first one
            resolvedNpmPath = npmWhere.trim().split(/\r?\n/)[0]?.trim() || null;
          } else {
            const shell = process.env.SHELL || '/bin/zsh';
            const { stdout: npmWhich } = await execAsync(`${shell} -i -c "which npm"`, {
              timeout: 10000,
              env: { ...process.env, PATH: getEnhancedPath() },
            });
            resolvedNpmPath = npmWhich.trim() || null;
          }
          logger.info('Resolved npm path', { resolvedNpmPath });
          if (resolvedNpmPath) {
            const binDir = path.dirname(resolvedNpmPath);
            const auggieNames =
              process.platform === 'win32' ? ['auggie.cmd', 'auggie'] : ['auggie'];
            for (const name of auggieNames) {
              const derivedAuggiePath = path.join(binDir, name);
              logger.info('Checking derived auggie path from resolved npm', {
                resolvedNpmPath,
                derivedAuggiePath,
                exists: existsSync(derivedAuggiePath),
              });
              if (existsSync(derivedAuggiePath)) {
                auggiePath = derivedAuggiePath;
                logger.info('Derived auggie path from resolved npm location', { auggiePath });
                break;
              }
            }
          }
        } catch (resolveError) {
          logger.warn('Could not resolve npm path', { error: (resolveError as Error).message });
        }
      } else {
        logger.warn('No npm path available for derivation', { npmPath });
      }

      // Fallback: try to find auggie via shell (platform-appropriate)
      if (!auggiePath) {
        logger.info('Trying to find auggie via shell fallback');
        try {
          const foundPath = await findBinary('auggie', { cache: false, retry: true });
          logger.info('auggie search result', {
            foundPath,
            exists: foundPath ? existsSync(foundPath) : false,
          });
          if (foundPath && existsSync(foundPath)) {
            auggiePath = foundPath;
            logger.info('Found auggie via shell', { auggiePath });
          }
        } catch (shellError) {
          logger.warn('Could not find auggie via shell', { error: (shellError as Error).message });
        }
      }

      // Final fallback: search using enhanced PATH to catch fresh installs where PATH isn't updated yet
      if (!auggiePath) {
        const enhancedPathResult = await findAuggieInEnhancedPath();
        if (enhancedPathResult) {
          auggiePath = enhancedPathResult;
          logger.info('Found auggie via enhanced PATH after install', { auggiePath });
        }
      }

      if (auggiePath && existsSync(auggiePath)) {
        logger.info('Auggie successfully installed and cached', { path: auggiePath });
        await saveAuggiePath(auggiePath);

        // Verify it works
        try {
          const { stdout: versionOutput } = await execAsync(`"${auggiePath}" --version`, {
            timeout: 10_000,
          });
          logger.info('Auggie version verified', { version: versionOutput.trim() });
        } catch (verifyError) {
          logger.warn('Could not verify auggie version', { error: verifyError });
        }

        return {
          success: true,
        };
      }

      logger.warn('Auggie installed but could not determine path');
      return {
        success: true,
      };
    } catch (error) {
      const err = error as Error;
      logger.error('Failed to install auggie', { error: err.message, stack: err.stack });

      // Provide helpful error messages
      let errorMessage = err.message;
      let errorType: 'permission' | 'missing_npm' | 'unknown' = 'unknown';
      const lowerMessage = err.message.toLowerCase();
      if (
        err.message.includes('EACCES') ||
        err.message.includes('EPERM') ||
        lowerMessage.includes('permission')
      ) {
        errorMessage =
          'Permission denied. You may need to run with administrator privileges or use sudo.';
        errorType = 'permission';
      } else if (err.message.includes('ENOENT') || lowerMessage.includes('not found')) {
        errorMessage = 'npm is not installed or not in PATH. Please install Node.js and npm first.';
        errorType = 'missing_npm';
      }

      return {
        success: false,
        error: errorMessage,
        errorType,
      };
    }
  });

  // Persistent login process for the authentication flow
  let loginProcess: import('child_process').ChildProcess | null = null;
  let loginProcessResolve:
    | ((value: { success: boolean; stdout: string; stderr: string }) => void)
    | null = null;
  let loginProcessReject: ((error: Error) => void) | null = null;
  let loginStdout = '';
  let loginStderr = '';
  // Track the auth URL from the start action so we can extract client_id / redirect_uri
  // for the direct token exchange in the complete action.
  let lastAuthUrl: string | undefined;

  // Authenticate with Augment - spawns `auggie login` and forwards user input
  ipcMain.handle(
    AUGGIE_CHANNELS.AUTHENTICATE,
    async (
      _,
      { action, authResponse }: { action: 'start' | 'complete' | 'poll'; authResponse?: string },
    ) => {
      const { spawn } = requireNode('child_process') as typeof import('child_process');

      try {
        if (action === 'start') {
          // Start OAuth flow by spawning `auggie login`
          // The new auggie CLI uses a localhost callback flow on local machines:
          // it opens the browser, starts a localhost server, receives the OAuth callback,
          // exchanges the code for a token, saves session.json, and exits with code 0.
          // The old flow (JSON paste) is still available as a fallback for remote sessions.
          logger.info('Starting OAuth authentication via auggie login');

          // Kill any existing login process
          if (loginProcess) {
            loginProcess.kill();
            loginProcess = null;
          }
          loginStdout = '';
          loginStderr = '';

          // Find auggie path - MUST exist for authentication to work
          const auggiePath = await findAuggiePathAsync();

          logger.info('AUTHENTICATE handler: findAuggiePathAsync result', {
            auggiePath,
            exists: auggiePath ? existsSync(auggiePath) : false,
          });

          if (!auggiePath) {
            logger.error('Cannot start authentication: auggie CLI not found');
            return {
              success: false,
              error: 'Auggie CLI not found. Please install it first.',
            };
          }

          logger.info('Starting auggie login process', { auggiePath });

          return new Promise((resolve) => {
            let hasErrored = false;
            let processClosed = false;
            let closeCode: number | null = null;
            let closeSignal: NodeJS.Signals | null = null;
            let startErrorMessage: string | null = null;

            // Spawn auggie login
            // On Windows, .cmd/.bat files need shell: true to be executed via spawn.
            // On macOS, don't use shell: true - /bin/sh may not be accessible
            // in macOS GUI apps launched from Finder.
            const isWindowsCmdFile =
              process.platform === 'win32' &&
              (auggiePath.endsWith('.cmd') || auggiePath.endsWith('.bat'));
            // On Windows with shell: true, quote the path to handle spaces (e.g. C:\Users\John Doe\...)
            const loginSpawnCommand = isWindowsCmdFile ? `"${auggiePath}"` : auggiePath;
            loginProcess = spawn(loginSpawnCommand, ['login'], {
              env: { ...process.env, PATH: getAuggieExecPATH(auggiePath) },
              shell: isWindowsCmdFile,
              windowsHide: true,
            });

            let browserOpened = false;
            let authUrl: string | undefined;
            let isJsonPasteFlow = false;

            loginProcess.stdout?.on('data', (data: Buffer) => {
              const text = data.toString();
              loginStdout += text;
              logger.debug('auggie login stdout', { text });

              // Check if we need to confirm re-authentication
              if (text.includes('(y/N)') && !browserOpened) {
                // Send 'y' to confirm re-authentication
                loginProcess?.stdin?.write('y\n');
              }

              // Check if browser was opened (auth URL shown)
              if (text.includes('authorize?') || text.includes('Opening authentication')) {
                browserOpened = true;
              }

              // Detect JSON paste flow (old/remote flow) — the process prompts for stdin
              if (text.includes('Paste') || text.includes('manual authentication')) {
                isJsonPasteFlow = true;
              }

              // Extract auth URL from the output - it's printed on its own line
              // Look for URLs that contain authorize? (the OAuth endpoint)
              const urlMatch = text.match(/(https?:\/\/[^\s]+authorize\?[^\s]+)/);
              if (urlMatch) {
                authUrl = urlMatch[1];
                logger.debug('Captured auth URL', { authUrl });
              }
            });

            loginProcess.stderr?.on('data', (data: Buffer) => {
              const text = data.toString();
              loginStderr += text;
              logger.debug('auggie login stderr', { text });
              if (!authUrl) {
                const urlMatch = text.match(/(https?:\/\/[^\s]+authorize\?[^\s]+)/);
                if (urlMatch) {
                  authUrl = urlMatch[1];
                  logger.debug('Captured auth URL from stderr', { authUrl });
                }
              }
            });

            loginProcess.on('error', (err) => {
              logger.error('auggie login process error', { error: err.message });
              hasErrored = true;
              startErrorMessage = err.message;
              loginProcess = null;
              if (loginProcessReject) {
                loginProcessReject(err);
                loginProcessReject = null;
                loginProcessResolve = null;
              }
            });

            loginProcess.on('close', (code, signal) => {
              logger.info('auggie login process closed', {
                code,
                signal,
                stdout: loginStdout,
                stderr: loginStderr,
              });
              processClosed = true;
              closeCode = code ?? null;
              closeSignal = signal ?? null;
              const success = code === 0;
              if (loginProcessResolve) {
                loginProcessResolve({ success, stdout: loginStdout, stderr: loginStderr });
                loginProcessResolve = null;
                loginProcessReject = null;
              }
              loginProcess = null;
            });

            // Wait a bit for the process to start and output the auth URL.
            // With the new localhost flow, the process may still be running
            // (waiting for the browser callback). That's fine — we return
            // processStarted: true and the renderer will poll for completion.
            // If it already exited with code 0, the localhost flow succeeded
            // and we return autoCompleted: true.
            setTimeout(() => {
              if (hasErrored) {
                resolve({
                  success: false,
                  error:
                    startErrorMessage || 'Auggie login process failed to start. Please try again.',
                });
                return;
              }

              // Process already exited — check if it was a successful localhost flow
              if (processClosed) {
                if (closeCode === 0) {
                  // Localhost flow completed successfully (or was already authenticated)
                  logger.info('auggie login completed automatically (localhost OAuth flow)');
                  resolve({
                    success: true,
                    data: {
                      autoCompleted: true,
                    },
                  });
                } else {
                  const suffix =
                    closeCode !== null || closeSignal
                      ? ` (exit ${closeCode ?? 'unknown'}${closeSignal ? `, ${closeSignal}` : ''})`
                      : '';
                  resolve({
                    success: false,
                    error: `Auggie login process exited unexpectedly${suffix}. Please try again.`,
                  });
                }
                return;
              }

              // Process still running — likely waiting for browser callback
              // (localhost flow) or waiting for JSON paste (remote flow).
              // Extract auth URL for fallback display.
              if (!authUrl) {
                const urlMatch = loginStdout.match(/(https?:\/\/[^\s]+authorize\?[^\s]+)/);
                if (urlMatch) {
                  authUrl = urlMatch[1];
                  logger.debug('Captured auth URL from accumulated stdout', {
                    authUrl,
                  });
                }
              }
              if (!authUrl) {
                const urlMatch = loginStderr.match(/(https?:\/\/[^\s]+authorize\?[^\s]+)/);
                if (urlMatch) {
                  authUrl = urlMatch[1];
                  logger.debug('Captured auth URL from accumulated stderr', {
                    authUrl,
                  });
                }
              }
              // Remember the auth URL so we can extract client_id/redirect_uri
              // for the direct token exchange in the complete action.
              lastAuthUrl = authUrl;
              resolve({
                success: true,
                data: {
                  processStarted: true,
                  authUrl,
                  isJsonPasteFlow,
                },
              });
            }, 2000);
          });
        } else if (action === 'poll') {
          // Poll for auth completion — used by the renderer to check if the
          // localhost OAuth flow finished (process exited with code 0)
          if (!loginProcess) {
            // Process is gone — check if it exited successfully
            // by verifying session.json has a token
            const homedir = requireNode('os').homedir();
            const sessionPath = requireNode('path').join(homedir, '.augment', 'session.json');
            try {
              const pollSessionContent = await fs.readFile(sessionPath, 'utf-8');
              const sessionData = JSON.parse(pollSessionContent);
              if (sessionData.accessToken) {
                return {
                  success: true,
                  data: { completed: true, authenticated: true },
                };
              }
            } catch {
              // Ignore read/parse errors (file may not exist yet)
            }
            return {
              success: true,
              data: { completed: true, authenticated: false },
            };
          }
          // Process still running — auth not complete yet
          return {
            success: true,
            data: { completed: false },
          };
        } else if (action === 'complete' && authResponse) {
          // Complete OAuth flow by exchanging the authorization code for a token
          // directly, instead of piping to the auggie login process's stdin.
          // The old approach (writing to stdin) failed because:
          // - In the localhost flow, the process wasn't reading from stdin
          // - If the process had already exited, there was nothing to write to
          logger.info('Completing OAuth authentication with direct token exchange');

          // Parse the auth response JSON
          let authArgs: { code?: string; state?: string; tenant_url?: string };
          try {
            authArgs = JSON.parse(authResponse);
          } catch (parseError) {
            return {
              success: false,
              error:
                'Invalid authentication response format. Please paste the full JSON from the browser (e.g. {"code":"...","state":"...","tenant_url":"..."}).',
            };
          }

          // Kill any existing login process — we handle the exchange directly
          if (loginProcess) {
            loginProcessResolve = null;
            loginProcessReject = null;
            loginProcess.kill();
            loginProcess = null;
          }

          // Read the OAuth state from disk (written by auggie login during 'start')
          const homedir = os.homedir();
          const oauthStatePath = path.join(homedir, '.augment', 'oauth-state.json');
          let oauthState: {
            codeVerifier: string;
            codeChallenge: string;
            state: string;
            creationTime: number;
          };
          try {
            const oauthRaw = await fs.readFile(oauthStatePath, 'utf-8');
            oauthState = JSON.parse(oauthRaw);
            // Check that the state is not too old (10 minutes)
            if (Date.now() - oauthState.creationTime > 10 * 60 * 1000) {
              throw new Error('expired');
            }
          } catch {
            return {
              success: false,
              error:
                'Your login session has expired. Please click "Login with Augment" to start a new session.',
            };
          }

          // Verify state if the pasted response includes it
          if (authArgs.state && oauthState.state !== authArgs.state) {
            return {
              success: false,
              error:
                'State parameter mismatch. Please make sure you pasted the response from the correct login session.',
            };
          }

          if (!authArgs.code) {
            return {
              success: false,
              error:
                'No authorization code found. Please paste the full JSON response from the browser.',
            };
          }

          if (!authArgs.tenant_url) {
            return {
              success: false,
              error:
                'No tenant URL found. Please paste the full JSON response from the browser (must include tenant_url).',
            };
          }

          // Determine client_id and redirect_uri from the original auth URL.
          // The localhost flow uses client_id="auggie-cli" with a localhost redirect,
          // while the JSON paste flow uses client_id="v" with an empty redirect.
          let clientId = 'v';
          let redirectUri = '';
          if (lastAuthUrl) {
            try {
              const parsed = new URL(lastAuthUrl);
              const urlClientId = parsed.searchParams.get('client_id');
              const urlRedirectUri = parsed.searchParams.get('redirect_uri');
              if (urlClientId) clientId = urlClientId;
              if (urlRedirectUri) redirectUri = urlRedirectUri;
            } catch {
              // Ignore URL parsing errors, use JSON-paste defaults
            }
          }

          // Exchange the authorization code for an access token
          try {
            const tokenUrl = new URL('token', authArgs.tenant_url).href;
            logger.info('Exchanging auth code for token', { tokenUrl, clientId });

            const tokenResponse = await fetch(tokenUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                grant_type: 'authorization_code',
                client_id: clientId,
                code_verifier: oauthState.codeVerifier,
                redirect_uri: redirectUri,
                code: authArgs.code,
              }),
            });

            if (!tokenResponse.ok) {
              const errorText = await tokenResponse.text();
              logger.error('Token exchange failed', { status: tokenResponse.status, errorText });
              throw new Error(`Token exchange failed (${tokenResponse.status})`);
            }

            const tokenData = (await tokenResponse.json()) as { access_token?: string };
            if (!tokenData.access_token) {
              throw new Error('No access token in server response');
            }

            // Save the session to ~/.augment/session.json
            const sessionPath = path.join(homedir, '.augment', 'session.json');
            const session = {
              accessToken: tokenData.access_token,
              tenantURL: authArgs.tenant_url,
              scopes: ['read', 'write'],
            };
            await fs.writeFile(sessionPath, JSON.stringify(session, null, 2), 'utf-8');

            // Clean up the OAuth state file
            try {
              await fs.unlink(oauthStatePath);
            } catch {
              // Ignore cleanup errors
            }

            logger.info('Direct token exchange succeeded — user authenticated');
            return { success: true, data: { authenticated: true } };
          } catch (exchangeErr) {
            logger.error('Direct token exchange failed', {
              error: (exchangeErr as Error).message,
            });
            return {
              success: false,
              error: (exchangeErr as Error).message || 'Failed to complete authentication',
            };
          }
        }

        return {
          success: false,
          error: 'Invalid action',
        };
      } catch (error) {
        logger.error('Authentication failed', { error: (error as Error).message });
        return {
          success: false,
          error: (error as Error).message || 'Authentication failed',
        };
      }
    },
  );

  // Get available models from auggie CLI
  ipcMain.handle(AUGGIE_CHANNELS.GET_MODELS, async () => {
    try {
      logger.info('Getting models from auggie CLI');

      // First find the auggie path to ensure we're using the right one
      const auggiePath = await findAuggiePathAsync();
      logger.info('Found auggie path for model list', { auggiePath });

      // Try to run auggie model list --json first (richer metadata), fall back to plain text
      try {
        let models: Array<{
          value: string;
          label: string;
          description?: string;
          modelGroupPriority?: number;
          isLegacyModel?: boolean;
          costTier?: number;
          badges?: Array<{ color: string; label: string; variant?: string }>;
          effortLevels?: string[];
          isDefault?: boolean;
          priority?: number;
        }> | null = null;

        // Try JSON format first
        try {
          const { stdout: jsonStdout, stderr: jsonStderr } =
            await executeAuggieCommand('model list --json');
          if (jsonStderr) {
            logger.warn('Auggie model list --json stderr output', { stderr: jsonStderr });
          }
          logger.info('Auggie model list --json stdout', { length: jsonStdout?.length });
          models = parseModelListJson(jsonStdout);
          if (models) {
            logger.info(`Parsed ${models.length} models from JSON output`);
          }
        } catch (jsonError) {
          logger.warn('Auggie model list --json failed, falling back to plain text', {
            error: (jsonError as Error).message,
          });
        }

        // Fall back to plain text format
        if (!models) {
          const { stdout, stderr } = await executeAuggieCommand('model list');
          if (stderr) {
            logger.warn('Auggie model list stderr output', { stderr });
          }
          logger.info('Auggie model list stdout', { stdout, length: stdout?.length });
          models = parseModelListOutput(stdout);
        }

        // If we successfully parsed models, filter and sort them
        if (models && models.length > 0) {
          // Filter out legacy models
          const filteredModels = models.filter((m) => !m.isLegacyModel);

          // Sort by modelGroupPriority (1 first, 2 second, undefined last),
          // then by priority within each group (lower = higher in list),
          // then by display name as a stable tie-breaker to match prod ordering
          const sortedModels = filteredModels.sort((a, b) => {
            const aGroup = a.modelGroupPriority ?? 999;
            const bGroup = b.modelGroupPriority ?? 999;
            if (aGroup !== bGroup) return aGroup - bGroup;
            const aPriority = a.priority ?? 999;
            const bPriority = b.priority ?? 999;
            if (aPriority !== bPriority) return aPriority - bPriority;
            return a.label.localeCompare(b.label);
          });

          logger.info(
            `Successfully retrieved ${sortedModels.length} models from auggie CLI (${models.length} total, ${models.length - sortedModels.length} filtered)`,
          );
          return {
            success: true,
            data: sortedModels,
          };
        }

        // If no models were parsed but command succeeded, report failure
        logger.warn('Auggie model list returned no parseable models');
        return {
          success: false,
          error: 'Could not parse auggie model list output. Please try again.',
        };
      } catch (error) {
        // On Windows/macOS, auggie CLI may crash during exit but still produce valid stdout.
        // Try to parse stdout from the error first.
        const errorWithOutput = error as Error & {
          stdout?: string;
          stderr?: string;
          code?: number | string;
          killed?: boolean;
        };

        // Log full diagnostic information for debugging
        logger.error('Auggie model list command failed', {
          message: errorWithOutput.message,
          exitCode: errorWithOutput.code,
          killed: errorWithOutput.killed,
          stdout: errorWithOutput.stdout?.substring(0, 500),
          stderr: errorWithOutput.stderr?.substring(0, 500),
          auggiePath,
        });

        // Try to parse stdout even if the command exited with an error
        const outputToParse = errorWithOutput.stdout || errorWithOutput.stderr || '';
        if (outputToParse) {
          const models = parseModelListOutput(outputToParse);
          if (models.length > 0) {
            logger.warn('Auggie CLI exited with error but produced valid model output', {
              error: errorWithOutput.message,
              modelCount: models.length,
            });
            return {
              success: true,
              data: models,
              warning: 'Auggie CLI exited with error but models were retrieved successfully',
            };
          }
        }

        // Build a descriptive error message
        const errMsg = errorWithOutput.message || 'Unknown error';
        const stderrHint = errorWithOutput.stderr?.trim()
          ? ` (stderr: ${errorWithOutput.stderr.trim().substring(0, 200)})`
          : '';
        return {
          success: false,
          error: `Auggie CLI failed: ${errMsg}${stderrHint}`,
        };
      }
    } catch (error) {
      logger.error('Error getting models', error as Error);
      return {
        success: false,
        error: (error as Error).message || 'Failed to get models',
      };
    }
  });

  // Get the latest session file
  ipcMain.handle(AUGGIE_CHANNELS.GET_LATEST_SESSION, async () => {
    try {
      const sessionsDir = path.join(os.homedir(), '.auggie', 'sessions');

      // Check if sessions directory exists
      try {
        await fs.access(sessionsDir);
      } catch {
        return {
          success: false,
          error: 'Sessions directory not found',
        };
      }

      // Read all session files
      const files = await fs.readdir(sessionsDir);
      if (files.length === 0) {
        return {
          success: false,
          error: 'No session files found',
        };
      }

      // Get the most recent session file
      let latestFile = files[0];
      let latestTime = 0;

      for (const file of files) {
        const filePath = path.join(sessionsDir, file);
        const stats = await fs.stat(filePath);
        if (stats.mtimeMs > latestTime) {
          latestTime = stats.mtimeMs;
          latestFile = file;
        }
      }

      // Extract session ID from filename (format: session-{id}.json)
      const sessionId = latestFile.replace('session-', '').replace('.json', '');

      return {
        success: true,
        data: {
          sessionId,
          filePath: path.join(sessionsDir, latestFile),
        },
      };
    } catch (error) {
      return {
        success: false,
        error: (error as Error).message || 'Failed to get latest session',
      };
    }
  });

  // Extract file changes from a session
  ipcMain.handle(AUGGIE_CHANNELS.EXTRACT_FILE_CHANGES, async (_, { sessionId, workspacePath }) => {
    try {
      const sessionsDir = path.join(os.homedir(), '.auggie', 'sessions');
      const sessionFile = path.join(sessionsDir, `session-${sessionId}.json`);

      // Check if session file exists
      try {
        await fs.access(sessionFile);
      } catch {
        return {
          success: true,
          data: [], // Return empty array if session file doesn't exist yet
        };
      }

      // Read session file
      const content = await fs.readFile(sessionFile, 'utf-8');
      const sessionData = JSON.parse(content);

      // Extract file changes from the session
      const fileChanges: any[] = [];

      // Look for file changes in the session data
      if (sessionData.messages && Array.isArray(sessionData.messages)) {
        for (const message of sessionData.messages) {
          if (message.contentBlocks && Array.isArray(message.contentBlocks)) {
            for (const block of message.contentBlocks) {
              // Look for tool use blocks that indicate file changes
              if (block.type === 'tool_use' && block.name === 'edit_file') {
                const input = block.input || {};
                fileChanges.push({
                  path: input.path,
                  oldContent: input.old_str || '',
                  newContent: input.new_str || '',
                  type: 'edit',
                });
              } else if (block.type === 'tool_use' && block.name === 'create_file') {
                const input = block.input || {};
                fileChanges.push({
                  path: input.path,
                  oldContent: '',
                  newContent: input.content || '',
                  type: 'create',
                });
              } else if (block.type === 'tool_use' && block.name === 'delete_file') {
                const input = block.input || {};
                fileChanges.push({
                  path: input.path,
                  oldContent: input.content || '',
                  newContent: '',
                  type: 'delete',
                });
              }
            }
          }
        }
      }

      return {
        success: true,
        data: fileChanges,
      };
    } catch (error) {
      logger.error('Error extracting file changes', error instanceof Error ? error : undefined);
      return {
        success: false,
        error: (error as Error).message || 'Failed to extract file changes',
      };
    }
  });

  // Get user info from Augment API (email, tenant, etc.)
  ipcMain.handle(AUGGIE_CHANNELS.GET_USER_INFO, async () => {
    try {
      const { augmentApiClient } = await import('../../../shared/augment-api/augment-api.client');
      const userInfo = await augmentApiClient.getUserInfo();
      if (userInfo) {
        return {
          success: true,
          data: userInfo,
        };
      }
      return {
        success: false,
        error: 'No user info available',
      };
    } catch (error) {
      logger.error('Error getting user info', error instanceof Error ? error : undefined);
      return {
        success: false,
        error: (error as Error).message || 'Failed to get user info',
      };
    }
  });

  // Setup MCP for Claude Code
  ipcMain.handle(AUGGIE_CHANNELS.SETUP_MCP_CLAUDE_CODE, async () => {
    try {
      logger.info('Setting up MCP for Claude Code');

      // Resolve paths
      const { getClaudeCodePath } =
        await import('../../../features/claude-code/main/claude-code-resolver');
      const auggiePath = await findAuggiePathAsync();

      if (!auggiePath) {
        return {
          success: false,
          error: 'Auggie CLI not found. Please install auggie first.',
        };
      }

      const claudePath = await getClaudeCodePath();
      if (!claudePath) {
        return {
          success: false,
          error: 'Claude CLI not found. Please install the Claude CLI first.',
        };
      }

      // Build the MCP config JSON
      const mcpConfig = {
        type: 'stdio',
        command: auggiePath,
        args: ['--mcp', '--mcp-auto-workspace'],
      };

      // First, try to remove any existing auggie entry (ignore errors if it doesn't exist)
      try {
        const removeCommand = `"${claudePath}" mcp remove auggie --scope user`;
        logger.info('Removing existing Claude Code MCP entry (if any)');
        await execWithEnhancedPath(removeCommand, { timeout: 15000 });
        logger.info('Removed existing auggie MCP entry');
      } catch {
        // Entry didn't exist, that's fine
        logger.debug('No existing auggie MCP entry to remove (this is normal for first setup)');
      }

      // Execute: claude mcp add-json auggie --scope user '<json>'
      const jsonString = JSON.stringify(mcpConfig);
      const command = `"${claudePath}" mcp add-json auggie --scope user '${jsonString}'`;

      logger.info('Executing Claude Code MCP setup', {
        command: `${claudePath} mcp add-json auggie --scope user '<json>'`,
      });

      const { stdout, stderr } = await execWithEnhancedPath(command, { timeout: 30000 });

      logger.info('Claude Code MCP setup completed', { stdout, stderr });

      return {
        success: true,
      };
    } catch (error) {
      const errorMessage = (error as Error).message || 'Unknown error';
      logger.error('Failed to setup MCP for Claude Code', { error: errorMessage });
      return {
        success: false,
        error: errorMessage,
      };
    }
  });

  // Setup MCP for Codex
  ipcMain.handle(AUGGIE_CHANNELS.SETUP_MCP_CODEX, async () => {
    try {
      logger.info('Setting up MCP for Codex');

      // Resolve paths
      const { getCodexPath } = await import('../../../features/codex/main/codex-resolver');
      const auggiePath = await findAuggiePathAsync();

      if (!auggiePath) {
        return {
          success: false,
          error: 'Auggie CLI not found. Please install auggie first.',
        };
      }

      const codexPath = await getCodexPath();
      if (!codexPath) {
        return {
          success: false,
          error: 'Codex CLI not found. Please install the Codex CLI first.',
        };
      }

      // Execute: codex mcp add codebase-retrieval -- auggie --mcp --mcp-auto-workspace
      const command = `"${codexPath}" mcp add codebase-retrieval -- "${auggiePath}" --mcp --mcp-auto-workspace`;

      logger.info('Executing Codex MCP setup', { command });

      const { stdout, stderr } = await execWithEnhancedPath(command, { timeout: 30000 });

      logger.info('Codex MCP setup completed', { stdout, stderr });

      return {
        success: true,
      };
    } catch (error) {
      const errorMessage = (error as Error).message || 'Unknown error';
      logger.error('Failed to setup MCP for Codex', { error: errorMessage });
      return {
        success: false,
        error: errorMessage,
      };
    }
  });

  // Setup MCP for OpenCode
  ipcMain.handle(AUGGIE_CHANNELS.SETUP_MCP_OPENCODE, async () => {
    try {
      logger.info('Setting up MCP for OpenCode');

      const auggiePath = await findAuggiePathAsync();

      if (!auggiePath) {
        return {
          success: false,
          error: 'Auggie CLI not found. Please install auggie first.',
        };
      }

      // Read or create ~/.config/opencode/opencode.json
      const configDir = path.join(os.homedir(), '.config', 'opencode');
      const configFile = path.join(configDir, 'opencode.json');

      // Ensure directory exists
      await fs.mkdir(configDir, { recursive: true });

      // Read existing config or create new one
      let config: any = {
        $schema: 'https://opencode.ai/config.json',
        mcp: {},
      };

      try {
        const content = await fs.readFile(configFile, 'utf-8');
        config = JSON.parse(content);
        // Ensure mcp object exists
        if (!config.mcp) {
          config.mcp = {};
        }
      } catch (readError) {
        const errCode = (readError as NodeJS.ErrnoException).code;
        if (errCode !== 'ENOENT') {
          logger.warn('Failed to parse existing OpenCode config, will overwrite', {
            error: (readError as Error).message,
          });
        }
      }

      // Add or update the augment-context-engine entry
      config.mcp['augment-context-engine'] = {
        type: 'local',
        command: [auggiePath, '--mcp', '--mcp-auto-workspace'],
        enabled: true,
      };

      // Write the config file
      await fs.writeFile(configFile, JSON.stringify(config, null, 2), 'utf-8');

      logger.info('OpenCode MCP setup completed', { configFile });

      return {
        success: true,
      };
    } catch (error) {
      const errorMessage = (error as Error).message || 'Unknown error';
      logger.error('Failed to setup MCP for OpenCode', { error: errorMessage });
      return {
        success: false,
        error: errorMessage,
      };
    }
  });

  // Check if MCP is configured for Claude Code
  ipcMain.handle(AUGGIE_CHANNELS.CHECK_MCP_CLAUDE_CODE, async () => {
    try {
      logger.info('Checking MCP configuration for Claude Code');

      const { getClaudeCodePath } =
        await import('../../../features/claude-code/main/claude-code-resolver');
      const claudePath = await getClaudeCodePath();

      if (!claudePath) {
        logger.info('Claude Code CLI not found');
        return {
          success: true,
          configured: false,
        };
      }

      try {
        // Run: claude mcp list (no --json or --scope flags, as they are not supported)
        const { stdout } = await execWithEnhancedPath(`"${claudePath}" mcp list`, {
          timeout: 5000,
        });

        // Parse text output: check if 'auggie' appears in the output
        const isConfigured = stdout.includes('auggie');
        logger.info('Claude Code MCP check completed', { configured: isConfigured });
        return {
          success: true,
          configured: isConfigured,
        };
      } catch (error) {
        // If command fails, assume not configured
        logger.warn('Failed to check Claude Code MCP configuration', {
          error: (error as Error).message,
        });
        return {
          success: true,
          configured: false,
        };
      }
    } catch (error) {
      const errorMessage = (error as Error).message || 'Unknown error';
      logger.error('Error checking Claude Code MCP configuration', { error: errorMessage });
      return {
        success: false,
        error: errorMessage,
      };
    }
  });

  // Check if MCP is configured for Codex
  ipcMain.handle(AUGGIE_CHANNELS.CHECK_MCP_CODEX, async () => {
    try {
      logger.info('Checking MCP configuration for Codex');

      const { getCodexPath } = await import('../../../features/codex/main/codex-resolver');
      const codexPath = await getCodexPath();

      if (!codexPath) {
        logger.info('Codex CLI not found');
        return {
          success: true,
          configured: false,
        };
      }

      try {
        // Try to run: codex mcp list
        const { stdout } = await execWithEnhancedPath(`"${codexPath}" mcp list`, {
          timeout: 5000,
        });

        // Check if output contains codebase-retrieval entry referencing auggie
        const isConfigured = stdout.includes('codebase-retrieval') && stdout.includes('auggie');
        logger.info('Codex MCP check completed', { configured: isConfigured });
        return {
          success: true,
          configured: isConfigured,
        };
      } catch (error) {
        // If command fails, assume not configured
        logger.warn('Failed to check Codex MCP configuration', {
          error: (error as Error).message,
        });
        return {
          success: true,
          configured: false,
        };
      }
    } catch (error) {
      const errorMessage = (error as Error).message || 'Unknown error';
      logger.error('Error checking Codex MCP configuration', { error: errorMessage });
      return {
        success: false,
        error: errorMessage,
      };
    }
  });

  // Check if MCP is configured for OpenCode
  ipcMain.handle(AUGGIE_CHANNELS.CHECK_MCP_OPENCODE, async () => {
    try {
      logger.info('Checking MCP configuration for OpenCode');

      const configFile = path.join(os.homedir(), '.config', 'opencode', 'opencode.json');

      try {
        const content = await fs.readFile(configFile, 'utf-8');
        const config = JSON.parse(content);

        // Check if augment-context-engine is configured and enabled
        const isConfigured =
          config.mcp &&
          config.mcp['augment-context-engine'] &&
          config.mcp['augment-context-engine'].enabled === true;

        logger.info('OpenCode MCP check completed', { configured: isConfigured });
        return {
          success: true,
          configured: isConfigured,
        };
      } catch (readOrParseError) {
        const errCode = (readOrParseError as NodeJS.ErrnoException).code;
        if (errCode === 'ENOENT') {
          logger.info('OpenCode config file not found');
        } else {
          logger.warn('Failed to read/parse OpenCode config file', {
            error: (readOrParseError as Error).message,
          });
        }
        return {
          success: true,
          configured: false,
        };
      }
    } catch (error) {
      const errorMessage = (error as Error).message || 'Unknown error';
      logger.error('Error checking OpenCode MCP configuration', { error: errorMessage });
      return {
        success: false,
        error: errorMessage,
      };
    }
  });

  // Uninstall MCP from Claude Code
  ipcMain.handle(AUGGIE_CHANNELS.UNINSTALL_MCP_CLAUDE_CODE, async () => {
    try {
      logger.info('Uninstalling MCP from Claude Code');

      const { getClaudeCodePath } =
        await import('../../../features/claude-code/main/claude-code-resolver');
      const claudePath = await getClaudeCodePath();

      if (!claudePath) {
        return {
          success: false,
          error: 'Claude CLI not found. Please install the Claude CLI first.',
        };
      }

      const command = `"${claudePath}" mcp remove auggie --scope user`;

      logger.info('Executing Claude Code MCP uninstall', { command });

      const { stdout, stderr } = await execWithEnhancedPath(command, { timeout: 30000 });

      logger.info('Claude Code MCP uninstall completed', { stdout, stderr });

      return {
        success: true,
      };
    } catch (error) {
      const errorMessage = (error as Error).message || 'Unknown error';
      logger.error('Failed to uninstall MCP from Claude Code', { error: errorMessage });
      return {
        success: false,
        error: errorMessage,
      };
    }
  });

  // Uninstall MCP from Codex
  ipcMain.handle(AUGGIE_CHANNELS.UNINSTALL_MCP_CODEX, async () => {
    try {
      logger.info('Uninstalling MCP from Codex');

      const { getCodexPath } = await import('../../../features/codex/main/codex-resolver');
      const codexPath = await getCodexPath();

      if (!codexPath) {
        return {
          success: false,
          error: 'Codex CLI not found. Please install the Codex CLI first.',
        };
      }

      const command = `"${codexPath}" mcp remove codebase-retrieval`;

      logger.info('Executing Codex MCP uninstall', { command });

      const { stdout, stderr } = await execWithEnhancedPath(command, { timeout: 30000 });

      logger.info('Codex MCP uninstall completed', { stdout, stderr });

      return {
        success: true,
      };
    } catch (error) {
      const errorMessage = (error as Error).message || 'Unknown error';
      logger.error('Failed to uninstall MCP from Codex', { error: errorMessage });
      return {
        success: false,
        error: errorMessage,
      };
    }
  });

  // Setup MCP for Cortex
  ipcMain.handle(AUGGIE_CHANNELS.SETUP_MCP_CORTEX, async () => {
    try {
      logger.info('Setting up MCP for Cortex');

      // Resolve paths
      const { getCortexPath } = await import('../../../features/cortex/main/cortex-resolver');
      const auggiePath = await findAuggiePathAsync();

      if (!auggiePath) {
        return {
          success: false,
          error: 'Auggie CLI not found. Please install auggie first.',
        };
      }

      const cortexPath = await getCortexPath();
      if (!cortexPath) {
        return {
          success: false,
          error: 'Cortex CLI not found. Please install the Cortex CLI first.',
        };
      }

      // Execute: cortex mcp add augment-context-engine <auggiePath> -- --mcp --mcp-auto-workspace
      const command = `"${cortexPath}" mcp add augment-context-engine "${auggiePath}" -- --mcp --mcp-auto-workspace`;

      logger.info('Executing Cortex MCP setup', { command });

      const { stdout, stderr } = await execWithEnhancedPath(command, { timeout: 30000 });

      logger.info('Cortex MCP setup completed', { stdout, stderr });

      return {
        success: true,
      };
    } catch (error) {
      const errorMessage = (error as Error).message || 'Unknown error';
      logger.error('Failed to setup MCP for Cortex', { error: errorMessage });
      return {
        success: false,
        error: errorMessage,
      };
    }
  });

  // Check if MCP is configured for Cortex
  ipcMain.handle(AUGGIE_CHANNELS.CHECK_MCP_CORTEX, async () => {
    try {
      logger.info('Checking MCP configuration for Cortex');

      const { getCortexPath } = await import('../../../features/cortex/main/cortex-resolver');
      const cortexPath = await getCortexPath();

      if (!cortexPath) {
        logger.info('Cortex CLI not found');
        return {
          success: true,
          configured: false,
        };
      }

      try {
        // Run: cortex mcp list
        const { stdout } = await execWithEnhancedPath(`"${cortexPath}" mcp list`, {
          timeout: 5000,
        });

        // Check if output contains augment-context-engine
        const isConfigured = stdout.includes('augment-context-engine');
        logger.info('Cortex MCP check completed', { configured: isConfigured });
        return {
          success: true,
          configured: isConfigured,
        };
      } catch (error) {
        // If command fails, assume not configured
        logger.warn('Failed to check Cortex MCP configuration', {
          error: (error as Error).message,
        });
        return {
          success: true,
          configured: false,
        };
      }
    } catch (error) {
      const errorMessage = (error as Error).message || 'Unknown error';
      logger.error('Error checking Cortex MCP configuration', { error: errorMessage });
      return {
        success: false,
        error: errorMessage,
      };
    }
  });

  // Uninstall MCP from Cortex
  ipcMain.handle(AUGGIE_CHANNELS.UNINSTALL_MCP_CORTEX, async () => {
    try {
      logger.info('Uninstalling MCP from Cortex');

      const { getCortexPath } = await import('../../../features/cortex/main/cortex-resolver');
      const cortexPath = await getCortexPath();

      if (!cortexPath) {
        return {
          success: false,
          error: 'Cortex CLI not found. Please install the Cortex CLI first.',
        };
      }

      const command = `"${cortexPath}" mcp remove augment-context-engine`;

      logger.info('Executing Cortex MCP uninstall', { command });

      const { stdout, stderr } = await execWithEnhancedPath(command, { timeout: 30000 });

      logger.info('Cortex MCP uninstall completed', { stdout, stderr });

      return {
        success: true,
      };
    } catch (error) {
      const errorMessage = (error as Error).message || 'Unknown error';
      logger.error('Failed to uninstall MCP from Cortex', { error: errorMessage });
      return {
        success: false,
        error: errorMessage,
      };
    }
  });

  // Uninstall MCP from OpenCode
  ipcMain.handle(AUGGIE_CHANNELS.UNINSTALL_MCP_OPENCODE, async () => {
    try {
      logger.info('Uninstalling MCP from OpenCode');

      const configFile = path.join(os.homedir(), '.config', 'opencode', 'opencode.json');

      try {
        const content = await fs.readFile(configFile, 'utf-8');
        const config = JSON.parse(content);

        if (config.mcp && config.mcp['augment-context-engine']) {
          delete config.mcp['augment-context-engine'];
          await fs.writeFile(configFile, JSON.stringify(config, null, 2), 'utf-8');
          logger.info('OpenCode MCP uninstall completed', { configFile });
        } else {
          logger.info('augment-context-engine not found in OpenCode config, nothing to uninstall');
        }

        return {
          success: true,
        };
      } catch (readOrParseError) {
        const errCode = (readOrParseError as NodeJS.ErrnoException).code;
        if (errCode === 'ENOENT') {
          logger.info('OpenCode config file not found, nothing to uninstall');
          return { success: true };
        }
        logger.warn('Failed to read/parse OpenCode config file during uninstall', {
          error: (readOrParseError as Error).message,
        });
        return {
          success: false,
          error: `Failed to parse OpenCode config: ${(readOrParseError as Error).message}`,
        };
      }
    } catch (error) {
      const errorMessage = (error as Error).message || 'Unknown error';
      logger.error('Failed to uninstall MCP from OpenCode', { error: errorMessage });
      return {
        success: false,
        error: errorMessage,
      };
    }
  });
}
