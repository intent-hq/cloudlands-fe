/**
 * Diffs Repository
 *
 * Data access layer for diff operations.
 * Handles persistence and retrieval of diff data.
 */

import { promises as fs } from 'fs';
import * as path from 'path';
import type { DiffChunk } from '../../../shared/types';
import { WorkspaceConfig } from '../../../shared/main/config';
import { Logger } from '../../../shared/logger';
import * as Errors from '../../../shared/errors';
import { fsyncFile } from '../../../shared/main/file-sync-utils';

const { FileReadError, FileWriteError } = Errors;

const logger = new Logger('DiffsRepository');

/**
 * Repository interface for diffs
 */
export interface DiffsRepository {
  findByWorkspace(workspaceId: string): Promise<DiffChunk[]>;
  save(workspaceId: string, diffs: DiffChunk[]): Promise<void>;
  clear(workspaceId: string): Promise<void>;
}

/**
 * File system implementation of DiffsRepository
 */
export class FileSystemDiffsRepository implements DiffsRepository {
  private readonly diffsPath: string;

  constructor() {
    this.diffsPath = path.join(WorkspaceConfig.paths.base, '.diffs');
  }

  /**
   * Find diffs for a workspace
   */
  async findByWorkspace(workspaceId: string): Promise<DiffChunk[]> {
    try {
      const filePath = path.join(this.diffsPath, `${workspaceId}.json`);

      // Check if file exists
      try {
        await fs.access(filePath);
      } catch {
        return [];
      }

      // Read file
      const content = await fs.readFile(filePath, 'utf-8');
      return JSON.parse(content);
    } catch (error) {
      logger.error('Failed to read diffs', error as Error, { workspaceId });
      throw new FileReadError(path.join(this.diffsPath, `${workspaceId}.json`), error as Error);
    }
  }

  /**
   * Save diffs for a workspace
   */
  async save(workspaceId: string, diffs: DiffChunk[]): Promise<void> {
    try {
      // Ensure directory exists
      await fs.mkdir(this.diffsPath, { recursive: true });

      // Write file
      const filePath = path.join(this.diffsPath, `${workspaceId}.json`);
      await fs.writeFile(filePath, JSON.stringify(diffs, null, 2), 'utf-8');

      // Sync file to disk for durability
      await fsyncFile(filePath);

      logger.debug('Diffs saved', { workspaceId, count: diffs.length });
    } catch (error) {
      logger.error('Failed to save diffs', error as Error, { workspaceId });
      throw new FileWriteError(path.join(this.diffsPath, `${workspaceId}.json`), error as Error);
    }
  }

  /**
   * Clear diffs for a workspace
   */
  async clear(workspaceId: string): Promise<void> {
    try {
      const filePath = path.join(this.diffsPath, `${workspaceId}.json`);

      // Check if file exists before trying to delete
      try {
        await fs.access(filePath);
        await fs.unlink(filePath);
        logger.debug('Diffs cleared', { workspaceId });
      } catch {
        // File doesn't exist, nothing to clear
        logger.debug('No diffs to clear', { workspaceId });
      }
    } catch (error) {
      logger.error('Failed to clear diffs', error as Error, { workspaceId });
      // Don't throw - clearing is not critical
    }
  }
}

/**
 * In-memory implementation for testing
 */
export class InMemoryDiffsRepository implements DiffsRepository {
  private diffs = new Map<string, DiffChunk[]>();

  async findByWorkspace(workspaceId: string): Promise<DiffChunk[]> {
    return this.diffs.get(workspaceId) || [];
  }

  async save(workspaceId: string, diffs: DiffChunk[]): Promise<void> {
    this.diffs.set(workspaceId, diffs);
  }

  async clear(workspaceId: string): Promise<void> {
    this.diffs.delete(workspaceId);
  }

  // Test helpers
  clearAll(): void {
    this.diffs.clear();
  }
}
