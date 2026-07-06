/**
 * Shared main-process temp-file utilities.
 *
 * Extracted from the deleted features/agent/main/agent-providers/acp-provider.ts
 * as part of G2 (delete acp-provider + spawn machinery) so the startup path
 * can still sweep the on-disk temp files that crashed/killed agents may have
 * left behind in ~/.augment/tmp.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { Logger } from '$shared/logger';

const logger = new Logger('TempFiles');

function getGlobalTmpDir(): string {
  return path.join(os.homedir(), '.augment', 'tmp');
}

/**
 * Cleanup stale temp files from ~/.augment/tmp on Intent startup.
 *
 * Removes agent-rules-*.md and mcp-config-*.json files older than the
 * specified max age (default 1 hour).
 */
export async function cleanupStaleTempFiles(
  maxAgeMs: number = 60 * 60 * 1000,
): Promise<{ removed: number; errors: number }> {
  const tmpDir = getGlobalTmpDir();
  let removed = 0;
  let errors = 0;

  try {
    if (!fs.existsSync(tmpDir)) {
      return { removed: 0, errors: 0 };
    }

    const files = fs.readdirSync(tmpDir);
    const now = Date.now();

    for (const file of files) {
      if (!file.match(/^(agent-rules-|mcp-config-)\d+\.(md|json)$/)) {
        continue;
      }

      const filePath = path.join(tmpDir, file);

      try {
        const stats = fs.statSync(filePath);
        const age = now - stats.mtimeMs;

        if (age > maxAgeMs) {
          fs.unlinkSync(filePath);
          removed++;
          logger.debug('Removed stale temp file', { file, ageMs: age });
        }
      } catch (err) {
        errors++;
        logger.debug('Failed to clean up temp file', {
          file,
          error: (err as Error).message,
        });
      }
    }

    if (removed > 0) {
      logger.info('Cleaned up stale temp files', { tmpDir, removed, errors });
    }
  } catch (err) {
    logger.debug('Error reading temp directory', {
      tmpDir,
      error: (err as Error).message,
    });
  }

  return { removed, errors };
}
