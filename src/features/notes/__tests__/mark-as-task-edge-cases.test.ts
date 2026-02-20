/**
 * Tests for markAsTask edge cases (Phase 1A Increment 3)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { NotesService } from '../notes.service';
import type { Note, WorkspaceId, NoteId } from '../../../shared/types';
import { randomUUID } from 'crypto';

describe('NotesService.markAsTask - Edge Cases', () => {
  let notesService: NotesService;
  let testWorkspaceId: WorkspaceId;
  let testNote: Note;

  beforeEach(async () => {
    notesService = new NotesService();
    testWorkspaceId = randomUUID() as WorkspaceId;

    // Create a test note
    const createResult = await notesService.createNote({
      workspaceId: testWorkspaceId,
      title: 'Test Note',
      content: 'This is a test note',
    });

    expect(createResult.ok).toBe(true);
    if (createResult.ok) {
      testNote = createResult.data;
    }
  });

  it('should return error when note does not exist', async () => {
    // Arrange
    const nonExistentNoteId = randomUUID() as NoteId;

    // Act
    const result = await notesService.markAsTask(testWorkspaceId, nonExistentNoteId, {
      status: 'not_started',
    });

    // Assert
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('not found');
    }
  });

  it('should return error when workspace does not exist', async () => {
    // Arrange
    const nonExistentWorkspaceId = randomUUID() as WorkspaceId;

    // Act
    const result = await notesService.markAsTask(nonExistentWorkspaceId, testNote.id, {
      status: 'not_started',
    });

    // Assert
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('not found');
    }
  });

  it('should allow marking a note as task multiple times (updates task metadata)', async () => {
    // Arrange - Mark as task first time
    const firstResult = await notesService.markAsTask(testWorkspaceId, testNote.id, {
      status: 'not_started',
    });

    expect(firstResult.ok).toBe(true);

    // Act - Mark as task second time with different metadata
    const secondResult = await notesService.markAsTask(testWorkspaceId, testNote.id, {
      status: 'in_progress',
    });

    // Assert - Should succeed and update the task metadata
    expect(secondResult.ok).toBe(true);
    if (secondResult.ok) {
      const task = secondResult.data.metadata?.task;
      expect(task?.status).toBe('in_progress');
    }
  });

  it('should handle invalid task status gracefully', async () => {
    // Act - Try to mark with invalid status (TypeScript should prevent this, but test runtime)
    const result = await notesService.markAsTask(testWorkspaceId, testNote.id, {
      status: 'invalid_status' as any,
    });

    // Assert - Should fail validation
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeDefined();
    }
  });

  it('should handle empty acceptance criteria array', async () => {
    // Act
    const result = await notesService.markAsTask(testWorkspaceId, testNote.id, {
      status: 'not_started',
      acceptanceCriteria: [],
    });

    // Assert - Should succeed with empty array
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.metadata?.task?.acceptanceCriteria).toEqual([]);
    }
  });

  it('should handle missing optional fields', async () => {
    // Act - Only provide required status field
    const result = await notesService.markAsTask(testWorkspaceId, testNote.id, {
      status: 'not_started',
    });

    // Assert - Should succeed with only status
    expect(result.ok).toBe(true);
    if (result.ok) {
      const task = result.data.metadata?.task;
      expect(task?.status).toBe('not_started');
      expect(task?.acceptanceCriteria).toBeUndefined();
      expect(task?.estimatedEffort).toBeUndefined();
    }
  });

  it('should handle concurrent markAsTask calls', async () => {
    // Act - Make multiple concurrent calls
    const results = await Promise.all([
      notesService.markAsTask(testWorkspaceId, testNote.id, { status: 'not_started' }),
      notesService.markAsTask(testWorkspaceId, testNote.id, { status: 'in_progress' }),
      notesService.markAsTask(testWorkspaceId, testNote.id, { status: 'complete' }),
    ]);

    // Assert - All should succeed (last write wins)
    results.forEach((result) => {
      expect(result.ok).toBe(true);
    });

    // Verify final state
    const getResult = await notesService.getNote(testWorkspaceId, testNote.id);
    expect(getResult.ok).toBe(true);
    if (getResult.ok) {
      expect(getResult.data.metadata?.task).toBeDefined();
      // One of the statuses should be set
      expect(['not_started', 'in_progress', 'complete']).toContain(
        getResult.data.metadata?.task?.status,
      );
    }
  });
});
