/**
 * Tests for updateTaskStatus edge cases (Phase 1A Increment 5)
 */

import {
  describe,
  it,
  expect,
  beforeEach,
} from 'vitest';
import { NotesService } from '../notes.service';
import type { Note, WorkspaceId, NoteId } from '../../../shared/types';
import { randomUUID } from 'crypto';

describe('NotesService.updateTaskStatus - Edge Cases', () => {
  let notesService: NotesService;
  let testWorkspaceId: WorkspaceId;
  let testNote: Note;
  let testTaskNote: Note;

  beforeEach(async () => {
    notesService = new NotesService();
    testWorkspaceId = randomUUID() as WorkspaceId;

    // Create a regular note (not a task)
    const createResult = await notesService.createNote({
      workspaceId: testWorkspaceId,
      title: 'Regular Note',
      content: 'This is not a task',
    });

    expect(createResult.ok).toBe(true);
    if (createResult.ok) {
      testNote = createResult.data;
    }

    // Create a task note
    const createTaskResult = await notesService.createNote({
      workspaceId: testWorkspaceId,
      title: 'Test Task',
      content: 'This is a test task',
    });

    expect(createTaskResult.ok).toBe(true);
    if (createTaskResult.ok) {
      const markResult = await notesService.markAsTask(testWorkspaceId, createTaskResult.data.id, {
        status: 'not_started',
      });
      expect(markResult.ok).toBe(true);
      if (markResult.ok) {
        testTaskNote = markResult.data;
      }
    }
  });

  it('should return error when note does not exist', async () => {
    // Arrange
    const nonExistentNoteId = randomUUID() as NoteId;

    // Act
    const result = await notesService.updateTaskStatus(
      testWorkspaceId,
      nonExistentNoteId,
      'in_progress',
    );

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
    const result = await notesService.updateTaskStatus(
      nonExistentWorkspaceId,
      testTaskNote.id,
      'in_progress',
    );

    // Assert
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('not found');
    }
  });

  it('should return error when note is not a task', async () => {
    // Act
    const result = await notesService.updateTaskStatus(testWorkspaceId, testNote.id, 'in_progress');

    // Assert
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('not a task');
    }
  });

  it('should handle invalid status gracefully', async () => {
    // Act - Try to update with invalid status
    const result = await notesService.updateTaskStatus(
      testWorkspaceId,
      testTaskNote.id,
      'invalid_status' as any,
    );

    // Assert - Should fail validation
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeDefined();
    }
  });

  it('should allow updating to the same status (idempotent)', async () => {
    // Arrange - Set initial status
    const firstResult = await notesService.updateTaskStatus(
      testWorkspaceId,
      testTaskNote.id,
      'in_progress',
    );
    expect(firstResult.ok).toBe(true);

    // Act - Update to same status
    const secondResult = await notesService.updateTaskStatus(
      testWorkspaceId,
      testTaskNote.id,
      'in_progress',
    );

    // Assert - Should succeed
    expect(secondResult.ok).toBe(true);
    if (secondResult.ok) {
      expect(secondResult.data.metadata?.task?.status).toBe('in_progress');
    }
  });

  it('should not overwrite startedAt when updating to in_progress again', async () => {
    // Arrange - Set to in_progress first time
    const firstResult = await notesService.updateTaskStatus(
      testWorkspaceId,
      testTaskNote.id,
      'in_progress',
    );
    expect(firstResult.ok).toBe(true);
    const originalStartedAt = firstResult.ok
      ? firstResult.data.metadata?.task?.startedAt
      : undefined;

    // Wait a bit to ensure timestamp would be different
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Act - Update to in_progress again
    const secondResult = await notesService.updateTaskStatus(
      testWorkspaceId,
      testTaskNote.id,
      'in_progress',
    );

    // Assert - startedAt should not change
    expect(secondResult.ok).toBe(true);
    if (secondResult.ok) {
      expect(secondResult.data.metadata?.task?.startedAt).toBe(originalStartedAt);
    }
  });
});
