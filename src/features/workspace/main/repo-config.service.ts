/**
 * Repository Config Service (Main Process)
 *
 * Reads and writes per-repo `.intent/config.json` files.
 * Ensures the `.intent/` directory and `.gitignore` are properly set up.
 *
 * This service is the single source of truth for repo-level configuration.
 * It provides fallback-aware getters that check repo config before global settings.
 */

import * as fs from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { Logger } from '../../../shared/logger';
import type { RepoConfig } from '../../../shared/types/repo-config.types';
import {
  REPO_INTENT_DIR,
  REPO_CONFIG_FILENAME,
  REPO_INTENT_GITIGNORE,
} from '../../../shared/types/repo-config.types';

const logger = new Logger({ category: 'RepoConfigService' });

/**
 * Get the path to the .intent directory for a repository.
 */
export function getIntentDirPath(repoPath: string): string {
  return path.join(repoPath, REPO_INTENT_DIR);
}

/**
 * Get the path to the config.json file for a repository.
 */
export function getConfigFilePath(repoPath: string): string {
  return path.join(repoPath, REPO_INTENT_DIR, REPO_CONFIG_FILENAME);
}

/**
 * Read the repo config from `.intent/config.json`.
 * Returns an empty config object if the file doesn't exist or is invalid.
 */
export async function readRepoConfig(repoPath: string): Promise<RepoConfig> {
  const configPath = getConfigFilePath(repoPath);

  try {
    const content = await fs.readFile(configPath, 'utf-8');
    const config = JSON.parse(content) as RepoConfig;

    // Validate it's a plain object
    if (typeof config !== 'object' || config === null || Array.isArray(config)) {
      logger.warn('Invalid repo config format, expected object', { repoPath });
      return {};
    }

    logger.debug('Loaded repo config', { repoPath, keys: Object.keys(config) });
    return config;
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      // File doesn't exist — that's fine, return empty config
      return {};
    }
    logger.warn('Failed to read repo config', {
      repoPath,
      error: error instanceof Error ? error.message : String(error),
    });
    return {};
  }
}

/**
 * Write the repo config to `.intent/config.json`.
 * Creates the `.intent/` directory and `.gitignore` if they don't exist.
 */
export async function writeRepoConfig(repoPath: string, config: RepoConfig): Promise<void> {
  const intentDir = getIntentDirPath(repoPath);
  const configPath = getConfigFilePath(repoPath);
  const gitignorePath = path.join(intentDir, '.gitignore');

  try {
    // Ensure .intent directory exists
    await fs.mkdir(intentDir, { recursive: true });

    // Ensure .gitignore exists
    if (!existsSync(gitignorePath)) {
      await fs.writeFile(gitignorePath, REPO_INTENT_GITIGNORE, 'utf-8');
      logger.info('Created .intent/.gitignore', { repoPath });
    }

    // Write config with pretty formatting
    const content = JSON.stringify(config, null, 2) + '\n';
    await fs.writeFile(configPath, content, 'utf-8');

    logger.info('Wrote repo config', { repoPath, keys: Object.keys(config) });
  } catch (error) {
    logger.error('Failed to write repo config', {
      repoPath,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Ensure the `.intent/` directory exists with a proper `.gitignore`.
 * Call this when initializing a workspace from a repo that doesn't have one yet.
 */
export async function ensureIntentDir(repoPath: string): Promise<void> {
  const intentDir = getIntentDirPath(repoPath);
  const gitignorePath = path.join(intentDir, '.gitignore');

  await fs.mkdir(intentDir, { recursive: true });

  if (!existsSync(gitignorePath)) {
    await fs.writeFile(gitignorePath, REPO_INTENT_GITIGNORE, 'utf-8');
    logger.info('Initialized .intent directory', { repoPath });
  }
}

/**
 * Check if a repo has an `.intent/config.json` file.
 */
export function hasRepoConfig(repoPath: string): boolean {
  return existsSync(getConfigFilePath(repoPath));
}

/**
 * Get the branch prefix for a repo, falling back to the global setting.
 * This is the primary integration point with workspace creation.
 */
export async function getRepoBranchPrefix(repoPath: string): Promise<string | undefined> {
  const config = await readRepoConfig(repoPath);
  if (config.branchPrefix !== undefined) {
    return config.branchPrefix;
  }
  return undefined; // Caller should fall back to global setting
}

/**
 * Get the default setup script for a repo.
 * Returns undefined if no repo-level default is configured.
 */
export async function getRepoSetupScript(repoPath: string): Promise<string | undefined> {
  const config = await readRepoConfig(repoPath);
  return config.setupScript;
}

/**
 * Get the repo-level instructions for agents.
 * Returns undefined if no instructions are configured.
 */
export async function getRepoInstructions(repoPath: string): Promise<string | undefined> {
  const config = await readRepoConfig(repoPath);
  return config.instructions;
}
