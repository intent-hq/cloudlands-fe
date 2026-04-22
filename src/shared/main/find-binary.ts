import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Logger } from '../logger';
import { execAsync } from './async-utils';

const logger = new Logger('FindBinary');

const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_WINDOWS_PREFER_EXTENSIONS = ['.cmd', '.exe'];
const SAFE_BINARY_NAME = /^[a-zA-Z0-9._-]+$/;
const binaryCache = new Map<string, string | null>();

export interface FindBinaryOptions {
  commonPaths?: string[];
  preferExtensions?: string[];
  useLoginShell?: boolean;
  useEnhancedPath?: boolean;
  timeout?: number;
  cache?: boolean;
  retry?: boolean;
}

function isWindows(): boolean {
  return process.platform === 'win32';
}

function getPreferExtensions(preferExtensions?: string[]): string[] {
  if (preferExtensions && preferExtensions.length > 0) {
    return preferExtensions;
  }

  return isWindows() ? DEFAULT_WINDOWS_PREFER_EXTENSIONS : [];
}

function uniquePaths(paths: string[]): string[] {
  return Array.from(new Set(paths.filter(Boolean)));
}

function cacheKey(
  name: string,
  options: Pick<FindBinaryOptions, 'commonPaths' | 'preferExtensions' | 'useEnhancedPath' | 'useLoginShell'>,
): string {
  return `${name}\0${JSON.stringify({
    commonPaths: options.commonPaths || [],
    preferExtensions: options.preferExtensions || [],
    useEnhancedPath: options.useEnhancedPath,
    useLoginShell: options.useLoginShell,
  })}`;
}

type ExecWithOptionalRetryOptions = {
  timeout: number;
  encoding?: BufferEncoding;
  env?: NodeJS.ProcessEnv;
};

async function execWithOptionalRetry(
  command: string,
  options: ExecWithOptionalRetryOptions,
  retry: boolean,
): Promise<{ stdout: string; stderr: string }> {
  if (retry) {
    const { execAsyncWithRetry } = await import('../git/git-env');
    return execAsyncWithRetry(command, options);
  }

  return execAsync(command, options);
}

