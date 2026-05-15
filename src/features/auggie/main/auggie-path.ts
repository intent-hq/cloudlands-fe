/**
 * Auggie Path Helpers
 *
 * Shared PATH and auggie-binary discovery helpers used by both `auggie.ipc.ts`
 * (IPC handlers) and `execute-auggie-command.ts` (CLI invocation). Extracted
 * into a dedicated module to break the circular import that existed between
 * the two files.
 */

import ElectronStore from 'electron-store';
import {
  existsSync,
  readdirSync,
  readFileSync,
} from 'fs';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { Logger } from '../../../shared/logger';
import { findAuggieAsync } from '../../../shared/main/async-utils';
import { findBinary } from '../../../shared/main/find-binary';

const logger = new Logger('AuggiePath');

// Settings store for accessing user-configured auggie path
let settingsStore: ElectronStore | null = null;

function getSettingsStore(): ElectronStore {
  if (!settingsStore) {
    settingsStore = new ElectronStore({ name: 'settings' });
  }
  return settingsStore;
}

export function getEnhancedPath(): string {
  const pathSeparator = process.platform === 'win32' ? ';' : ':';
  const paths = new Set<string>();

  // Start with current PATH
  if (process.env.PATH) {
    process.env.PATH.split(pathSeparator).forEach((p) => {
      if (p.trim()) paths.add(p.trim());
    });
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
                if (p.trim() && !p.includes('$')) {
                  paths.add(p.trim());
                }
              });
            }
          }
        } catch {
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
      } catch {
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

export async function saveAuggiePath(auggiePath: string): Promise<void> {
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

export async function findAuggieInEnhancedPath(): Promise<string | null> {
  // Temporarily override process.env.PATH with the richer enhanced PATH from
  // this module so that findBinary's internal `which`/`where` lookup inherits
  // NVM, FNM, Volta, Homebrew node@N, and shell-profile-derived directories.
  const originalPath = process.env.PATH;
  try {
    process.env.PATH = getEnhancedPath();
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
  } finally {
    if (originalPath === undefined) {
      delete process.env.PATH;
    } else {
      process.env.PATH = originalPath;
    }
  }
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
