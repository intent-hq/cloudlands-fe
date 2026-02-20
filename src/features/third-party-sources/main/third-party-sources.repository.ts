/**
 * Third-Party Sources Repository
 *
 * Handles persistence of third-party sources to the file system
 */

import { promises as fs } from 'fs';
import * as path from 'path';
import { Logger } from '../../../shared/logger';
import type { ThirdPartySource, WorkspaceId } from '../../../shared/types';
import { WorkspaceConfig } from '../../../shared/main/config.js';
import { fsyncFile } from '../../../shared/main/file-sync-utils';

const logger = new Logger('third-party-sources-repository');

export class ThirdPartySourcesRepository {
  /**
   * Get the sources directory path for a workspace
   */
  private getSourcesDir(workspaceId: WorkspaceId): string {
    return path.join(WorkspaceConfig.paths.metadata(workspaceId), 'sources');
  }

  /**
   * Get the file path for a specific source
   */
  private getSourcePath(workspaceId: WorkspaceId, sourceId: string): string {
    return path.join(this.getSourcesDir(workspaceId), `${sourceId}.json`);
  }

  /**
   * Save a third-party source
   */
  async save(source: ThirdPartySource): Promise<void> {
    try {
      const sourcesDir = this.getSourcesDir(source.workspaceId);

      // Ensure directory exists
      await fs.mkdir(sourcesDir, { recursive: true });

      // Write source file
      const sourcePath = this.getSourcePath(source.workspaceId, source.id);
      await fs.writeFile(sourcePath, JSON.stringify(source, null, 2), 'utf-8');

      // Sync file to disk for durability
      await fsyncFile(sourcePath);

      logger.debug('Source saved', {
        workspaceId: source.workspaceId,
        sourceId: source.id,
      });
    } catch (error) {
      logger.error('Failed to save source', error as Error);
      throw error;
    }
  }

  /**
   * Find a source by ID
   */
  async findById(workspaceId: WorkspaceId, sourceId: string): Promise<ThirdPartySource | null> {
    try {
      const sourcePath = this.getSourcePath(workspaceId, sourceId);

      // Check if file exists
      try {
        await fs.access(sourcePath);
      } catch {
        return null;
      }

      // Read and parse source
      const data = await fs.readFile(sourcePath, 'utf-8');
      return JSON.parse(data) as ThirdPartySource;
    } catch (error) {
      logger.error('Failed to find source by ID', error as Error);
      return null;
    }
  }

  /**
   * Find all sources for a workspace
   */
  async findByWorkspace(workspaceId: WorkspaceId): Promise<ThirdPartySource[]> {
    try {
      const sourcesDir = this.getSourcesDir(workspaceId);

      // Check if directory exists
      try {
        await fs.access(sourcesDir);
      } catch {
        return [];
      }

      // Read all source files
      const files = await fs.readdir(sourcesDir);
      const sources: ThirdPartySource[] = [];

      for (const file of files) {
        if (file.endsWith('.json')) {
          try {
            const filePath = path.join(sourcesDir, file);
            const data = await fs.readFile(filePath, 'utf-8');
            const source = JSON.parse(data) as ThirdPartySource;

            // Only include non-archived sources by default
            if (!source.isArchived) {
              sources.push(source);
            }
          } catch (error) {
            logger.warn(`Failed to read source file: ${file}`, error as Error);
          }
        }
      }

      // Sort by creation date (newest first) and pinned status
      sources.sort((a, b) => {
        if (a.isPinned !== b.isPinned) {
          return a.isPinned ? -1 : 1;
        }
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      });

      return sources;
    } catch (error) {
      logger.error('Failed to find sources by workspace', error as Error);
      return [];
    }
  }

  /**
   * Delete a source
   */
  async delete(workspaceId: WorkspaceId, sourceId: string): Promise<void> {
    try {
      const sourcePath = this.getSourcePath(workspaceId, sourceId);
      await fs.unlink(sourcePath);

      logger.debug('Source deleted', {
        workspaceId,
        sourceId,
      });
    } catch (error) {
      logger.error('Failed to delete source', error as Error);
      throw error;
    }
  }
}
