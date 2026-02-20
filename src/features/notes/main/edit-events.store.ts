/**
 * Edit Events Store
 *
 * Manages append-only log files for note edit events.
 * Each note gets its own .edits.jsonl file for fast appends and easy inspection.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { Logger } from '../../../shared/logger';
import { WorkspaceConfig } from '../../../shared/main/config.js';
import type { NoteId, WorkspaceId } from '../../../shared/types';
import type { NoteEditEvent, EditEventMetadata } from '../edit-events.types';
import { fsyncFile } from '../../../shared/main/file-sync-utils';

const logger = new Logger('EditEventsStore');

export class EditEventsStore {
  /**
   * Get the path to the edit events file for a note
   */
  private getEditEventsPath(workspaceId: WorkspaceId, noteId: NoteId): string {
    const notesDir = WorkspaceConfig.paths.notes(workspaceId);
    return path.join(notesDir, `${noteId}.edits.jsonl`);
  }

  /**
   * Get the path to the metadata file for a note's edit events
   */
  private getMetadataPath(workspaceId: WorkspaceId, noteId: NoteId): string {
    const notesDir = WorkspaceConfig.paths.notes(workspaceId);
    return path.join(notesDir, `${noteId}.edits.meta.json`);
  }

  /**
   * Append an edit event to the log
   */
  async append(event: NoteEditEvent): Promise<void> {
    try {
      const filePath = this.getEditEventsPath(event.workspaceId, event.noteId);

      // Ensure directory exists
      await fs.mkdir(path.dirname(filePath), { recursive: true });

      // Append event as JSON line
      const line = `${JSON.stringify(event)}\n`;
      await fs.appendFile(filePath, line, 'utf-8');

      // Update metadata
      await this.updateMetadata(event.workspaceId, event.noteId, event.documentVersion);

      logger.debug('Appended edit event', {
        noteId: event.noteId,
        eventId: event.id,
        version: event.documentVersion,
        hunks: event.hunks.length,
      });
    } catch (error) {
      logger.error('Failed to append edit event', error as Error, {
        noteId: event.noteId,
        eventId: event.id,
      });
      throw error;
    }
  }

  /**
   * Read all edit events for a note
   */
  async readAll(workspaceId: WorkspaceId, noteId: NoteId): Promise<NoteEditEvent[]> {
    try {
      const filePath = this.getEditEventsPath(workspaceId, noteId);

      // Check if file exists
      try {
        await fs.access(filePath);
      } catch {
        // File doesn't exist yet, return empty array
        return [];
      }

      // Read file
      const content = await fs.readFile(filePath, 'utf-8');

      // Parse each line as JSON
      const lines = content
        .trim()
        .split('\n')
        .filter((line) => line.length > 0);
      const events: NoteEditEvent[] = [];

      for (const line of lines) {
        try {
          const event = JSON.parse(line);
          events.push(event);
        } catch {
          logger.warn('Failed to parse edit event line', {
            noteId,
            line: line.substring(0, 100),
          });
        }
      }

      logger.debug('Read edit events', {
        noteId,
        count: events.length,
      });

      return events;
    } catch (error) {
      logger.error('Failed to read edit events', error as Error, {
        noteId,
      });
      return [];
    }
  }

  /**
   * Read recent edit events (within time window)
   */
  async readRecent(
    workspaceId: WorkspaceId,
    noteId: NoteId,
    timeWindowMs: number,
  ): Promise<NoteEditEvent[]> {
    const allEvents = await this.readAll(workspaceId, noteId);
    const cutoff = Date.now() - timeWindowMs;

    return allEvents.filter((event) => {
      const eventTime = new Date(event.timestamp).getTime();
      return eventTime > cutoff;
    });
  }

  /**
   * Get metadata for a note's edit events
   */
  async getMetadata(workspaceId: WorkspaceId, noteId: NoteId): Promise<EditEventMetadata | null> {
    try {
      const metaPath = this.getMetadataPath(workspaceId, noteId);

      try {
        await fs.access(metaPath);
      } catch {
        return null;
      }

      const content = await fs.readFile(metaPath, 'utf-8');
      return JSON.parse(content);
    } catch (error) {
      logger.error('Failed to read edit event metadata', error as Error, {
        noteId,
      });
      return null;
    }
  }

  /**
   * Update metadata after appending an event
   */
  private async updateMetadata(
    workspaceId: WorkspaceId,
    noteId: NoteId,
    documentVersion: number,
  ): Promise<void> {
    try {
      const metaPath = this.getMetadataPath(workspaceId, noteId);

      // Read existing metadata or create new
      let metadata: EditEventMetadata;
      try {
        const content = await fs.readFile(metaPath, 'utf-8');
        metadata = JSON.parse(content);
        metadata.currentVersion = Math.max(metadata.currentVersion, documentVersion);
        metadata.totalEvents += 1;
        metadata.lastUpdated = new Date().toISOString();
      } catch {
        // Create new metadata
        metadata = {
          currentVersion: documentVersion,
          lastUpdated: new Date().toISOString(),
          totalEvents: 1,
        };
      }

      await fs.writeFile(metaPath, JSON.stringify(metadata, null, 2), 'utf-8');

      // Sync file to disk for durability
      await fsyncFile(metaPath);
    } catch (error) {
      logger.error('Failed to update edit event metadata', error as Error, {
        noteId,
      });
      // Don't throw - metadata is not critical
    }
  }

  /**
   * Prune old edit events (optional cleanup)
   * Keep only events within the retention window
   */
  async prune(workspaceId: WorkspaceId, noteId: NoteId, retentionMs: number): Promise<number> {
    try {
      const allEvents = await this.readAll(workspaceId, noteId);
      const cutoff = Date.now() - retentionMs;

      const recentEvents = allEvents.filter((event) => {
        const eventTime = new Date(event.timestamp).getTime();
        return eventTime > cutoff;
      });

      if (recentEvents.length === allEvents.length) {
        // Nothing to prune
        return 0;
      }

      // Rewrite file with only recent events
      const filePath = this.getEditEventsPath(workspaceId, noteId);
      const lines = `${recentEvents.map((event) => JSON.stringify(event)).join('\n')}\n`;
      await fs.writeFile(filePath, lines, 'utf-8');

      // Sync file to disk for durability
      await fsyncFile(filePath);

      const pruned = allEvents.length - recentEvents.length;
      logger.info('Pruned edit events', {
        noteId,
        pruned,
        remaining: recentEvents.length,
      });

      return pruned;
    } catch (error) {
      logger.error('Failed to prune edit events', error as Error, {
        noteId,
      });
      return 0;
    }
  }
}

// Export singleton instance
export const editEventsStore = new EditEventsStore();
