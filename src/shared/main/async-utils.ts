/**
 * Async Utilities for Main Process
 *
 * Provides async alternatives to synchronous operations to prevent
 * blocking the main thread and causing UI freezes (beach balls).
 *
 * All functions in this file are designed to be non-blocking.
 */

import { exec, execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Logger } from '../logger';
import { renameWithRetry } from './file-sync-utils';

const logger = new Logger('AsyncUtils');

// Promisified versions of child_process functions
// Wrapped to inject windowsHide: true, which prevents visible cmd.exe windows on Windows
const _execAsync = promisify(exec);
const _execFileAsync = promisify(execFile);

export const execAsync = ((command: string, options?: any) =>
  _execAsync(command, { windowsHide: true, ...options })) as typeof _execAsync;

export const execFileAsync = ((file: string, ...rest: any[]) => {
  // execFile has overloads: (file, args?, options?, callback?)
  // We need to inject windowsHide into the options argument
  const args = rest[0];
  const options = rest[1];
  if (Array.isArray(args)) {
    return _execFileAsync(file, args, { windowsHide: true, ...options });
  }
  // args is actually options
  return _execFileAsync(file, { windowsHide: true, ...args });
}) as typeof _execFileAsync;

// Promisified fs functions
export const writeFileAsync = promisify(fs.writeFile);
export const readFileAsync = promisify(fs.readFile);
export const mkdirAsync = promisify(fs.mkdir);
export const existsAsync = async (filePath: string): Promise<boolean> => {
  try {
    await fs.promises.access(filePath);
    return true;
  } catch {
    return false;
  }
};

/**
 * Find an executable in PATH or common locations asynchronously.
 * Replaces synchronous `which` calls that block the main thread.
 *
 * @param command - The command to find (e.g., 'code', 'auggie')
 * @param commonPaths - Optional list of common paths to check
 * @returns The path to the executable, or null if not found
 */
export async function findExecutableAsync(
  command: string,
  commonPaths: string[] = [],
): Promise<string | null> {
  // Try using 'which' command first (async)
  try {
    const whichCommand = process.platform === 'win32' ? 'where' : 'which';
    const { stdout } = await execAsync(`${whichCommand} ${command}`, {
      timeout: 5000,
      encoding: 'utf-8',
    });
    const lines = stdout.trim().split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

    // On Windows, 'where' returns multiple results (e.g., auggie and auggie.cmd).
    // Prefer .cmd files since they are the proper executable wrappers for npm packages.
    let result = lines[0];
    if (process.platform === 'win32' && lines.length > 1) {
      const cmdResult = lines.find((l) => l.endsWith('.cmd'));
      if (cmdResult) {
        result = cmdResult;
      }
    }

    if (result) {
      logger.debug(`Found ${command} via ${whichCommand}`, { path: result });
      return result;
    }
  } catch {
    // Command not in PATH, try common locations
  }

  // Check common paths asynchronously
  for (const commonPath of commonPaths) {
    if (await existsAsync(commonPath)) {
      logger.debug(`Found ${command} at common path`, { path: commonPath });
      return commonPath;
    }
  }

  return null;
}

/**
 * Common paths for VSCode on different platforms
 */
export const VSCODE_COMMON_PATHS: string[] =
  process.platform === 'darwin'
    ? [
        '/usr/local/bin/code',
        '/opt/homebrew/bin/code',
        '/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code',
      ]
    : process.platform === 'win32'
      ? [
          'C:\\Program Files\\Microsoft VS Code\\bin\\code.cmd',
          'C:\\Program Files (x86)\\Microsoft VS Code\\bin\\code.cmd',
        ]
      : ['/usr/bin/code', '/snap/bin/code'];

/**
 * Get common paths for Auggie CLI based on platform.
 * Includes npm global bin locations, nvm paths, and other node version managers.
 */
function getAuggieCommonPaths(): string[] {
  const homeDir = os.homedir();
  const paths: string[] = [];

  if (process.platform === 'win32') {
    // Windows: npm global locations
    const appData = process.env.APPDATA || '';
    const localAppData = process.env.LOCALAPPDATA || '';
    paths.push(
      path.join(appData, 'npm', 'auggie.cmd'),
      path.join(appData, 'npm', 'auggie'),
      path.join(localAppData, 'npm', 'auggie.cmd'),
      path.join(localAppData, 'npm', 'auggie'),
      // nvm-windows
      path.join(appData, 'nvm', 'auggie.cmd'),
      // volta on windows
      path.join(localAppData, 'Volta', 'bin', 'auggie.exe'),
    );
  } else {
    // macOS / Linux
    paths.push(
      // Standard system locations
      '/usr/local/bin/auggie',
      '/opt/homebrew/bin/auggie', // Apple Silicon Macs

      // npm global bin locations (various configurations)
      path.join(homeDir, '.npm-global', 'bin', 'auggie'),
      path.join(homeDir, '.npm-packages', 'bin', 'auggie'),
      path.join(homeDir, '.local', 'bin', 'auggie'),
      path.join(homeDir, 'npm', 'bin', 'auggie'),

      // volta
      path.join(homeDir, '.volta', 'bin', 'auggie'),

      // fnm (Fast Node Manager)
      path.join(homeDir, '.fnm', 'aliases', 'default', 'bin', 'auggie'),

      // asdf
      path.join(homeDir, '.asdf', 'shims', 'auggie'),

      // n (node version manager)
      path.join(homeDir, 'n', 'bin', 'auggie'),
      '/usr/local/n/bin/auggie',

      // Homebrew node paths (Intel and Apple Silicon)
      '/usr/local/opt/node/bin/auggie',
      '/opt/homebrew/opt/node/bin/auggie',
      '/usr/local/opt/node@18/bin/auggie',
      '/usr/local/opt/node@20/bin/auggie',
      '/usr/local/opt/node@22/bin/auggie',
      '/opt/homebrew/opt/node@18/bin/auggie',
      '/opt/homebrew/opt/node@20/bin/auggie',
      '/opt/homebrew/opt/node@22/bin/auggie',
    );
  }

  return paths;
}

