/**
 * File watcher for specialist directories.
 * Watches both user (~/.augment/specialists/) and project (<repo>/.augment/specialists/)
 * directories for changes, invalidates the cache, and notifies the renderer.
 */
import type { FSWatcher } from 'chokidar';
import { Logger } from '../../../shared/logger';
import {
  getSpecialistsDirectory,
  getProjectSpecialistsDirectory,
  ensureSpecialistsDirectory,
} from './specialist-file-loader';
import { promises as fs } from 'fs';
import { refreshSpecialistsFromFiles } from '../../agent/main/specialists.service';

const logger = new Logger('SpecialistFileWatcher');

// Debounce to batch rapid changes
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
const DEBOUNCE_MS = 500;

// Track active watchers for cleanup
let userWatcher: FSWatcher | null = null;
const projectWatchers = new Map<string, { watcher: FSWatcher; workspacePath: string }>();

let pendingUserRefresh = false;
const pendingProjectRefreshes = new Set<string>();

// Callback to notify renderer
let onFilesChanged: (() => void) | null = null;

type WatchScope = { type: 'user' } | { type: 'project'; workspacePath: string };

function getProjectWatcherKey(workspacePath: string, workspaceId?: string): string {
  return workspaceId ?? workspacePath;
}

async function flushPendingRefreshes(): Promise<void> {
  const shouldRefreshUserCaches = pendingUserRefresh;
  const projectWorkspacePaths = shouldRefreshUserCaches
    ? [...new Set([...projectWatchers.values()].map((entry) => entry.workspacePath))]
    : [...pendingProjectRefreshes];

  pendingUserRefresh = false;
  pendingProjectRefreshes.clear();

  if (shouldRefreshUserCaches) {
    await refreshSpecialistsFromFiles();
  }

  await Promise.all(
    projectWorkspacePaths.map((workspacePath) => refreshSpecialistsFromFiles(workspacePath)),
  );
  onFilesChanged?.();
}

function handleChange(filePath: string, event: string, scope: WatchScope) {
  // Only care about .md files
  if (!filePath.endsWith('.md')) return;

  logger.info(`Specialist file ${event}: ${filePath}`);

  if (scope.type === 'user') {
    pendingUserRefresh = true;
  } else {
    pendingProjectRefreshes.add(scope.workspacePath);
  }

  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(async () => {
    try {
      debounceTimer = null;
      await flushPendingRefreshes();
      logger.info('Specialist cache refreshed after file change');
    } catch (error) {
      logger.error('Failed to refresh specialists after file change', error as Error);
    }
  }, DEBOUNCE_MS);
}

async function createWatcher(dir: string, scope: WatchScope): Promise<FSWatcher> {
  const { watch } = await import('chokidar');

  const watcher = watch(dir, {
    ignoreInitial: true,
    depth: 0,
    awaitWriteFinish: { stabilityThreshold: 300 },
  });

  watcher.on('add', (p) => handleChange(p, 'added', scope));
  watcher.on('change', (p) => handleChange(p, 'changed', scope));
  watcher.on('unlink', (p) => handleChange(p, 'removed', scope));
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
  onFilesChanged = notifyRenderer;

  if (userWatcher) {
    await userWatcher.close();
    userWatcher = null;
  }

  // Ensure user specialists directory exists before watching
  await ensureSpecialistsDirectory();
  const userDir = getSpecialistsDirectory();
  logger.info(`Watching user specialists directory: ${userDir}`);
  userWatcher = await createWatcher(userDir, { type: 'user' });

  // Watch project specialists directory if workspace path is available
  if (workspacePath) {
    await updateProjectWatcher(workspacePath);
  }
}

/**
 * Update the project watcher when workspace changes.
 */
export async function updateProjectWatcher(
  workspacePath: string | undefined,
  workspaceId?: string,
): Promise<void> {
  if (!workspacePath && !workspaceId) {
    for (const { watcher } of projectWatchers.values()) {
      await watcher.close();
    }
    projectWatchers.clear();
    pendingProjectRefreshes.clear();
    return;
  }

  const watcherKey = workspacePath ? getProjectWatcherKey(workspacePath, workspaceId) : workspaceId;

  if (!watcherKey) {
    return;
  }

  const existing = projectWatchers.get(watcherKey);
  if (existing) {
    await existing.watcher.close();
    projectWatchers.delete(watcherKey);
    pendingProjectRefreshes.delete(existing.workspacePath);
  }

  if (workspacePath) {
    const projectDir = getProjectSpecialistsDirectory(workspacePath);
    try {
      await fs.mkdir(projectDir, { recursive: true });
    } catch (e) {
      logger.warn('Could not create project specialists directory', e as Error);
    }
    logger.info(`Watching project specialists directory: ${projectDir}`);
    projectWatchers.set(watcherKey, {
      watcher: await createWatcher(projectDir, { type: 'project', workspacePath }),
      workspacePath,
    });
  }
}

/**
 * Stop all specialist file watchers.
 */
export async function stopSpecialistFileWatcher(): Promise<void> {
  if (userWatcher) {
    await userWatcher.close();
    userWatcher = null;
  }
  for (const { watcher } of projectWatchers.values()) {
    await watcher.close();
  }
  projectWatchers.clear();
  onFilesChanged = null;
  pendingUserRefresh = false;
  pendingProjectRefreshes.clear();
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
}
