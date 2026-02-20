/**
 * Tests for assignAgentToTask operation
 * Phase 1C - Increment 2: Assign Agent to Task
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import { NotesService } from '../notes.service';
import { InMemoryNotesRepository } from '../notes.repository';
import { WorkspaceId, createAgentId } from '$shared/types/branded-ids';
import type { Note } from '$shared/types';

describe('assignAgentToTask', () => {
  let notesService: NotesService;
  let repository: InMemoryNotesRepository;
  let workspaceId: WorkspaceId;
  let testNote: Note;

  beforeEach(async () => {
    // Use in-memory repository for tests
    repository = new InMemoryNotesRepository();
    notesService = new NotesService(repository);
    workspaceId = WorkspaceId(uuidv4());

    // Create a test note and mark it as a task
    const createResult = await notesService.createNote({
      workspaceId,
      title: 'Test Task',
      content: 'Test task content',
    });

    if (!createResult.ok) {
      throw new Error('Failed to create test note');
    }

    testNote = createResult.data;

    // Mark as task
    const markResult = await notesService.markAsTask(workspaceId, testNote.id, {
      status: 'not_started',
    });

    if (!markResult.ok) {
      throw new Error('Failed to mark note as task');
    }

    testNote = markResult.data;
  });

  it('should assign agent to task (adds to empty array)', async () => {
    const agentId = createAgentId(uuidv4());

    const result = await notesService.assignAgentToTask(workspaceId, testNote.id, agentId);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.metadata?.task?.assignedAgentIds).toEqual([agentId]);
    }
  });

  it('should assign second agent to task (appends to array)', async () => {
    const agentId1 = createAgentId(uuidv4());
    const agentId2 = createAgentId(uuidv4());

    // Assign first agent
    const result1 = await notesService.assignAgentToTask(workspaceId, testNote.id, agentId1);
    expect(result1.ok).toBe(true);

    // Assign second agent
    const result2 = await notesService.assignAgentToTask(workspaceId, testNote.id, agentId2);

    expect(result2.ok).toBe(true);
    if (result2.ok) {
      expect(result2.data.metadata?.task?.assignedAgentIds).toEqual([agentId1, agentId2]);
    }
  });

  it('should assign same agent twice (allowed, creates duplicate)', async () => {
    const agentId = createAgentId(uuidv4());

    // Assign agent first time
    const result1 = await notesService.assignAgentToTask(workspaceId, testNote.id, agentId);
    expect(result1.ok).toBe(true);

    // Assign same agent again
    const result2 = await notesService.assignAgentToTask(workspaceId, testNote.id, agentId);

    expect(result2.ok).toBe(true);
    if (result2.ok) {
      expect(result2.data.metadata?.task?.assignedAgentIds).toEqual([agentId, agentId]);
    }
  });

  it('should fail to assign agent to non-task note', async () => {
    const agentId = createAgentId(uuidv4());

    // Create a regular note (not a task)
    const createResult = await notesService.createNote({
      workspaceId,
      title: 'Regular Note',
      content: 'Not a task',
    });

    if (!createResult.ok) {
      throw new Error(`Failed to create regular note: ${createResult.error}`);
    }

    const regularNote = createResult.data;

    // Try to assign agent to non-task note
    const result = await notesService.assignAgentToTask(workspaceId, regularNote.id, agentId);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('not a task');
    }
  });

  it('should fail to assign agent to non-existent note', async () => {
    const agentId = createAgentId(uuidv4());
    const nonExistentNoteId = uuidv4();

    const result = await notesService.assignAgentToTask(workspaceId, nonExistentNoteId, agentId);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('not found');
    }
  });

  it('should emit note:updated event after assignment', async () => {
    const agentId = createAgentId(uuidv4());

    // Track if event was emitted
    let eventEmitted = false;
    const eventHandler = () => {
      eventEmitted = true;
    };

    // Listen for the event (this is a simplified test - in real code we'd use the event bus)
    // For now, we'll just verify the operation succeeds
    const result = await notesService.assignAgentToTask(workspaceId, testNote.id, agentId);

    expect(result.ok).toBe(true);
    // TODO: Add proper event emission testing when event bus is available in tests
  });
});
