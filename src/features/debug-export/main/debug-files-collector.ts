/**
 * Debug Files Collector
 *
 * Collects all debug log files from various locations.
 */

import { app } from 'electron';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { Logger } from '../../../shared/logger';

const logger = new Logger('DebugFilesCollector');

interface DebugFile {
  sourcePath: string;
  relativePath: string;
}

export interface DebugFilesResult {
  files: DebugFile[];
  /**
   * Sections that could not be collected (e.g. workspace files when no local
   * checkout is known). Recorded in the export manifest so a bundle without
   * workspace files is explainable rather than silently incomplete.
   */
  omissions: string[];
}

/**
 * Collect all debug files from various locations
 * @param workspaceId Optional workspace ID to collect workspace-specific files
 */
export async function collectDebugFiles(workspaceId?: string): Promise<DebugFilesResult> {
  const files: DebugFile[] = [];
  const omissions: string[] = [];
  const userDataPath = app.getPath('userData');
  const homeDir = os.homedir();

  // Helper to safely add files
  async function addFile(sourcePath: string, relativePath: string) {
    try {
      const stats = await fs.stat(sourcePath);
      if (stats.isFile()) {
        files.push({ sourcePath, relativePath });
      }
    } catch  {
      logger.debug('File not found or not accessible', { sourcePath });
    }
  }

  // Helper to add the first existing file among several candidate locations
  // (e.g. current .intent path first, then legacy .augment fallback)
  async function addFirstExistingFile(candidates: string[], relativePath: string) {
    for (const sourcePath of candidates) {
      try {
        const stats = await fs.stat(sourcePath);
        if (stats.isFile()) {
          files.push({ sourcePath, relativePath });
          return;
        }
      } catch {
        // try the next candidate
      }
    }
    logger.debug('No candidate file found', { candidates });
  }

  // Helper to safely add directory contents
  async function addDirectory(sourcePath: string, relativePath: string) {
    try {
      const entries = await fs.readdir(sourcePath, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(sourcePath, entry.name);
        const relPath = path.join(relativePath, entry.name);
        if (entry.isFile()) {
          files.push({ sourcePath: fullPath, relativePath: relPath });
        }
      }
    } catch  {
      logger.debug('Directory not found or not accessible', { sourcePath });
    }
  }

  // Helper to recursively add directory contents
  async function addDirectoryRecursive(sourcePath: string, relativePath: string) {
    try {
      const entries = await fs.readdir(sourcePath, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(sourcePath, entry.name);
        const relPath = path.join(relativePath, entry.name);
        if (entry.isFile()) {
          files.push({ sourcePath: fullPath, relativePath: relPath });
        } else if (entry.isDirectory()) {
          await addDirectoryRecursive(fullPath, relPath);
        }
      }
    } catch  {
      logger.debug('Directory not found or not accessible', { sourcePath });
    }
  }

  // Global logs
  await addDirectory(path.join(userDataPath, 'logs'), 'logs');
  // Memory events: packaged apps use ~/.intent as the base dir and write under
  // <base>/.intent/memory (see memory-event-logger); older builds used ~/.augment
  await addFirstExistingFile(
    [
      path.join(homeDir, '.intent', '.intent', 'memory', 'memory-events.jsonl'),
      path.join(homeDir, '.augment', 'memory', 'memory-events.jsonl'),
    ],
    'logs/memory-events.jsonl',
  );

  // IPC debug files: written under userData/.intent/ipc-debug (see ipc-debug-tracker);
  // older builds used ~/.augment
  const ipcDebugCount = files.length;
  await addDirectory(path.join(userDataPath, '.intent', 'ipc-debug'), 'ipc-debug');
  if (files.length === ipcDebugCount) {
    await addDirectory(path.join(homeDir, '.augment', 'ipc-debug'), 'ipc-debug');
  }

  // Error tracking (dev only): written under <root>/.intent/errors where <root>
  // is userData for packaged apps or ~/.intent as a fallback (see
  // agent-error-tracker); older builds used ~/.augment
  await addFirstExistingFile(
    [
      path.join(userDataPath, '.intent', 'errors', 'tracked-errors.json'),
      path.join(homeDir, '.intent', '.intent', 'errors', 'tracked-errors.json'),
      path.join(homeDir, '.augment', 'errors', 'tracked-errors.json'),
    ],
    'logs/tracked-errors.json',
  );

  // Workspace-specific files — the checkout directory comes from the daemon
  // only (monorepo#1759); when no local checkout is known (virtual/unknown
  // workspace or remote backend), the section is skipped and the omission is
  // recorded for the export manifest.
  if (workspaceId) {
    try {
      const { getWorkspacePath } = await import('../../workspace/main/workspace-path.service');
      const workspacePath = await getWorkspacePath(workspaceId);

      if (!workspacePath) {
        logger.info('Skipping workspace files: no local checkout known', { workspaceId });
        // i18n-ignore (manifest entry inside a diagnostic zip, not UI)
        omissions.push(
          `workspace/: skipped — no local checkout directory is known for workspace "${workspaceId}" (virtual/unknown workspace or remote backend)`,
        );
      } else {
        // Collect workspace events
        await addFile(
          path.join(workspacePath, '.workspace', 'events.jsonl'),
          'workspace/events.jsonl',
        );

        // Collect workspace agents
        await addDirectoryRecursive(
          path.join(workspacePath, '.workspace', 'agents'),
          'workspace/agents',
        );

        // Collect workspace notes
        await addDirectoryRecursive(
          path.join(workspacePath, '.workspace', 'notes'),
          'workspace/notes',
        );

        // Collect workspace logs (agent stderr logs)
        await addDirectoryRecursive(
          path.join(workspacePath, '.workspace', 'logs'),
          'workspace/logs',
        );

        logger.info('Collected workspace-specific files', { workspaceId });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn('Failed to collect workspace files', { workspaceId, error: message });
      // i18n-ignore (manifest entry inside a diagnostic zip, not UI)
      omissions.push(
        `workspace/: collection failed for workspace "${workspaceId}" — ${message}`,
      );
    }
  }

  logger.info('Collected debug files', { count: files.length, workspaceId });
  return { files, omissions };
}

