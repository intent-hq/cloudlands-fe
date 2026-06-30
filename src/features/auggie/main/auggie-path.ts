/**
 * Auggie Path Helpers
 *
 * Shared PATH and auggie-binary discovery helpers used by both `auggie.ipc.ts`
 * (IPC handlers) and `execute-auggie-command.ts` (CLI invocation). Extracted
 * into a dedicated module to break the circular import that existed between
 * the two files.
 */

import {
  existsSync,
  readdirSync,
  readFileSync,
} from 'fs';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { Logger } from '../../../shared/logger';
import { findBinary } from '../../../shared/main/find-binary';
import { getBackendClient } from '../../backend/main/backend.ipc';

const logger = new Logger('AuggiePath');

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

/**
 * Resolve the auggie binary path by delegating to the daemon host
 * (`host.checkAuggie`). The BE applies the settings precedence
 * (`context.auggiePath` → `providers.paths.auggie`) and falls back to the
 * canonical discovery (Intent-managed binary at `~/.augment/bin/auggie`,
 * then a scan of the enhanced PATH including nvm/fnm/volta/asdf/homebrew).
 *
 * Return contract is unchanged (`string | null`) so existing consumers in
 * `provider-availability.service.ts`, `acp-provider.ts`, and the spawn
 * helpers in `execute-auggie-command.ts` keep working without changes.
 */
export async function findAuggiePathAsync(): Promise<string | null> {
  try {
    const result = await getBackendClient().request<{
      available: boolean;
      path?: string;
      version?: string;
    }>('host.checkAuggie');
    if (result?.available && typeof result.path === 'string' && result.path.trim()) {
      const resolved = result.path.trim();
      logger.info('Resolved auggie via host.checkAuggie', { path: resolved });
      return resolved;
    }
    logger.debug('host.checkAuggie reported auggie unavailable');
    return null;
  } catch (error) {
    logger.warn('host.checkAuggie failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}
