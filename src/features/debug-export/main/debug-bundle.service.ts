/**
 * Debug Bundle Service
 *
 * Creates a zip file containing all debug logs and system information.
 */

import { app } from 'electron';
import { promises as fs } from 'fs';
import path from 'path';
import { Logger } from '../../../shared/logger';
import { createZipFromPaths } from './zip-utils';
import { collectDebugFiles } from './debug-files-collector';
import { generateSystemInfo } from './system-info.service';

const logger = new Logger('DebugBundleService');

/**
 * Create a debug bundle zip file
 * @param workspaceId Optional workspace ID to include workspace-specific files
 * Returns the path to the created zip file
 */
export async function createDebugBundle(workspaceId?: string): Promise<string> {
  const tempDir = path.join(app.getPath('temp'), `intent-debug-${Date.now()}`);

  try {
    // Create temp directory
    await fs.mkdir(tempDir, { recursive: true });

    // Collect all debug files (including workspace-specific if provided)
    const debugFiles = await collectDebugFiles(workspaceId);
    logger.info('Collected debug files', { count: debugFiles.length, workspaceId });

    // Copy files to temp directory
    for (const file of debugFiles) {
      const destPath = path.join(tempDir, file.relativePath);
      const destDir = path.dirname(destPath);

      // Create directory structure
      await fs.mkdir(destDir, { recursive: true });

      try {
        await fs.copyFile(file.sourcePath, destPath);
      } catch (error) {
        logger.warn('Failed to copy debug file', {
          file: file.relativePath,
          error: error instanceof Error ? error.message : String(error),
        });
        // Continue with other files
      }
    }

    // Generate and add system info
    const systemInfo = generateSystemInfo();
    const systemInfoPath = path.join(tempDir, 'system-info.json');
    await fs.writeFile(systemInfoPath, JSON.stringify(systemInfo, null, 2));

    // Create zip file
    const zipPath = path.join(app.getPath('temp'), `intent-debug-${Date.now()}.zip`);
    await createZipFromPaths(tempDir, zipPath);

    logger.info('Debug bundle created', { zipPath });

    return zipPath;
  } finally {
    // Clean up temp directory
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch (error) {
      logger.warn('Failed to clean up temp directory', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

