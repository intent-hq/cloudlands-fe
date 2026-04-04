/**
 * Atomic File Operations
 *
 * Provides crash-safe file writes by writing to a temp file first,
 * then atomically renaming to the target path.
 *
 * This prevents file corruption if the process crashes mid-write.
 */

import { promises as fs } from 'fs';
import * as path from 'path';
import { Logger } from '../../../../shared/logger';
import { renameWithRetry } from '../../../../shared/main/file-sync-utils';

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const logger = new Logger('AtomicFile');

/**
 * Write content to a file atomically.
 * 1. Writes to a temporary file in the same directory
 * 2. Renames the temp file to the target (atomic on POSIX systems)
 * 3. Cleans up temp file on failure
 *
 * @param filePath - Target file path
 * @param content - Content to write
 * @param encoding - File encoding (default: utf-8)
 */
export async function writeFileAtomic(
  filePath: string,
  content: string,
  encoding: BufferEncoding = 'utf-8',
): Promise<void> {
  const dir = path.dirname(filePath);
  const basename = path.basename(filePath);
  const tempPath = path.join(
    dir,
    `.${basename}.tmp.${Date.now()}.${Math.random().toString(36).slice(2)}`,
  );

  try {
    // Ensure directory exists
    await fs.mkdir(dir, { recursive: true });

    // Write to temp file
    await fs.writeFile(tempPath, content, encoding);

    // Atomic rename
    await renameWithRetry(tempPath, filePath);
  } catch (error) {
    // Clean up temp file on failure
    try {
      await fs.unlink(tempPath);
    } catch {
      // Temp file may not exist
    }
    throw error;
  }
}

/**
 * Append content to a file atomically.
 * For append operations, we read existing content, append, then write atomically.
 *
 * @param filePath - Target file path
 * @param content - Content to append
 * @param encoding - File encoding (default: utf-8)
 */
export async function appendFileAtomic(
  filePath: string,
  content: string,
  encoding: BufferEncoding = 'utf-8',
): Promise<void> {
  let existing = '';
  try {
    existing = await fs.readFile(filePath, encoding);
  } catch (error) {
    // File doesn't exist, start fresh
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }

  await writeFileAtomic(filePath, existing + content, encoding);
}

/**
 * Read a file safely, returning null if it doesn't exist.
 *
 * @param filePath - File path to read
 * @param encoding - File encoding (default: utf-8)
 */
export async function readFileSafe(
  filePath: string,
  encoding: BufferEncoding = 'utf-8',
): Promise<string | null> {
  try {
    return await fs.readFile(filePath, encoding);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

/**
 * Check if a file exists.
 *
 * @param filePath - File path to check
 */
export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Delete a file if it exists (no error if missing).
 *
 * @param filePath - File path to delete
 */
export async function deleteFileSafe(filePath: string): Promise<void> {
  try {
    await fs.unlink(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }
}
