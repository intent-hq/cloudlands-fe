/**
 * User Activity Service Tests
 *
 * TDD tests for the user activity service layer.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { UserActivityService } from '../user-activity.service';
import { InMemoryUserActivityRepository } from '../user-activity.repository';
import { NoteId, WorkspaceId } from '$shared/types/branded-ids';

describe('UserActivityService', () => {
  let service: UserActivityService;
  let repo: InMemoryUserActivityRepository;
  const workspaceId = WorkspaceId('test-workspace-svc');

  beforeEach(() => {
    repo = new InMemoryUserActivityRepository();
    service = new UserActivityService(repo);
  });

  describe('markNoteRead', () => {
    it('should record the first read of a note', async () => {
      const noteId = NoteId('note-1');

      await service.markNoteRead(workspaceId, noteId);

      const status = await service.getNoteReadStatus(workspaceId, noteId);
      expect(status).not.toBeNull();
      expect(status?.lastReadAt).toBeDefined();
      expect(status?.readCount).toBe(1);
    });

    it('should increment readCount on subsequent reads', async () => {
      const noteId = NoteId('note-2');

      await service.markNoteRead(workspaceId, noteId);
      await service.markNoteRead(workspaceId, noteId);
      await service.markNoteRead(workspaceId, noteId);

      const status = await service.getNoteReadStatus(workspaceId, noteId);
      expect(status?.readCount).toBe(3);
    });

    it('should update lastReadAt on each read', async () => {
      const noteId = NoteId('note-3');

      await service.markNoteRead(workspaceId, noteId);
      const firstRead = (await service.getNoteReadStatus(workspaceId, noteId))?.lastReadAt;

      // Wait a small amount to ensure different timestamp
      await new Promise((r) => setTimeout(r, 10));

      await service.markNoteRead(workspaceId, noteId);
      const secondRead = (await service.getNoteReadStatus(workspaceId, noteId))?.lastReadAt;

      expect(secondRead).not.toBe(firstRead);
      expect(new Date(secondRead!).getTime()).toBeGreaterThan(new Date(firstRead!).getTime());
    });

    it('should track multiple notes independently', async () => {
      const noteA = NoteId('note-a');
      const noteB = NoteId('note-b');

      await service.markNoteRead(workspaceId, noteA);
      await service.markNoteRead(workspaceId, noteA);
      await service.markNoteRead(workspaceId, noteB);

      const statusA = await service.getNoteReadStatus(workspaceId, noteA);
      const statusB = await service.getNoteReadStatus(workspaceId, noteB);

      expect(statusA?.readCount).toBe(2);
      expect(statusB?.readCount).toBe(1);
    });
  });

  describe('getNoteReadStatus', () => {
    it('should return null for never-read note', async () => {
      const status = await service.getNoteReadStatus(workspaceId, NoteId('never-read'));
      expect(status).toBeNull();
    });
  });

  describe('getUnreadNoteIds', () => {
    it('should return notes updated after lastReadAt', async () => {
      const noteRead = NoteId('note-read');
      const noteUnread = NoteId('note-unread');

      // Mark one note as read at a specific time
      await service.markNoteRead(workspaceId, noteRead);

      // Create notes with different update times
      const readStatus = await service.getNoteReadStatus(workspaceId, noteRead);
      const readTime = new Date(readStatus!.lastReadAt);

      // Both notes have createdAt before updatedAt (so they've been updated)
      const createdAt = new Date(readTime.getTime() - 5000).toISOString();
      const notes = [
        { id: noteRead, updatedAt: new Date(readTime.getTime() - 1000).toISOString(), createdAt }, // Before read
        { id: noteUnread, updatedAt: new Date(readTime.getTime() + 1000).toISOString(), createdAt }, // After read (unread)
      ];

      const unreadIds = await service.getUnreadNoteIds(workspaceId, notes);

      expect(unreadIds).toContain(noteUnread);
      expect(unreadIds).not.toContain(noteRead);
    });

    it('should return notes that have never been read but have been updated', async () => {
      const neverReadNote = NoteId('never-read-note');

      // Note was created 10 seconds ago and updated now (so it has been updated)
      const createdAt = new Date(Date.now() - 10000).toISOString();
      const updatedAt = new Date().toISOString();
      const notes = [{ id: neverReadNote, updatedAt, createdAt }];

      const unreadIds = await service.getUnreadNoteIds(workspaceId, notes);

      expect(unreadIds).toContain(neverReadNote);
    });

    it('should NOT return newly created notes that have never been updated', async () => {
      const newNote = NoteId('new-note');

      // Note was just created - createdAt and updatedAt are the same
      const now = new Date().toISOString();
      const notes = [{ id: newNote, updatedAt: now, createdAt: now }];

      const unreadIds = await service.getUnreadNoteIds(workspaceId, notes);

      // Should NOT be marked as unread since it was just created
      expect(unreadIds).not.toContain(newNote);
      expect(unreadIds).toHaveLength(0);
    });

    it('should NOT return newly created notes without createdAt (legacy behavior)', async () => {
      const newNote = NoteId('new-note-no-created');

      // Note without createdAt - should be treated as just created
      const now = new Date().toISOString();
      const notes = [{ id: newNote, updatedAt: now }]; // No createdAt

      const unreadIds = await service.getUnreadNoteIds(workspaceId, notes);

      // Should NOT be marked as unread since createdAt defaults to updatedAt
      expect(unreadIds).not.toContain(newNote);
      expect(unreadIds).toHaveLength(0);
    });

    it('should return empty array when all notes are read', async () => {
      const noteId = NoteId('read-note');

      await service.markNoteRead(workspaceId, noteId);

      // Note was created 20 seconds ago and updated 10 seconds ago (before read)
      const createdAt = new Date(Date.now() - 20000).toISOString();
      const notes = [
        { id: noteId, updatedAt: new Date(Date.now() - 10000).toISOString(), createdAt }, // Updated before read
      ];

      const unreadIds = await service.getUnreadNoteIds(workspaceId, notes);

      expect(unreadIds).toHaveLength(0);
    });
  });

  describe('caching', () => {
    it('should cache data after first load', async () => {
      const noteId = NoteId('cache-test');

      // First call loads from repository
      await service.markNoteRead(workspaceId, noteId);

      // Clear the repository to prove cache is being used
      repo.clear();

      // Should still return data from cache
      const status = await service.getNoteReadStatus(workspaceId, noteId);
      expect(status).not.toBeNull();
      expect(status?.readCount).toBe(1);
    });

    it('should clear cache when clearCache is called', async () => {
      const noteId = NoteId('clear-cache-test');

      await service.markNoteRead(workspaceId, noteId);

      // Clear both cache and repository
      service.clearCache(workspaceId);
      repo.clear();

      // Should return null since both cache and repo are empty
      const status = await service.getNoteReadStatus(workspaceId, noteId);
      expect(status).toBeNull();
    });

    it('should clear all caches when clearCache is called without workspaceId', async () => {
      const noteId = NoteId('clear-all-test');
      const workspace2 = WorkspaceId('test-workspace-2');

      await service.markNoteRead(workspaceId, noteId);
      await service.markNoteRead(workspace2, noteId);

      // Clear all caches and repository
      service.clearCache();
      repo.clear();

      // Both should return null
      const status1 = await service.getNoteReadStatus(workspaceId, noteId);
      const status2 = await service.getNoteReadStatus(workspace2, noteId);
      expect(status1).toBeNull();
      expect(status2).toBeNull();
    });
  });
});
