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

/**
 * Collect all debug files from various locations
 * @param workspaceId Optional workspace ID to collect workspace-specific files
 */
export async function collectDebugFiles(workspaceId?: string): Promise<DebugFile[]> {
  const files: DebugFile[] = [];
  const userDataPath = app.getPath('userData');
  const homeDir = os.homedir();

  // Helper to safely add files
  async function addFile(sourcePath: string, relativePath: string) {
    try {
      const stats = await fs.stat(sourcePath);
      if (stats.isFile()) {
        files.push({ sourcePath, relativePath });
      }
    } catch (error) {
      logger.debug('File not found or not accessible', { sourcePath });
    }
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
    } catch (error) {
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
    } catch (error) {
      logger.debug('Directory not found or not accessible', { sourcePath });
    }
  }

  // Global logs
  await addFile(path.join(userDataPath, 'logs', 'main.log'), 'logs/main.log');
  await addFile(path.join(userDataPath, 'logs', 'renderer.log'), 'logs/renderer.log');
  await addFile(path.join(homeDir, '.augment', 'mcp-stdio.log'), 'logs/mcp-stdio.log');
  await addFile(
    path.join(homeDir, '.augment', 'memory', 'memory-events.jsonl'),
    'logs/memory-events.jsonl',
  );

  // IPC debug files
  await addDirectory(path.join(homeDir, '.augment', 'ipc-debug'), 'ipc-debug');

  // Error tracking (dev only)
  await addFile(
    path.join(homeDir, '.augment', 'errors', 'tracked-errors.json'),
    'logs/tracked-errors.json',
  );

  // Workspace-specific files
  if (workspaceId) {
    try {
      const { WorkspaceConfig } = await import('../../../shared/main/config');
      const workspacePath = WorkspaceConfig.paths.workspace(workspaceId);

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
    } catch (error) {
      logger.warn('Failed to collect workspace files', {
        workspaceId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  logger.info('Collected debug files', { count: files.length, workspaceId });
  return files;
}

