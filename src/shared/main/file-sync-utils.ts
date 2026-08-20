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
        await new Promise((resolve) => setTimeout(resolve, baseDelayMs * Math.pow(2, attempt)));
        continue;
      }
      throw error;
    }
  }
}
