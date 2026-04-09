/**
 * File watcher for specialist directories.
 * Watches both user (~/.augment/specialists/) and project (<repo>/.augment/specialists/)
 * directories for changes, invalidates the cache, and notifies the renderer.
 */
import type { FSWatcher } from 'chokidar';
import { Logger } from '../../../shared/logger';
import { getSpecialistsDirectory, getProjectSpecialistsDirectory, ensureSpecialistsDirectory } from './specialist-file-loader';
import { promises as fs } from 'fs';
import { refreshSpecialistsFromFiles } from '../../agent/main/specialists.service';

const logger = new Logger('SpecialistFileWatcher');

// Debounce to batch rapid changes
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
const DEBOUNCE_MS = 500;

// Track active watchers for cleanup
const activeWatchers: FSWatcher[] = [];
let currentWorkspacePath: string | undefined;

// Callback to notify renderer
let onFilesChanged: (() => void) | null = null;

function handleChange(filePath: string, event: string) {
  // Only care about .md files
  if (!filePath.endsWith('.md')) return;

  logger.info(`Specialist file ${event}: ${filePath}`);

  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(async () => {
    try {
      await refreshSpecialistsFromFiles(currentWorkspacePath);
      onFilesChanged?.();
      logger.info('Specialist cache refreshed after file change');
    } catch (error) {
      logger.error('Failed to refresh specialists after file change', error as Error);
    }
  }, DEBOUNCE_MS);
}

async function createWatcher(dir: string): Promise<FSWatcher> {
  const { watch } = await import('chokidar');

  const watcher = watch(dir, {
    ignoreInitial: true,
    depth: 0,
    awaitWriteFinish: { stabilityThreshold: 300 },
  });

  watcher.on('add', (p) => handleChange(p, 'added'));
  watcher.on('change', (p) => handleChange(p, 'changed'));
  watcher.on('unlink', (p) => handleChange(p, 'removed'));
  watcher.on('error', (error) => {
    logger.error('Specialist file watcher error', error);
  });

  return watcher;
}

/**
 * Start watching specialist directories.
 * Call this after the app is ready and workspace is mounted.
 */
export async function startSpecialistFileWatcher(
  workspacePath: string | undefined,
  notifyRenderer: () => void,
): Promise<void> {
  // Clean up any existing watchers
  await stopSpecialistFileWatcher();

  currentWorkspacePath = workspacePath;
  onFilesChanged = notifyRenderer;

  // Ensure user specialists directory exists before watching
  await ensureSpecialistsDirectory();
  const userDir = getSpecialistsDirectory();
  logger.info(`Watching user specialists directory: ${userDir}`);
  activeWatchers.push(await createWatcher(userDir));

  // Watch project specialists directory if workspace path is available
  if (workspacePath) {
    const projectDir = getProjectSpecialistsDirectory(workspacePath);
    try {
      await fs.mkdir(projectDir, { recursive: true });
    } catch (e) {
      logger.warn('Could not create project specialists directory', e as Error);
    }
    logger.info(`Watching project specialists directory: ${projectDir}`);
    activeWatchers.push(await createWatcher(projectDir));
  }
}

/**
 * Update the project watcher when workspace changes.
 */
export async function updateProjectWatcher(
  workspacePath: string | undefined,
): Promise<void> {
  currentWorkspacePath = workspacePath;

  // Remove project watcher (index 1, if exists) and re-add
  if (activeWatchers.length > 1) {
    await activeWatchers[1].close();
    activeWatchers.splice(1, 1);
  }

  if (workspacePath) {
    const projectDir = getProjectSpecialistsDirectory(workspacePath);
    try {
      await fs.mkdir(projectDir, { recursive: true });
    } catch (e) {
      logger.warn('Could not create project specialists directory', e as Error);
    }
    logger.info(`Watching project specialists directory: ${projectDir}`);
    activeWatchers.push(await createWatcher(projectDir));
  }
}

/**
 * Stop all specialist file watchers.
 */
export async function stopSpecialistFileWatcher(): Promise<void> {
  for (const watcher of activeWatchers) {
    await watcher.close();
  }
  activeWatchers.length = 0;
  onFilesChanged = null;
  currentWorkspacePath = undefined;
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
}
