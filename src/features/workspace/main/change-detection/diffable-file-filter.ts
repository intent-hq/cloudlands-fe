/**
 * Diffable File Filter
 *
 * Filters out binary files and files that are too large to diff safely.
 * This prevents crashes when workspaces contain large binary files like
 * .onnx, .wasm, images, videos, etc.
 */

import { promises as fs } from 'fs';
import * as path from 'path';
import { Logger } from '../../../../shared/logger';
import {
  BINARY_FILE_EXTENSIONS,
  isBinaryExtension,
  detectBinaryContent,
  KNOWN_TEXT_EXTENSIONS,
  getExtension,
} from '../../../../shared/binary-file-extensions';

// Re-export for backward compatibility
export { BINARY_FILE_EXTENSIONS, isBinaryExtension };

const logger = new Logger('DiffableFileFilter');

/**
 * Maximum file size to attempt diffing (in bytes)
 * Files larger than this will be skipped
 */
export const MAX_DIFFABLE_FILE_SIZE = 5 * 1024 * 1024; // 5MB

/**
 * Result of checking if a file is diffable
 */
export interface DiffableCheckResult {
  isDiffable: boolean;
  reason?: 'binary' | 'binary-content' | 'too-large' | 'not-found' | 'error';
  fileSize?: number;
}

/**
 * Check if a file should be diffed
 *
 * @param workspacePath - The workspace root path
 * @param filePath - The relative file path
 * @returns Whether the file is diffable and why if not
 */
export async function isFileDiffable(
  workspacePath: string,
  filePath: string,
): Promise<DiffableCheckResult> {
  // Quick check: binary extension
  if (isBinaryExtension(filePath)) {
    logger.debug('Skipping binary file', { filePath });
    return { isDiffable: false, reason: 'binary' };
  }

  // Check file size
  try {
    const absolutePath = path.join(workspacePath, filePath);
    const stats = await fs.stat(absolutePath);

    if (stats.size > MAX_DIFFABLE_FILE_SIZE) {
      logger.debug('Skipping large file', {
        filePath,
        fileSize: stats.size,
        maxSize: MAX_DIFFABLE_FILE_SIZE,
      });
      return { isDiffable: false, reason: 'too-large', fileSize: stats.size };
    }

    // Content-based binary detection: skip for known text extensions
    const ext = getExtension(filePath);
    if (!KNOWN_TEXT_EXTENSIONS.has(ext)) {
      try {
        const fd = await fs.open(absolutePath, 'r');
        try {
          const sampleSize = 8192;
          const buf = Buffer.alloc(Math.min(sampleSize, stats.size));
          await fd.read(buf, 0, buf.length, 0);
          if (detectBinaryContent(buf, sampleSize)) {
            logger.debug('Skipping file with binary content', { filePath });
            return { isDiffable: false, reason: 'binary-content', fileSize: stats.size };
          }
        } finally {
          await fd.close();
        }
      } catch {
        // If we can't read the file for content check, fail open
        logger.debug('Could not read file for binary content check', { filePath });
      }
    }

    return { isDiffable: true, fileSize: stats.size };
  } catch (error) {
    const errnoError = error as NodeJS.ErrnoException;
    if (errnoError.code === 'ENOENT') {
      // File doesn't exist - might be deleted, still try to diff
      return { isDiffable: true, reason: 'not-found' };
    }
    logger.debug('Error checking file', { filePath, error });
    // On error, default to allowing diff (fail open)
    return { isDiffable: true, reason: 'error' };
  }
}

/**
 * Filter a list of file paths to only include diffable files
 *
 * @param workspacePath - The workspace root path
 * @param filePaths - List of relative file paths to filter
 * @returns Object with diffable files and skipped files with reasons
 */
export async function filterDiffableFiles(
  workspacePath: string,
  filePaths: string[],
): Promise<{
  diffable: string[];
  skipped: Array<{ path: string; reason: 'binary' | 'binary-content' | 'too-large' | 'error' }>;
}> {
  const diffable: string[] = [];
  const skipped: Array<{
    path: string;
    reason: 'binary' | 'binary-content' | 'too-large' | 'error';
  }> = [];

  // Check files in parallel for performance
  const results = await Promise.all(
    filePaths.map(async (filePath) => ({
      filePath,
      result: await isFileDiffable(workspacePath, filePath),
    })),
  );

  for (const { filePath, result } of results) {
    if (result.isDiffable) {
      diffable.push(filePath);
    } else if (result.reason && result.reason !== 'not-found') {
      skipped.push({ path: filePath, reason: result.reason });
    }
  }

  if (skipped.length > 0) {
    logger.info('Skipped non-diffable files', {
      skippedCount: skipped.length,
      skipped: skipped.slice(0, 10), // Log first 10 for debugging
    });
  }

  return { diffable, skipped };
}