function scanVersionManagerPaths(
  rootPath: string,
  resolveCandidate: (entryName: string) => string,
): string[] {
  try {
    return fs
      .readdirSync(rootPath, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
      .map(resolveCandidate);
  } catch {
    return [];
  }
}

export function getCommonNpmPaths(binaryName: string): string[] {
  const homeDir = os.homedir();

  if (isWindows()) {
    const appData = process.env.APPDATA || path.join(homeDir, 'AppData', 'Roaming');
    const localAppData = process.env.LOCALAPPDATA || path.join(homeDir, 'AppData', 'Local');
    const userProfile = process.env.USERPROFILE || homeDir;

    return uniquePaths([
      path.join(appData, 'npm', `${binaryName}.cmd`),
      path.join(appData, 'npm', binaryName),
      path.join(localAppData, 'npm', `${binaryName}.cmd`),
      path.join(localAppData, 'npm', binaryName),
      path.join(appData, 'nvm', `${binaryName}.cmd`),
      path.join(appData, 'nvm', binaryName),
      path.join(localAppData, 'Volta', 'bin', `${binaryName}.exe`),
      path.join(localAppData, 'Volta', 'bin', `${binaryName}.cmd`),
      path.join(userProfile, 'scoop', 'shims', `${binaryName}.exe`),
      path.join(userProfile, 'scoop', 'shims', `${binaryName}.cmd`),
      path.join(localAppData, 'Programs', binaryName, `${binaryName}.exe`),
      path.join(localAppData, 'Programs', binaryName, `${binaryName}.cmd`),
      path.join(localAppData, 'Programs', binaryName, 'bin', `${binaryName}.exe`),
      path.join(localAppData, 'Programs', binaryName, 'bin', `${binaryName}.cmd`),
      path.join(homeDir, '.local', 'bin', `${binaryName}.exe`),
      path.join(homeDir, '.local', 'bin', `${binaryName}.cmd`),
      path.join(homeDir, '.local', 'bin', binaryName),
    ]);
  }

  const nvmRoot = path.join(homeDir, '.nvm', 'versions', 'node');
  const fnmRoot = path.join(homeDir, '.fnm', 'node-versions');
  const homebrewNodeVersions = ['18', '20', '22'];

  return uniquePaths([
    `/usr/local/bin/${binaryName}`,
    `/usr/bin/${binaryName}`,
    `/opt/homebrew/bin/${binaryName}`,
    path.join(homeDir, '.local', 'bin', binaryName),
    path.join(homeDir, '.bun', 'bin', binaryName),
    path.join(homeDir, '.npm-global', 'bin', binaryName),
    path.join(homeDir, '.npm-packages', 'bin', binaryName),
    path.join(homeDir, 'npm', 'bin', binaryName),
    path.join(homeDir, '.volta', 'bin', binaryName),
    path.join(homeDir, '.fnm', 'aliases', 'default', 'bin', binaryName),
    path.join(homeDir, '.asdf', 'shims', binaryName),
    path.join(homeDir, 'n', 'bin', binaryName),
    `/usr/local/n/bin/${binaryName}`,
    `/usr/local/opt/node/bin/${binaryName}`,
    `/opt/homebrew/opt/node/bin/${binaryName}`,
    ...homebrewNodeVersions.flatMap((version) => [
      `/usr/local/opt/node@${version}/bin/${binaryName}`,
      `/opt/homebrew/opt/node@${version}/bin/${binaryName}`,
    ]),
    ...scanVersionManagerPaths(nvmRoot, (entryName) => path.join(nvmRoot, entryName, 'bin', binaryName)),
    ...scanVersionManagerPaths(fnmRoot, (entryName) =>
      path.join(fnmRoot, entryName, 'installation', 'bin', binaryName),
    ),
  ]);
}

export function getCommonNpxPaths(): string[] {
  return getCommonNpmPaths('npx');
}

function getEssentialSystemPaths(): string[] {
  if (isWindows()) {
    return [
      process.env.SystemRoot ? `${process.env.SystemRoot}\\System32` : 'C:\\Windows\\System32',
      process.env.SystemRoot
        ? `${process.env.SystemRoot}\\System32\\wbem`
        : 'C:\\Windows\\System32\\wbem',
      'C:\\Program Files\\Git\\cmd',
      'C:\\Program Files (x86)\\Git\\cmd',
      ...(process.env.LOCALAPPDATA ? [`${process.env.LOCALAPPDATA}\\Programs\\Git\\cmd`] : []),
      ...(process.env.USERPROFILE ? [`${process.env.USERPROFILE}\\scoop\\shims`] : []),
      'C:\\ProgramData\\chocolatey\\bin',
    ];
  }

  return ['/bin', '/usr/bin', '/usr/local/bin', '/opt/homebrew/bin', '/usr/sbin', '/sbin'];
}

export function getEnhancedPath(): string {
  const pathSeparator = isWindows() ? ';' : ':';
  const currentPath = process.env.PATH || '';
  const pathSet = new Set(currentPath.split(pathSeparator).filter(Boolean));
  const essentialSystemPaths = getEssentialSystemPaths();

  for (const systemPath of essentialSystemPaths) {
    pathSet.add(systemPath);
  }

  const result = Array.from(pathSet).join(pathSeparator);

  if (isWindows()) {
    if (!result.toLowerCase().includes('system32')) {
      return essentialSystemPaths.join(pathSeparator) + (result ? pathSeparator + result : '');
    }
  } else if (!result.includes('/bin')) {
    return essentialSystemPaths.join(':') + (result ? ':' + result : '');
  }

  return result;
}

function choosePreferredResult(candidates: string[], preferExtensions: string[]): string | null {
  if (candidates.length === 0) {
    return null;
  }

  const normalizedExtensions = preferExtensions.map((extension) => extension.toLowerCase());

  for (const extension of normalizedExtensions) {
    const match = candidates.find((candidate) => candidate.toLowerCase().endsWith(extension));
    if (match) {
      return match;
    }
  }

  return candidates[0] || null;
}

async function findBinaryInCommandPath(
  name: string,
  preferExtensions: string[],
  timeout: number,
  useEnhancedPath: boolean,
  retry: boolean,
): Promise<string | null> {
  const command = isWindows() ? 'where' : 'which';

  try {
    const { stdout } = await execWithOptionalRetry(`${command} ${name}`, {
      timeout,
      encoding: 'utf-8',
      env: {
        ...process.env,
        ...(useEnhancedPath ? { PATH: getEnhancedPath() } : {}),
      },
    }, retry);

    const candidates = stdout
      .trim()
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    return choosePreferredResult(candidates, preferExtensions);
  } catch (error) {
    logger.debug('Binary not found via command lookup', {
      name,
      command,
      error: (error as Error).message,
    });
    return null;
  }
}

function getLoginShellPath(): string {
  if (process.env.SHELL) {
    return process.env.SHELL;
  }

  return process.platform === 'darwin' ? '/bin/zsh' : '/bin/bash';
}

async function findBinaryInLoginShell(
  name: string,
  timeout: number,
  useEnhancedPath: boolean,
  retry: boolean,
): Promise<string | null> {
  if (isWindows()) {
    return null;
  }

  const shell = getLoginShellPath();

  try {
    const { stdout } = await execWithOptionalRetry(`${shell} -l -c "which ${name}"`, {
      timeout,
      encoding: 'utf-8',
      env: {
        ...process.env,
        ...(useEnhancedPath ? { PATH: getEnhancedPath() } : {}),
      },
    }, retry);

    const resolvedPath = stdout
      .trim()
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean);

    if (resolvedPath && fs.existsSync(resolvedPath)) {
      return resolvedPath;
    }
  } catch (error) {
    logger.debug('Binary not found via login shell', {
      name,
      shell,
      error: (error as Error).message,
    });
  }

  return null;
}

