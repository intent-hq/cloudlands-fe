/**
 * Scripts Persistence Layer
 *
 * Reads and writes workspace script definitions to .workspace/scripts.json.
 * Uses atomic writes (writeJsonWithSync) for durability.
 * Recovers gracefully from corrupt files (returns empty array + warning).
 */

import { promises as fs } from 'fs';
import * as path from 'path';
import { Logger } from '../../../shared/logger';
import { WorkspaceConfig } from '../../../shared/main/config';
import { writeJsonWithSync } from '../../../shared/main/file-sync-utils';
import { ScriptsFileFormatSchema } from '../schemas';
import type { WorkspaceScript, ScriptsFileFormat } from '../types';
import { REPO_INTENT_DIR } from '../../../shared/types/repo-config.types';
import type { RepoScript } from '../../../shared/types/repo-config.types';
import {
  readRepoConfig,
  writeRepoConfig,
} from '../../workspace/main/repo-config.service';

const logger = new Logger('ScriptsPersistence');

/** Current schema version for scripts.json */
const CURRENT_VERSION = 1;

/** Filename within the .workspace directory */
const SCRIPTS_FILENAME = 'scripts.json';

/**
 * Get the path to scripts.json for a workspace.
 */
function getScriptsPath(workspaceId: string): string {
  const metadataDir = WorkspaceConfig.paths.metadata(workspaceId);
  return path.join(metadataDir, SCRIPTS_FILENAME);
}

/**
 * Read all script definitions for a workspace.
 *
 * Returns an empty array if:
 * - The file doesn't exist (first use)
 * - The file is corrupt or invalid
 *
 * Never throws — logs warnings for corrupt files.
 */
export async function readScripts(workspaceId: string): Promise<WorkspaceScript[]> {
  const scriptsPath = getScriptsPath(workspaceId);

  try {
    const content = await fs.readFile(scriptsPath, 'utf-8');
    const raw = JSON.parse(content);

    const result = ScriptsFileFormatSchema.safeParse(raw);
    if (!result.success) {
      logger.warn('Invalid scripts.json format, returning empty', {
        workspaceId,
        errors: result.error.issues.map((i) => i.message),
      });
      return [];
    }

    return result.data.scripts;
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === 'ENOENT') {
      // File doesn't exist yet — normal for new workspaces
      return [];
    }

    logger.warn('Failed to read scripts.json, returning empty', {
      workspaceId,
      error: err.message,
    });
    return [];
  }
}

/**
 * Write all script definitions for a workspace.
 *
 * Uses atomic write pattern (temp file + rename) for durability.
 * Ensures the .workspace directory exists before writing.
 */
export async function writeScripts(
  workspaceId: string,
  scripts: WorkspaceScript[],
): Promise<void> {
  const scriptsPath = getScriptsPath(workspaceId);

  // Ensure .workspace directory exists
  const metadataDir = path.dirname(scriptsPath);
  await fs.mkdir(metadataDir, { recursive: true });

  const data: ScriptsFileFormat = {
    version: CURRENT_VERSION,
    scripts,
  };

  try {
    await writeJsonWithSync(scriptsPath, data, { spaces: 2 });
    logger.debug('Scripts written successfully', {
      workspaceId,
      count: scripts.length,
    });
  } catch (error) {
    logger.error('Failed to write scripts.json', error as Error, {
      workspaceId,
      scriptsPath,
    });
    throw error;
  }
}

/**
 * Add or update a script in the persistence file.
 * If a script with the same ID exists, it is replaced.
 */
export async function upsertScript(
  workspaceId: string,
  script: WorkspaceScript,
): Promise<void> {
  const scripts = await readScripts(workspaceId);
  const index = scripts.findIndex((s) => s.id === script.id);

  if (index >= 0) {
    scripts[index] = script;
  } else {
    scripts.push(script);
  }

  await writeScripts(workspaceId, scripts);
}

/**
 * Remove a script from the persistence file by ID.
 * Returns true if the script was found and removed.
 */
export async function removeScript(
  workspaceId: string,
  scriptId: string,
): Promise<boolean> {
  const scripts = await readScripts(workspaceId);
  const filtered = scripts.filter((s) => s.id !== scriptId);

  if (filtered.length === scripts.length) {
    return false; // Script not found
  }

  await writeScripts(workspaceId, filtered);
  return true;
}

// ============================================================================
// Repo-level persistence (.intent/scripts.json)
// ============================================================================

/**
 * Get the path to scripts.json in the repo-level .intent directory.
 */
function getRepoScriptsPath(repoPath: string): string {
  return path.join(repoPath, REPO_INTENT_DIR, SCRIPTS_FILENAME);
}

/**
 * Read all script definitions from the repo-level .intent/scripts.json.
 *
 * Returns an empty array if:
 * - The file doesn't exist
 * - The file is corrupt or invalid
 *
 * Never throws — logs warnings for corrupt files.
 */
export async function readRepoScripts(repoPath: string): Promise<WorkspaceScript[]> {
  const scriptsPath = getRepoScriptsPath(repoPath);

  try {
    const content = await fs.readFile(scriptsPath, 'utf-8');
    const raw = JSON.parse(content);

    const result = ScriptsFileFormatSchema.safeParse(raw);
    if (!result.success) {
      logger.warn('Invalid repo-level scripts.json format, returning empty', {
        repoPath,
        errors: result.error.issues.map((i) => i.message),
      });
      return [];
    }

    return result.data.scripts;
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === 'ENOENT') {
      return [];
    }

    logger.warn('Failed to read repo-level scripts.json, returning empty', {
      repoPath,
      error: err.message,
    });
    return [];
  }
}

/**
 * Persist script definitions into the repo-level `.intent/config.json`,
 * preserving every non-script key (branchPrefix, setupScript, …).
 *
 * An empty `scripts` array is treated as "nothing to save": the existing
 * config is left untouched (`written: false`) so a caller whose live source
 * came back empty can never clobber a populated repo config with `[]`.
 *
 * Throws on write failure — callers must surface the error, never report
 * success on a write that dropped data.
 */
export async function saveScriptsToRepoConfig(
  repoPath: string,
  scripts: RepoScript[],
): Promise<{ written: boolean }> {
  if (scripts.length === 0) {
    return { written: false };
  }
  const existingConfig = await readRepoConfig(repoPath);
  await writeRepoConfig(repoPath, { ...existingConfig, scripts });
  return { written: true };
}

