/**
 * User Activity Repository
 *
 * Data access layer for user activity (e.g., note read tracking).
 * Stores data under Electron userData, keyed by backend + workspace:
 * {userData}/user-activity/{backendId}/{workspaceId}/user-activity.json
 * (monorepo#1759 — persistence never needed the workspace checkout dir).
 */

import { promises as fs } from 'fs';
import * as path from 'path';
import { z } from 'zod';
import { Logger } from '../../../shared/logger';
import { renameWithRetry } from '../../../shared/main/file-sync-utils';
import type { UserActivityData } from '../../../shared/types/user-activity.types';
import { USER_ACTIVITY_VERSION } from '../../../shared/types/user-activity.types';
import type { WorkspaceId } from '../../../shared/types';

const logger = new Logger('UserActivityRepository');

const USER_ACTIVITY_FILENAME = 'user-activity.json';

/**
 * Zod schema for validating user activity data on load.
 * Ensures data integrity and provides clear error messages for corrupted files.
 */
const NoteReadRecordSchema = z.object({
  lastReadAt: z.string(),
  readCount: z.number().optional(),
});

const UserActivityDataSchema = z.object({
  version: z.literal(USER_ACTIVITY_VERSION),
  userId: z.string(),
  noteReads: z.record(NoteReadRecordSchema),
  lastUpdated: z.string(),
});

/**
 * Repository interface for user activity data
 */
export interface UserActivityRepository {
  load(workspaceId: WorkspaceId): Promise<UserActivityData | null>;
  save(workspaceId: WorkspaceId, data: UserActivityData): Promise<void>;
}

/**
 * File system implementation of UserActivityRepository.
 *
 * Accepts either a fixed basePath string (for tests) or a resolver function
 * that returns the correct base path per workspace (production passes an
 * async resolver keying the userData subtree by active backend id).
 */
export class FileSystemUserActivityRepository implements UserActivityRepository {
  private readonly resolveBase: (workspaceId: WorkspaceId) => string | Promise<string>;

  constructor(basePath: string | ((workspaceId: WorkspaceId) => string | Promise<string>)) {
    this.resolveBase = typeof basePath === 'function' ? basePath : () => basePath;
  }

  private async getFilePath(workspaceId: WorkspaceId): Promise<string> {
    return path.join(await this.resolveBase(workspaceId), workspaceId, USER_ACTIVITY_FILENAME);
  }

  async load(workspaceId: WorkspaceId): Promise<UserActivityData | null> {
    const filePath = await this.getFilePath(workspaceId);

    try {
      const content = await fs.readFile(filePath, 'utf-8');
      if (!content.trim()) {
        logger.debug('User activity file is empty', { workspaceId });
        return null;
      }

      const parsed = JSON.parse(content);

      // Validate schema to ensure data integrity
      const result = UserActivityDataSchema.safeParse(parsed);
      if (!result.success) {
        logger.warn('User activity file has invalid schema, will be recreated on next write', {
          workspaceId,
          errors: result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
        });
        return null;
      }

      logger.debug('Loaded user activity', {
        workspaceId,
        noteCount: Object.keys(result.data.noteReads).length,
      });
      return result.data;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        logger.debug('User activity file does not exist', { workspaceId });
        return null;
      }

      if (error instanceof SyntaxError) {
        logger.warn('User activity file has invalid JSON', { workspaceId });
        return null;
      }

      logger.error('Failed to load user activity', error as Error, { workspaceId });
      return null;
    }
  }

  async save(workspaceId: WorkspaceId, data: UserActivityData): Promise<void> {
    const filePath = await this.getFilePath(workspaceId);
    const dir = path.dirname(filePath);

    try {
      // Ensure directory exists
      await fs.mkdir(dir, { recursive: true });

      // Write atomically using temp file + rename
      const tempPath = `${filePath}.tmp.${Date.now()}`;
      await fs.writeFile(tempPath, JSON.stringify(data, null, 2), 'utf-8');
      await renameWithRetry(tempPath, filePath);

      logger.debug('Saved user activity', {
        workspaceId,
        noteCount: Object.keys(data.noteReads).length,
      });
    } catch (error) {
      logger.error('Failed to save user activity', error as Error, { workspaceId });
      throw error;
    }
  }
}

/**
 * In-memory implementation for testing
 */
export class InMemoryUserActivityRepository implements UserActivityRepository {
  private storage = new Map<WorkspaceId, UserActivityData>();

  async load(workspaceId: WorkspaceId): Promise<UserActivityData | null> {
    return this.storage.get(workspaceId) ?? null;
  }

  async save(workspaceId: WorkspaceId, data: UserActivityData): Promise<void> {
    this.storage.set(workspaceId, structuredClone(data));
  }

  // Test helper: clear all data
  clear(): void {
    this.storage.clear();
  }
}
