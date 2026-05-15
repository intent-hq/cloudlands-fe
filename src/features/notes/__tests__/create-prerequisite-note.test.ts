/**
 * Tests for createPrerequisiteNote() - Phase 1B
 * High-level workflow for creating prerequisite notes
 */

import {
  describe,
  it,
  expect,
  beforeEach,
} from 'vitest';
import { NotesService } from '../notes.service';
import {
  WorkspaceId,
  NoteId,
} from '$shared/types/branded-ids';
import { randomUUID } from 'crypto';

describe('NotesService - createPrerequisiteNote', () => {
  let service: NotesService;
  let workspaceId: WorkspaceId;
  let dependentNoteId: NoteId;

  beforeEach(async () => {
    service = new NotesService();
    workspaceId = randomUUID() as WorkspaceId;

    // Create a dependent note (the one that will have the prerequisite)
    const result = await service.createNote({
      workspaceId,
      title: 'Main Task',
      content: '# Main Task\n\nThis task needs prerequisites.',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      dependentNoteId = result.data.id;
    }
  });

  it('should create a new note, mark it as task, and add as dependency', async () => {
    const result = await service.createPrerequisiteNote(workspaceId, dependentNoteId, {
      title: 'Setup Environment',
      content: '# Setup Environment\n\nInstall dependencies.',
      dependencyType: 'prerequisite',
      reason: 'Must setup before starting main task',
      taskStatus: 'not_started',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const prereqNote = result.data.note;
    expect(result.data.agent).toBeUndefined(); // No agent requested

    // Verify note was created
    expect(prereqNote.title).toBe('Setup Environment');
    expect(prereqNote.content).toContain('Install dependencies');

    // Verify it's marked as a task
    expect(prereqNote.metadata?.task).toBeDefined();
    expect(prereqNote.metadata?.task?.status).toBe('not_started');

    // Verify dependency was added to dependent note
    const dependentResult = await service.getNote(workspaceId, dependentNoteId);
    expect(dependentResult.ok).toBe(true);
    if (!dependentResult.ok) return;

    const dependencies = dependentResult.data.metadata?.dependencies || [];
    expect(dependencies).toHaveLength(1);
    expect(dependencies[0].noteId).toBe(prereqNote.id);
    expect(dependencies[0].type).toBe('prerequisite');
    expect(dependencies[0].reason).toBe('Must setup before starting main task');
  });

  it('should use default content if not provided', async () => {
    const result = await service.createPrerequisiteNote(workspaceId, dependentNoteId, {
      title: 'Quick Prerequisite',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.note.content).toContain('Quick Prerequisite');
    expect(result.data.note.content).toContain('Created as a prerequisite task');
  });

  it('should use default dependency type "prerequisite" if not specified', async () => {
    const result = await service.createPrerequisiteNote(workspaceId, dependentNoteId, {
      title: 'Default Type Test',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const dependentResult = await service.getNote(workspaceId, dependentNoteId);
    expect(dependentResult.ok).toBe(true);
    if (!dependentResult.ok) return;

    const dependencies = dependentResult.data.metadata?.dependencies || [];
    expect(dependencies[0].type).toBe('prerequisite');
  });

  it('should use default task status "not_started" if not specified', async () => {
    const result = await service.createPrerequisiteNote(workspaceId, dependentNoteId, {
      title: 'Default Status Test',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.note.metadata?.task?.status).toBe('not_started');
  });

  it('should support different dependency types', async () => {
    const result = await service.createPrerequisiteNote(workspaceId, dependentNoteId, {
      title: 'Blocking Issue',
      dependencyType: 'blocks',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const dependentResult = await service.getNote(workspaceId, dependentNoteId);
    expect(dependentResult.ok).toBe(true);
    if (!dependentResult.ok) return;

    const dependencies = dependentResult.data.metadata?.dependencies || [];
    expect(dependencies[0].type).toBe('blocks');
  });

  it('should support different task statuses', async () => {
    const result = await service.createPrerequisiteNote(workspaceId, dependentNoteId, {
      title: 'Ready Task',
      taskStatus: 'ready',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.note.metadata?.task?.status).toBe('ready');
  });

  it('should fail if dependent note does not exist', async () => {
    const result = await service.createPrerequisiteNote(workspaceId, 'nonexistent' as NoteId, {
      title: 'Should Fail',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error).toContain('Dependent note not found');
  });

  // Phase 1C: Agent creation tests
  it('should gracefully handle agent creation when agentCreator is not available', async () => {
    // Service created without agentCreator (default behavior in tests)
    const result = await service.createPrerequisiteNote(workspaceId, dependentNoteId, {
      title: 'Task with Agent Request',
      agentConfig: {
        instruction: 'Focus on testing',
        model: 'claude-3-5-sonnet-20241022',
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Task should be created successfully
    expect(result.data.note.title).toBe('Task with Agent Request');
    expect(result.data.note.metadata?.task).toBeDefined();

    // Agent should not be created (graceful degradation)
    expect(result.data.agent).toBeUndefined();
  });
});