/**
 * Dynamically scan nvm directories to find auggie in any installed node version.
 * Returns paths sorted by version (newest first) so we prefer newer node versions.
 */
async function scanNvmPaths(): Promise<string[]> {
  const homeDir = os.homedir();
  const nvmDir = path.join(homeDir, '.nvm', 'versions', 'node');
  const paths: string[] = [];

  try {
    const nodeDirs = await fs.promises.readdir(nvmDir);
    // Sort by version descending (v22 before v20 before v18, etc.)
    const sortedDirs = nodeDirs
      .filter((dir) => dir.startsWith('v'))
      .sort((a, b) => {
        const versionA = a.replace('v', '').split('.').map(Number);
        const versionB = b.replace('v', '').split('.').map(Number);
        for (let i = 0; i < 3; i++) {
          if ((versionA[i] || 0) !== (versionB[i] || 0)) {
            return (versionB[i] || 0) - (versionA[i] || 0);
          }
        }
        return 0;
      });

    for (const dir of sortedDirs) {
      paths.push(path.join(nvmDir, dir, 'bin', 'auggie'));
    }
  } catch {
    // nvm directory doesn't exist or can't be read
  }

  return paths;
}

/**
 * Dynamically scan fnm directories to find auggie in any installed node version.
 */
async function scanFnmPaths(): Promise<string[]> {
  const homeDir = os.homedir();
  const fnmDir = path.join(homeDir, '.fnm', 'node-versions');
  const paths: string[] = [];

  try {
    const nodeDirs = await fs.promises.readdir(fnmDir);
    for (const dir of nodeDirs) {
      paths.push(path.join(fnmDir, dir, 'installation', 'bin', 'auggie'));
    }
  } catch {
    // fnm directory doesn't exist or can't be read
  }

  return paths;
}

/**
 * Common paths for Auggie CLI (static list, use getAuggieCommonPaths() for dynamic)
 */
export const AUGGIE_COMMON_PATHS: string[] = getAuggieCommonPaths();

/**
 * Find VSCode executable asynchronously
 */
export async function findVSCodeAsync(): Promise<string | null> {
  return findExecutableAsync('code', VSCODE_COMMON_PATHS);
}

/**
 * Find Auggie CLI asynchronously.
 * First checks saved path in ~/.augment/auggie-path, then tries `which auggie`,
 * then checks common hardcoded paths, then dynamically scans nvm and fnm directories.
 */
export async function findAuggieAsync(): Promise<string | null> {
  // Check for saved auggie path in ~/.augment/auggie-path (cached from previous discovery)
  try {
    const savedPathFile = path.join(os.homedir(), '.augment', 'auggie-path');
    if (await existsAsync(savedPathFile)) {
      const savedPath = (await fs.promises.readFile(savedPathFile, 'utf8')).trim();
      if (savedPath && (await existsAsync(savedPath))) {
        logger.debug('Found auggie via saved path file', { path: savedPath });
        return savedPath;
      }
    }
  } catch {
    // Ignore errors reading saved path
  }

  // Try which command and static common paths
  const result = await findExecutableAsync('auggie', AUGGIE_COMMON_PATHS);
  if (result) {
    return result;
  }

  // Dynamically scan nvm paths
  const nvmPaths = await scanNvmPaths();
  for (const nvmPath of nvmPaths) {
    if (await existsAsync(nvmPath)) {
      logger.debug('Found auggie in nvm path', { path: nvmPath });
      return nvmPath;
    }
  }

  // Dynamically scan fnm paths
  const fnmPaths = await scanFnmPaths();
  for (const fnmPath of fnmPaths) {
    if (await existsAsync(fnmPath)) {
      logger.debug('Found auggie in fnm path', { path: fnmPath });
      return fnmPath;
    }
  }

  return null;
}

/**
 * Get npm global bin directory asynchronously
 */
export async function getNpmGlobalBinAsync(): Promise<string | null> {
  try {
    const { stdout } = await execAsync('npm bin -g', {
      encoding: 'utf-8',
      timeout: 5000,
    });
    return stdout.trim();
  } catch {
    return null;
  }
}

/**
 * Write JSON to file asynchronously with atomic write pattern
 */
export async function writeJsonAsync(
  filePath: string,
  data: unknown,
  options?: { spaces?: number },
): Promise<void> {
  const content = JSON.stringify(data, null, options?.spaces ?? 2);
  const dir = path.dirname(filePath);

  // Ensure directory exists (guard against Windows drive roots like C:\)
  if (dir && dir.length > 3 && !/^[A-Za-z]:\\?$/.test(dir)) {
    await fs.promises.mkdir(dir, { recursive: true });
  }

  // Write to temp file first, then rename (atomic)
  const tempPath = `${filePath}.tmp.${Date.now()}`;
  await fs.promises.writeFile(tempPath, content, 'utf-8');
  await renameWithRetry(tempPath, filePath);
}

/**
 * Read JSON from file asynchronously with error handling
 */
export async function readJsonAsync<T>(filePath: string): Promise<T | null> {
  try {
    const content = await fs.promises.readFile(filePath, 'utf-8');
    return JSON.parse(content) as T;
  } catch {
    return null;
  }
}
