/**
 * User Activity Service
 *
 * Business logic for tracking user activity on notes (e.g., last read time).
 *
 * OPTIMIZATION: Uses in-memory caching to avoid repeated file reads.
 * Cache is invalidated on save operations.
 */

import { Logger } from '../../../shared/logger';
import { createCache } from '../../../main/utils/cache';
import type { UserActivityRepository } from './user-activity.repository';
import type { NoteReadRecord, UserActivityData } from '../../../shared/types/user-activity.types';
import {
  createEmptyUserActivityData,
  LOCAL_USER_ID,
} from '../../../shared/types/user-activity.types';
import type { NoteId, WorkspaceId } from '../../../shared/types/branded-ids';

const logger = new Logger('UserActivityService');

export class UserActivityService {
  // In-memory cache per workspace to avoid repeated file reads.
  // LRU-bounded so activity data is retained only for recently-used workspaces.
  private cache = createCache<WorkspaceId, UserActivityData>({
    name: 'user-activity',
    maxSize: 50,
  });

  constructor(private readonly repository: UserActivityRepository) {}

  /**
   * Load data with caching - avoids repeated file reads
   */
  private async loadCached(workspaceId: WorkspaceId): Promise<UserActivityData | null> {
    // Check cache first
    const cached = this.cache.get(workspaceId);
    if (cached) {
      return cached;
    }

    // Load from repository and cache
    const data = await this.repository.load(workspaceId);
    if (data) {
      this.cache.set(workspaceId, data);
    }
    return data;
  }

  /**
   * Save data and update cache
   */
  private async saveAndCache(workspaceId: WorkspaceId, data: UserActivityData): Promise<void> {
    await this.repository.save(workspaceId, data);
    this.cache.set(workspaceId, data);
  }

  /**
   * Clear cache for a workspace (useful for testing or when data might be stale)
   */
  clearCache(workspaceId?: WorkspaceId): void {
    if (workspaceId) {
      this.cache.delete(workspaceId);
    } else {
      this.cache.clear();
    }
  }

  /**
   * Mark a note as read by the user.
   * Creates or updates the read record with current timestamp and increments read count.
   */
  async markNoteRead(workspaceId: WorkspaceId, noteId: NoteId): Promise<void> {
    let data = await this.loadCached(workspaceId);

    if (!data) {
      data = createEmptyUserActivityData(LOCAL_USER_ID);
    }

    const existing = data.noteReads[noteId];
    const now = new Date().toISOString();

    data.noteReads[noteId] = {
      lastReadAt: now,
      readCount: (existing?.readCount ?? 0) + 1,
    };
    data.lastUpdated = now;

    await this.saveAndCache(workspaceId, data);

    logger.debug('Marked note as read', {
      workspaceId,
      noteId,
      readCount: data.noteReads[noteId].readCount,
    });
  }

  /**
   * Get the read status for a specific note.
   * Returns null if the note has never been read.
   */
  async getNoteReadStatus(
    workspaceId: WorkspaceId,
    noteId: NoteId,
  ): Promise<NoteReadRecord | null> {
    const data = await this.loadCached(workspaceId);

    if (!data) {
      return null;
    }

    return data.noteReads[noteId] ?? null;
  }

  /**
   * Get IDs of notes that have unread changes.
   * A note is "unread" if:
   * - It has been updated after creation (updatedAt > createdAt), AND
   * - Either it has never been read, OR its updatedAt is after the lastReadAt
   *
   * Notes that have never been updated (updatedAt === createdAt) are NOT considered unread,
   * even if the user has never read them. This prevents newly created notes from showing
   * as unread when they're first created by an agent.
   */
  async getUnreadNoteIds(
    workspaceId: WorkspaceId,
    notes: Array<{ id: NoteId; updatedAt: string; createdAt?: string }>,
  ): Promise<NoteId[]> {
    const data = await this.loadCached(workspaceId);
    const unreadIds: NoteId[] = [];

    for (const note of notes) {
      const updatedTime = new Date(note.updatedAt).getTime();
      const createdTime = note.createdAt ? new Date(note.createdAt).getTime() : updatedTime;

      // Skip notes that have never been updated (just created)
      // A small tolerance of 1 second to account for timing differences
      if (Math.abs(updatedTime - createdTime) < 1000) {
        continue;
      }

      const readRecord = data?.noteReads[note.id];

      if (!readRecord) {
        // Never read but has been updated since creation
        unreadIds.push(note.id);
        continue;
      }

      const lastReadTime = new Date(readRecord.lastReadAt).getTime();

      if (updatedTime > lastReadTime) {
        // Updated after last read
        unreadIds.push(note.id);
      }
    }

    logger.debug('Computed unread notes', {
      workspaceId,
      totalNotes: notes.length,
      unreadCount: unreadIds.length,
    });

    return unreadIds;
  }
}