export function clearBinaryCache(name?: string): void {
  if (name) {
    const prefix = `${name}\0`;
    for (const key of binaryCache.keys()) {
      if (key === name || key.startsWith(prefix)) {
        binaryCache.delete(key);
      }
    }
    return;
  }

  binaryCache.clear();
}

export async function findBinary(
  name: string,
  options: FindBinaryOptions = {},
): Promise<string | null> {
  if (!SAFE_BINARY_NAME.test(name)) {
    logger.warn('Invalid binary name rejected', { name });
    return null;
  }

  const useCache = options.cache !== false;
  const timeout = options.timeout ?? DEFAULT_TIMEOUT_MS;
  const commonPaths = uniquePaths(options.commonPaths || []);
  const preferExtensions = getPreferExtensions(options.preferExtensions);
  const useEnhancedPath = options.useEnhancedPath !== false;
  const useLoginShell = options.useLoginShell ?? !isWindows();
  const retry = options.retry ?? false;
  const key = cacheKey(name, { commonPaths, preferExtensions, useEnhancedPath, useLoginShell });

  if (useCache && binaryCache.has(key)) {
    return binaryCache.get(key) ?? null;
  }

  const commandPath = await findBinaryInCommandPath(name, preferExtensions, timeout, useEnhancedPath, retry);
  if (commandPath) {
    if (useCache) {
      binaryCache.set(key, commandPath);
    }
    return commandPath;
  }

  for (const candidatePath of commonPaths) {
    if (fs.existsSync(candidatePath)) {
      if (useCache) {
        binaryCache.set(key, candidatePath);
      }
      return candidatePath;
    }
  }

  if (useLoginShell) {
    const loginShellPath = await findBinaryInLoginShell(name, timeout, useEnhancedPath, retry);
    if (loginShellPath) {
      if (useCache) {
        binaryCache.set(key, loginShellPath);
      }
      return loginShellPath;
    }
  }

  if (useCache) {
    binaryCache.set(key, null);
  }

  return null;
}