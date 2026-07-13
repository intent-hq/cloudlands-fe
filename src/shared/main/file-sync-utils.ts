/**
 * File Synchronization Utilities
 *
 * Provides utilities for ensuring file writes are durable by calling fsync()
 * after write operations. This ensures data is written to disk, not just OS cache.
 *
 * On Windows, fsync is skipped entirely: Windows does not support fsync on
 * directory handles (always EPERM), and fsync on file handles can also fail
 * with EPERM depending on system configuration/antivirus. NTFS's built-in
 * write-ahead transaction log provides equivalent crash safety.
 */

import { promises as fs } from 'fs';
import * as fsExtra from 'fs-extra';
import * as path from 'path';

/**
 * Sync a file to disk for durability. No-op on Windows.
 *
 * @param filePath - Path to the file to sync
 */
export async function fsyncFile(filePath: string): Promise<void> {
  if (process.platform === 'win32') return;
  const fd = await fs.open(filePath, 'r');
  try {
    await fd.sync();
  } finally {
    await fd.close();
  }
}

/**
 * Sync a directory to disk to ensure metadata operations (e.g. renames)
 * are durable. No-op on Windows.
 *
 * @param dirPath - Path to the directory to sync
 */
export async function fsyncDir(dirPath: string): Promise<void> {
  if (process.platform === 'win32') return;
  const dirFd = await fs.open(dirPath, 'r');
  try {
    await dirFd.sync();
  } finally {
    await dirFd.close();
  }
}

/**
 * Rename with retry on Windows EPERM.
 * On Windows, antivirus can briefly lock files causing EPERM on rename.
 * Retries up to maxRetries times with exponential backoff.
 *
 * @param oldPath - Current file path
 * @param newPath - New file path
 * @param maxRetries - Maximum number of retries (default: 5)
 * @param baseDelayMs - Base delay in milliseconds for exponential backoff (default: 50)
 */
export async function renameWithRetry(
  oldPath: string,
  newPath: string,
  maxRetries = 5,
  baseDelayMs = 50,
): Promise<void> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      await fs.rename(oldPath, newPath);
      return;
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code === 'EPERM' && process.platform === 'win32' && attempt < maxRetries) {
        // Exponential backoff: 50ms, 100ms, 200ms, 400ms, 800ms
        await new Promise(resolve => setTimeout(resolve, baseDelayMs * Math.pow(2, attempt)));
        continue;
      }
      throw error;
    }
  }
}

/**
 * Write JSON data to a file with fsync() for durability
 * Uses atomic write pattern: write to temp file, then rename
 *
 * @param filePath - Path to write to
 * @param data - Data to write
 * @param options - Write options
 * @returns Promise that resolves when data is synced to disk
 */
export async function writeJsonWithSync(
  filePath: string,
  data: any,
  options?: { spaces?: number },
): Promise<void> {
  const tempPath = `${filePath}.tmp.${Date.now()}.${Math.random().toString(36).substring(2, 11)}`;
  const spaces = options?.spaces ?? 2;

  try {
    const content = JSON.stringify(data, null, spaces);
    await fs.writeFile(tempPath, content, 'utf-8');
    await fsyncFile(tempPath);
    await renameWithRetry(tempPath, filePath);
    await fsyncDir(path.dirname(filePath));
  } catch (error) {
    try {
      await fsExtra.remove(tempPath);
    } catch {
      // Ignore cleanup errors
    }
    throw error;
  }
}

/**
 * Write text data to a file with fsync() for durability
 *
 * @param filePath - Path to write to
 * @param content - Content to write
 * @param encoding - File encoding (default: utf-8)
 * @returns Promise that resolves when data is synced to disk
 */
export async function writeFileWithSync(
  filePath: string,
  content: string,
  encoding: BufferEncoding = 'utf-8',
): Promise<void> {
  const tempPath = `${filePath}.tmp.${Date.now()}.${Math.random().toString(36).substring(2, 11)}`;

  try {
    await fs.writeFile(tempPath, content, encoding);
    await fsyncFile(tempPath);
    await renameWithRetry(tempPath, filePath);
    await fsyncDir(path.dirname(filePath));
  } catch (error) {
    try {
      await fsExtra.remove(tempPath);
    } catch {
      // Ignore cleanup errors
    }
    throw error;
  }
}
