/**
 * Tests for updateTaskStatus functionality (Phase 1A Increment 4)
 */

import {
  describe,
  it,
  expect,
  beforeEach,
} from 'vitest';
import { NotesService } from '../notes.service';
import type { Note, WorkspaceId, TaskStatus } from '../../../shared/types';
import { randomUUID } from 'crypto';

describe('NotesService.updateTaskStatus - Happy Path', () => {
  let notesService: NotesService;
  let testWorkspaceId: WorkspaceId;
  let testNote: Note;

  beforeEach(async () => {
    notesService = new NotesService();
    testWorkspaceId = randomUUID() as WorkspaceId;

    // Create a test note and mark it as a task
    const createResult = await notesService.createNote({
      workspaceId: testWorkspaceId,
      title: 'Test Task',
      content: 'This is a test task',
    });

    expect(createResult.ok).toBe(true);
    if (createResult.ok) {
      testNote = createResult.data;

      // Mark as task
      const markResult = await notesService.markAsTask(testWorkspaceId, testNote.id, {
        status: 'not_started',
      });
      expect(markResult.ok).toBe(true);
      if (markResult.ok) {
        testNote = markResult.data;
      }
    }
  });

  it('should update task status', async () => {
    // Act
    const result = await notesService.updateTaskStatus(testWorkspaceId, testNote.id, 'in_progress');

    // Assert
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.metadata?.task?.status).toBe('in_progress');
    }
  });

  it('should set startedAt timestamp when status changes to in_progress', async () => {
    // Arrange
    const beforeTime = new Date().toISOString();

    // Act
    const result = await notesService.updateTaskStatus(testWorkspaceId, testNote.id, 'in_progress');

    // Assert
    expect(result.ok).toBe(true);
    if (result.ok) {
      const task = result.data.metadata?.task;
      expect(task?.status).toBe('in_progress');
      expect(task?.startedAt).toBeDefined();
      expect(task?.startedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/); // ISO format
      expect(new Date(task!.startedAt!).getTime()).toBeGreaterThanOrEqual(
        new Date(beforeTime).getTime(),
      );
    }
  });

  it('should set completedAt timestamp when status changes to complete', async () => {
    // Arrange - First move to in_progress
    await notesService.updateTaskStatus(testWorkspaceId, testNote.id, 'in_progress');
    const beforeTime = new Date().toISOString();

    // Act - Then complete
    const result = await notesService.updateTaskStatus(testWorkspaceId, testNote.id, 'complete');

    // Assert
    expect(result.ok).toBe(true);
    if (result.ok) {
      const task = result.data.metadata?.task;
      expect(task?.status).toBe('complete');
      expect(task?.completedAt).toBeDefined();
      expect(task?.completedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/); // ISO format
      expect(new Date(task!.completedAt!).getTime()).toBeGreaterThanOrEqual(
        new Date(beforeTime).getTime(),
      );
    }
  });

  it('should preserve startedAt when updating status after in_progress', async () => {
    // Arrange - Move to in_progress first
    const inProgressResult = await notesService.updateTaskStatus(
      testWorkspaceId,
      testNote.id,
      'in_progress',
    );
    expect(inProgressResult.ok).toBe(true);
    const originalStartedAt = inProgressResult.ok
      ? inProgressResult.data.metadata?.task?.startedAt
      : undefined;

    // Act - Update to waiting
    const result = await notesService.updateTaskStatus(testWorkspaceId, testNote.id, 'waiting');

    // Assert - startedAt should be preserved
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.metadata?.task?.startedAt).toBe(originalStartedAt);
    }
  });

  it('should allow status transitions through all states', async () => {
    // Test a typical workflow: not_started → in_progress ↔ review_required → complete
    const transitions: TaskStatus[] = [
      'not_started',
      'in_progress',
      'review_required',
      'in_progress', // back to work after review feedback
      'review_required',
      'complete',
    ];

    for (const status of transitions) {
      const result = await notesService.updateTaskStatus(testWorkspaceId, testNote.id, status);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.metadata?.task?.status).toBe(status);
      }
    }
  });

  it('should allow transitions through special states', async () => {
    // Test special states: waiting, discussion_needed, cancelled
    const transitions: TaskStatus[] = [
      'in_progress',
      'waiting', // waiting on dependency
      'in_progress', // dependency resolved
      'discussion_needed', // agent needs input
      'in_progress', // after discussion
      'cancelled', // task abandoned
    ];

    for (const status of transitions) {
      const result = await notesService.updateTaskStatus(testWorkspaceId, testNote.id, status);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.metadata?.task?.status).toBe(status);
      }
    }
  });

  it('should emit note:updated event when updating status', async () => {
    // Arrange
    let eventEmitted = false;
    const eventBus = (notesService as any).eventBus;
    const listener = () => {
      eventEmitted = true;
    };
    eventBus.on('note:updated', listener);

    // Act
    await notesService.updateTaskStatus(testWorkspaceId, testNote.id, 'in_progress');

    // Assert
    expect(eventEmitted).toBe(true);

    // Cleanup
    eventBus.offEvent('note:updated', listener);
  });
});
