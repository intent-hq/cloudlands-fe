/**
 * Repo Config IPC
 *
 * IPC handlers for reading/writing per-repo `.intent/config.json` files.
 * These handlers allow the renderer process to interact with repo-level configuration.
 */

import { ipcMain } from 'electron';
import { Logger } from '../../../shared/logger';
import { REPO_CONFIG_CHANNELS } from '$shared/ipc/channels';
import {
  readRepoConfig,
  writeRepoConfig,
  hasRepoConfig,
  ensureIntentDir,
} from './repo-config.service';
import type { RepoConfig } from '../../../shared/types/repo-config.types';

const logger = new Logger('RepoConfigIPC');

export function setupRepoConfigIPC(): void {
  logger.info('Setting up repo config IPC handlers');

  // Read repo config
  ipcMain.handle(
    REPO_CONFIG_CHANNELS.READ,
    async (_event, { repoPath }: { repoPath: string }) => {
      try {
        if (!repoPath || typeof repoPath !== 'string') {
          return { success: false, error: 'repoPath is required' };
        }
        const config = await readRepoConfig(repoPath);
        return { success: true, data: config };
      } catch (error) {
        logger.error('Failed to read repo config', {
          repoPath,
          error: error instanceof Error ? error.message : String(error),
        });
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    },
  );

  // Write repo config
  ipcMain.handle(
    REPO_CONFIG_CHANNELS.WRITE,
    async (_event, { repoPath, config }: { repoPath: string; config: RepoConfig }) => {
      try {
        if (!repoPath || typeof repoPath !== 'string') {
          return { success: false, error: 'repoPath is required' };
        }
        if (!config || typeof config !== 'object') {
          return { success: false, error: 'config must be an object' };
        }
        await writeRepoConfig(repoPath, config);
        return { success: true };
      } catch (error) {
        logger.error('Failed to write repo config', {
          repoPath,
          error: error instanceof Error ? error.message : String(error),
        });
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    },
  );

  // Check if repo has config
  ipcMain.handle(
    REPO_CONFIG_CHANNELS.HAS_CONFIG,
    async (_event, { repoPath }: { repoPath: string }) => {
      try {
        if (!repoPath || typeof repoPath !== 'string') {
          return { success: false, error: 'repoPath is required' };
        }
        const exists = hasRepoConfig(repoPath);
        return { success: true, data: exists };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    },
  );

  // Ensure .intent directory exists
  ipcMain.handle(
    REPO_CONFIG_CHANNELS.ENSURE_INTENT_DIR,
    async (_event, { repoPath }: { repoPath: string }) => {
      try {
        if (!repoPath || typeof repoPath !== 'string') {
          return { success: false, error: 'repoPath is required' };
        }
        await ensureIntentDir(repoPath);
        return { success: true };
      } catch (error) {
        logger.error('Failed to ensure .intent directory', {
          repoPath,
          error: error instanceof Error ? error.message : String(error),
        });
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    },
  );

  logger.info('Repo config IPC handlers setup complete');
}
