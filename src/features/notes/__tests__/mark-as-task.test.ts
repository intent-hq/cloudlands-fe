/**
 * Tests for markAsTask functionality (Phase 1A Increment 2)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { NotesService } from '../notes.service';
import type { Note, WorkspaceId, NoteId, TaskStatus } from '../../../shared/types';
import { randomUUID } from 'crypto';

describe('NotesService.markAsTask - Happy Path', () => {
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

  it('should convert a regular note to a task with default status', async () => {
    // Act
    const result = await notesService.markAsTask(testWorkspaceId, testNote.id, {
      status: 'not_started',
    });

    // Assert
    expect(result.ok).toBe(true);
    if (result.ok) {
      const updatedNote = result.data;
      expect(updatedNote.metadata?.task).toBeDefined();
      expect(updatedNote.metadata?.task?.status).toBe('not_started');
    }
  });

  it('should set task status to provided value', async () => {
    // Arrange
    const statuses: TaskStatus[] = [
      'not_started',
      'waiting',
      'discussion_needed',
      'in_progress',
      'review_required',
      'complete',
      'cancelled',
    ];

    // Act & Assert
    for (const status of statuses) {
      const result = await notesService.markAsTask(testWorkspaceId, testNote.id, { status });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.metadata?.task?.status).toBe(status);
      }
    }
  });

  it('should set optional task fields when provided', async () => {
    // Act
    const result = await notesService.markAsTask(testWorkspaceId, testNote.id, {
      status: 'not_started',
      acceptanceCriteria: ['Criterion 1', 'Criterion 2'],
      estimatedEffort: '2 hours',
    });

    // Assert
    expect(result.ok).toBe(true);
    if (result.ok) {
      const task = result.data.metadata?.task;
      expect(task).toBeDefined();
      expect(task?.status).toBe('not_started');
      expect(task?.acceptanceCriteria).toEqual(['Criterion 1', 'Criterion 2']);
      expect(task?.estimatedEffort).toBe('2 hours');
    }
  });

  it('should preserve existing note metadata when adding task', async () => {
    // Arrange - Update note with some metadata
    await notesService.updateNote({
      workspaceId: testWorkspaceId,
      id: testNote.id,
      metadata: {
        author: {
          id: 'test-author-id',
          name: 'Test Author',
          type: 'user',
        },
        wordCount: 100,
      },
    });

    // Act
    const result = await notesService.markAsTask(testWorkspaceId, testNote.id, {
      status: 'not_started',
    });

    // Assert
    expect(result.ok).toBe(true);
    if (result.ok) {
      const metadata = result.data.metadata;
      expect(metadata?.task).toBeDefined();
      expect(metadata?.author?.name).toBe('Test Author');
      expect(metadata?.wordCount).toBe(100);
    }
  });

  it('should emit note:updated event when marking as task', async () => {
    // Arrange
    let eventEmitted = false;
    const eventBus = (notesService as any).eventBus;
    const listener = () => {
      eventEmitted = true;
    };
    eventBus.onDomainEvent('note:updated', listener);

    // Act
    await notesService.markAsTask(testWorkspaceId, testNote.id, {
      status: 'not_started',
    });

    // Assert
    expect(eventEmitted).toBe(true);

    // Cleanup
    eventBus.offDomainEvent('note:updated', listener);
  });

  it('should persist task metadata to disk', async () => {
    // Act
    const markResult = await notesService.markAsTask(testWorkspaceId, testNote.id, {
      status: 'in_progress',
    });

    expect(markResult.ok).toBe(true);

    // Assert - Retrieve note again to verify persistence
    const getResult = await notesService.getNote(testWorkspaceId, testNote.id);
    expect(getResult.ok).toBe(true);
    if (getResult.ok) {
      const task = getResult.data.metadata?.task;
      expect(task).toBeDefined();
      expect(task?.status).toBe('in_progress');
    }
  });
});
