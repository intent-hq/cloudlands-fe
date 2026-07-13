/**
 * Zip Utilities — uses yazl (pure JS, Electron-safe, no polyfill conflicts)
 */
import yazl from 'yazl';
import {
  promises as fs,
  createWriteStream,
} from 'fs';
import path from 'path';
import { Logger } from '../../../shared/logger';

const logger = new Logger('ZipUtils');

/**
 * Create a zip file from all files in a directory (recursive)
 */
export async function createZipFromPaths(sourceDir: string, zipPath: string): Promise<void> {
  const zipfile = new yazl.ZipFile();

  async function addDir(dir: string, prefix: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const zipName = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await addDir(fullPath, zipName);
      } else if (entry.isFile()) {
        zipfile.addFile(fullPath, zipName, { compress: true });
      }
    }
  }

  try {
    await addDir(sourceDir, '');
    zipfile.end();

    await new Promise<void>((resolve, reject) => {
      const output = createWriteStream(zipPath);
      zipfile.outputStream.pipe(output);
      output.on('close', resolve);
      output.on('error', reject);
      zipfile.outputStream.on('error', reject);
    });

    const stats = await fs.stat(zipPath);
    logger.info('Zip file created', { zipPath, bytes: stats.size });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error('Failed to create zip file', error as Error, { errorMsg });
    throw new Error(`Failed to create zip file: ${errorMsg}`);
  }
}

