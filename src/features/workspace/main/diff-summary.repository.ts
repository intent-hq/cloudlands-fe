import { promises as fs } from 'fs';
import * as path from 'path';

import { WorkspaceConfig } from '../../../shared/main/config.js';
import { Logger } from '../../../shared/logger';
import type { WorkspaceDiffSummary, WorkspaceId } from '../../../shared/types';
import { DiffSummarySchema } from '../../../shared/schemas';
import { fsyncFile } from '../../../shared/main/file-sync-utils';

const logger = new Logger('DiffSummaryRepository');
const SUMMARY_FILE_NAME = 'summary.json';

export class DiffSummaryRepository {
  private writeQueue = new Map<WorkspaceId, Promise<void>>();

  async load(workspaceId: WorkspaceId): Promise<WorkspaceDiffSummary | null> {
    try {
      const summaryPath = this.getSummaryPath(workspaceId);
      const data = await fs.readFile(summaryPath, 'utf-8');

      // Handle empty or corrupted files
      if (!data || data.trim() === '') {
        logger.warn('Empty diff summary file', { workspaceId });
        return null;
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(data);
      } catch (parseError) {
        logger.error('Failed to parse diff summary JSON', parseError as Error, {
          workspaceId,
          fileContent: data.substring(0, 100), // Log first 100 chars for debugging
        });

        // Try to delete the corrupted file
        try {
          await fs.unlink(summaryPath);
          logger.info('Deleted corrupted diff summary file', { workspaceId });
        } catch {
          // Ignore deletion errors
        }

        return null;
      }

      const result = DiffSummarySchema.safeParse(parsed);

      if (!result.success) {
        logger.warn('Invalid diff summary schema', {
          workspaceId,
          issues: result.error.issues,
        });
        return null;
      }

      return result.data;
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
        return null;
      }

      logger.error('Failed to load diff summary', error as Error, { workspaceId });
      return null;
    }
  }

  async save(workspaceId: WorkspaceId, summary: WorkspaceDiffSummary): Promise<void> {
    const validation = DiffSummarySchema.safeParse(summary);
    if (!validation.success) {
      logger.error('Attempted to save invalid diff summary', {
        workspaceId,
        issues: validation.error.issues,
      });
      throw validation.error;
    }

    const previous = this.writeQueue.get(workspaceId) ?? Promise.resolve();
    const chained = previous
      .catch(() => undefined)
      .then(async () => {
        const summaryPath = this.getSummaryPath(workspaceId);
        await fs.mkdir(path.dirname(summaryPath), { recursive: true });
        await fs.writeFile(summaryPath, JSON.stringify(validation.data, null, 2), 'utf-8');

        // Sync file to disk for durability
        await fsyncFile(summaryPath);
      });

    const finalPromise = chained.finally(() => {
      if (this.writeQueue.get(workspaceId) === finalPromise) {
        this.writeQueue.delete(workspaceId);
      }
    });

    this.writeQueue.set(workspaceId, finalPromise);
    await finalPromise;
  }

  async delete(workspaceId: WorkspaceId): Promise<void> {
    const summaryPath = this.getSummaryPath(workspaceId);
    try {
      await fs.unlink(summaryPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') {
        logger.error('Failed to delete diff summary', error as Error, { workspaceId });
      }
    }
  }

  private getSummaryPath(workspaceId: WorkspaceId): string {
    return path.join(WorkspaceConfig.paths.metadata(workspaceId), SUMMARY_FILE_NAME);
  }
}
