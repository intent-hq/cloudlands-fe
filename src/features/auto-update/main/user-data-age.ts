/**
 * First-seen estimate for installs that predate the install-age telemetry:
 * the creation time of a folder (Electron `userData`), falling back to the
 * oldest mtime among its top-level entries where the filesystem reports no
 * birthtime (0 or unreliable on some Linux filesystems). Only the resulting
 * date is stored; no path or file name leaves the machine.
 */

import { promises as fs } from 'fs';
import * as path from 'path';

/** The slice of `fs.promises` the estimate needs (injectable for tests). */
export interface DirAgeFs {
  stat(p: string): Promise<{ birthtimeMs: number }>;
  readdir(p: string): Promise<string[]>;
  lstat(p: string): Promise<{ mtimeMs: number }>;
}

const nodeFs: DirAgeFs = {
  stat: (p) => fs.stat(p),
  readdir: (p) => fs.readdir(p),
  lstat: (p) => fs.lstat(p),
};

function usable(ms: number): boolean {
  return Number.isFinite(ms) && ms > 0;
}

/** Estimated creation time of `dir` in epoch ms, or null when unknown. */
export async function estimateDirCreatedAtMs(
  dir: string,
  fsApi: DirAgeFs = nodeFs,
): Promise<number | null> {
  try {
    const { birthtimeMs } = await fsApi.stat(dir);
    if (usable(birthtimeMs)) return birthtimeMs;
  } catch {
    return null;
  }
  let entries: string[];
  try {
    entries = await fsApi.readdir(dir);
  } catch {
    return null;
  }
  let oldest: number | null = null;
  for (const entry of entries) {
    try {
      const { mtimeMs } = await fsApi.lstat(path.join(dir, entry));
      if (usable(mtimeMs) && (oldest === null || mtimeMs < oldest)) oldest = mtimeMs;
    } catch {
      // Entry vanished or is unreadable; skip it.
    }
  }
  return oldest;
}
