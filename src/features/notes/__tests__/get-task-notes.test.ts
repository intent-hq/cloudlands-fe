/**
 * Tests for getTaskNotes functionality (Phase 1A Increment 7)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { NotesService } from '../notes.service';
import type { Note, WorkspaceId } from '../../../shared/types';
import { randomUUID } from 'crypto';

describe('NotesService.getTaskNotes', () => {
  let notesService: NotesService;
  let testWorkspaceId: WorkspaceId;
  let taskNotes: Note[] = [];
  let regularNote: Note;

  beforeEach(async () => {
    notesService = new NotesService();
    testWorkspaceId = randomUUID() as WorkspaceId;
    taskNotes = [];

    // Create several task notes with different statuses
    const taskConfigs = [
      { title: 'Task 1', status: 'not_started' as const },
      { title: 'Task 2', status: 'in_progress' as const },
      { title: 'Task 3', status: 'complete' as const },
      { title: 'Task 4', status: 'blocked' as const },
      { title: 'Task 5', status: 'in_progress' as const },
    ];

    for (const config of taskConfigs) {
      const createResult = await notesService.createNote({
        workspaceId: testWorkspaceId,
        title: config.title,
        content: `Content for ${config.title}`,
      });

      expect(createResult.ok).toBe(true);
      if (createResult.ok) {
        const markResult = await notesService.markAsTask(testWorkspaceId, createResult.data.id, {
          status: config.status,
        });
        expect(markResult.ok).toBe(true);
        if (markResult.ok) {
          taskNotes.push(markResult.data);
        }
      }
    }

    // Create a regular note (not a task)
    const createRegularResult = await notesService.createNote({
      workspaceId: testWorkspaceId,
      title: 'Regular Note',
      content: 'This is not a task',
    });

    expect(createRegularResult.ok).toBe(true);
    if (createRegularResult.ok) {
      regularNote = createRegularResult.data;
    }
  });

  it('should return all task notes when no filters provided', async () => {
    // Act
    const result = await notesService.getTaskNotes(testWorkspaceId);

    // Assert
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toHaveLength(5);
      // All returned notes should have task metadata
      result.data.forEach((note) => {
        expect(note.metadata?.task).toBeDefined();
      });
    }
  });

  it('should filter tasks by status', async () => {
    // Act
    const result = await notesService.getTaskNotes(testWorkspaceId, {
      status: 'in_progress',
    });

    // Assert
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toHaveLength(2);
      result.data.forEach((note) => {
        expect(note.metadata?.task?.status).toBe('in_progress');
      });
    }
  });

  it('should return empty array when no tasks match filters', async () => {
    // Act
    const result = await notesService.getTaskNotes(testWorkspaceId, {
      status: 'cancelled',
    });

    // Assert
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toHaveLength(0);
    }
  });

  it('should not include regular notes in results', async () => {
    // Act
    const result = await notesService.getTaskNotes(testWorkspaceId);

    // Assert
    expect(result.ok).toBe(true);
    if (result.ok) {
      const regularNoteInResults = result.data.find((note) => note.id === regularNote.id);
      expect(regularNoteInResults).toBeUndefined();
    }
  });

  it('should return empty array for workspace with no task notes', async () => {
    // Arrange - Create a new workspace with no task notes
    const emptyWorkspaceId = randomUUID() as WorkspaceId;

    // Act
    const result = await notesService.getTaskNotes(emptyWorkspaceId);

    // Assert - Should succeed but return empty array
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toHaveLength(0);
    }
  });
});
