/**
 * Tests for removeTaskMetadata functionality (Phase 1A Increment 6)
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

describe('NotesService.removeTaskMetadata', () => {
  let notesService: NotesService;
  let testWorkspaceId: WorkspaceId;
  let testTaskNote: Note;
  let testRegularNote: Note;

  beforeEach(async () => {
    notesService = new NotesService();
    testWorkspaceId = randomUUID() as WorkspaceId;

    // Create a task note
    const createTaskResult = await notesService.createNote({
      workspaceId: testWorkspaceId,
      title: 'Test Task',
      content: 'This is a test task',
    });

    expect(createTaskResult.ok).toBe(true);
    if (createTaskResult.ok) {
      const markResult = await notesService.markAsTask(testWorkspaceId, createTaskResult.data.id, {
        status: 'in_progress',
        acceptanceCriteria: ['Criterion 1', 'Criterion 2'],
      });
      expect(markResult.ok).toBe(true);
      if (markResult.ok) {
        testTaskNote = markResult.data;
      }
    }

    // Create a regular note
    const createRegularResult = await notesService.createNote({
      workspaceId: testWorkspaceId,
      title: 'Regular Note',
      content: 'This is not a task',
    });

    expect(createRegularResult.ok).toBe(true);
    if (createRegularResult.ok) {
      testRegularNote = createRegularResult.data;
    }
  });

  it('should remove task metadata from a task note', async () => {
    // Act
    const result = await notesService.removeTaskMetadata(testWorkspaceId, testTaskNote.id);

    // Assert
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.metadata?.task).toBeUndefined();
    }
  });

  it('should preserve other metadata when removing task metadata', async () => {
    // Arrange - Add some other metadata
    const updateResult = await notesService.updateNote({
      workspaceId: testWorkspaceId,
      id: testTaskNote.id,
      metadata: {
        ...testTaskNote.metadata,
        wordCount: 100,
        characterCount: 500,
      },
    });
    expect(updateResult.ok).toBe(true);

    // Act
    const result = await notesService.removeTaskMetadata(testWorkspaceId, testTaskNote.id);

    // Assert
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.metadata?.task).toBeUndefined();
      expect(result.data.metadata?.wordCount).toBe(100);
      expect(result.data.metadata?.characterCount).toBe(500);
    }
  });

  it('should preserve note content and title when removing task metadata', async () => {
    // Act
    const result = await notesService.removeTaskMetadata(testWorkspaceId, testTaskNote.id);

    // Assert
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.title).toBe(testTaskNote.title);
      expect(result.data.content).toBe(testTaskNote.content);
    }
  });

  it('should emit note:updated event when removing task metadata', async () => {
    // Arrange
    let eventEmitted = false;
    const eventBus = (notesService as any).eventBus;
    const listener = () => {
      eventEmitted = true;
    };
    eventBus.on('note:updated', listener);

    // Act
    await notesService.removeTaskMetadata(testWorkspaceId, testTaskNote.id);

    // Assert
    expect(eventEmitted).toBe(true);

    // Cleanup
    eventBus.offEvent('note:updated', listener);
  });

  it('should return error when note does not exist', async () => {
    // Arrange
    const nonExistentNoteId = randomUUID() as NoteId;

    // Act
    const result = await notesService.removeTaskMetadata(testWorkspaceId, nonExistentNoteId);

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
    const result = await notesService.removeTaskMetadata(nonExistentWorkspaceId, testTaskNote.id);

    // Assert
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('not found');
    }
  });

  it('should return error when note is not a task', async () => {
    // Act
    const result = await notesService.removeTaskMetadata(testWorkspaceId, testRegularNote.id);

    // Assert
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('not a task');
    }
  });

  it('should allow marking as task again after removing task metadata', async () => {
    // Arrange - Remove task metadata
    const removeResult = await notesService.removeTaskMetadata(testWorkspaceId, testTaskNote.id);
    expect(removeResult.ok).toBe(true);

    // Act - Mark as task again
    const markResult = await notesService.markAsTask(testWorkspaceId, testTaskNote.id, {
      status: 'not_started',
    });

    // Assert
    expect(markResult.ok).toBe(true);
    if (markResult.ok) {
      expect(markResult.data.metadata?.task?.status).toBe('not_started');
    }
  });
});
