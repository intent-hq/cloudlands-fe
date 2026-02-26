/**
 * LocalMetadataFS
 *
 * Pass-through implementation of `IMetadataFS` that delegates directly to
 * Node's `fs/promises`.  Used for local (non-SSH) workspaces — zero
 * behaviour change compared to the current direct `fs` usage.
 */

import { promises as fs } from 'fs';
import type { IMetadataFS, MetadataDirent, MetadataStat } from './metadata-fs';

export class LocalMetadataFS implements IMetadataFS {
  async readFile(filePath: string, _encoding: 'utf-8'): Promise<string> {
    return fs.readFile(filePath, 'utf-8');
  }

  async stat(filePath: string): Promise<MetadataStat> {
    const stats = await fs.stat(filePath);
    return {
      size: stats.size,
      mtime: stats.mtime,
      isFile: () => stats.isFile(),
      isDirectory: () => stats.isDirectory(),
    };
  }

  async access(filePath: string): Promise<void> {
    await fs.access(filePath);
  }

  async readdir(
    dirPath: string,
    _options: { withFileTypes: true },
  ): Promise<MetadataDirent[]> {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    // fs.Dirent already satisfies MetadataDirent, but we map to ensure
    // the contract is explicit and doesn't leak extra Dirent properties.
    return entries.map((entry) => ({
      name: entry.name,
      isFile: () => entry.isFile(),
      isDirectory: () => entry.isDirectory(),
    }));
  }

  async writeFile(filePath: string, content: string, _encoding: 'utf-8'): Promise<void> {
    await fs.writeFile(filePath, content, 'utf-8');
  }

  async mkdir(dirPath: string, options?: { recursive?: boolean }): Promise<void> {
    await fs.mkdir(dirPath, options);
  }

  async unlink(filePath: string): Promise<void> {
    await fs.unlink(filePath);
  }

  async rm(filePath: string, options?: { recursive?: boolean; force?: boolean }): Promise<void> {
    await fs.rm(filePath, options);
  }

  async rename(oldPath: string, newPath: string): Promise<void> {
    await fs.rename(oldPath, newPath);
  }
}

