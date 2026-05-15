import {
  describe,
  it,
  expect,
  beforeEach,
} from 'vitest';
import { NotesService } from '../notes.service';
import type { WorkspaceId } from '../../../shared/types';
import { randomUUID } from 'crypto';

describe('NotesService.addDependency - Happy Path', () => {
  let service: NotesService;
  let workspaceId: WorkspaceId;

  beforeEach(async () => {
    service = new NotesService();
    workspaceId = randomUUID() as WorkspaceId;
  });

  it('should add dependency to a note', async () => {
    // Arrange
    const note1Result = await service.createNote({
      workspaceId,
      title: 'Task 1',
      content: 'First task content',
    });
    const note2Result = await service.createNote({
      workspaceId,
      title: 'Task 2',
      content: 'Second task content',
    });

    expect(note1Result.ok).toBe(true);
    expect(note2Result.ok).toBe(true);
    if (!note1Result.ok || !note2Result.ok) return;

    const note1 = note1Result.data;
    const note2 = note2Result.data;

    // Act
    const result = await service.addDependency(workspaceId, note1.id, {
      noteId: note2.id,
      type: 'blocks',
      reason: 'Must complete Task 2 first',
    });

    // Assert
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.metadata?.dependencies).toHaveLength(1);
      expect(result.data.metadata?.dependencies?.[0].noteId).toBe(note2.id);
      expect(result.data.metadata?.dependencies?.[0].type).toBe('blocks');
      expect(result.data.metadata?.dependencies?.[0].reason).toBe('Must complete Task 2 first');
      expect(result.data.metadata?.dependencies?.[0].createdAt).toBeDefined();
    }
  });

  it('should allow multiple dependencies on same note', async () => {
    // Arrange
    const note1Result = await service.createNote({
      workspaceId,
      title: 'Task 1',
      content: 'Content 1',
    });
    const note2Result = await service.createNote({
      workspaceId,
      title: 'Task 2',
      content: 'Content 2',
    });
    const note3Result = await service.createNote({
      workspaceId,
      title: 'Task 3',
      content: 'Content 3',
    });

    expect(note1Result.ok && note2Result.ok && note3Result.ok).toBe(true);
    if (!note1Result.ok || !note2Result.ok || !note3Result.ok) return;

    const note1 = note1Result.data;
    const note2 = note2Result.data;
    const note3 = note3Result.data;

    // Act
    await service.addDependency(workspaceId, note1.id, {
      noteId: note2.id,
      type: 'blocks',
    });
    const result = await service.addDependency(workspaceId, note1.id, {
      noteId: note3.id,
      type: 'blocks',
    });

    // Assert
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.metadata?.dependencies).toHaveLength(2);
      const noteIds = result.data.metadata?.dependencies?.map((d) => d.noteId);
      expect(noteIds).toContain(note2.id);
      expect(noteIds).toContain(note3.id);
    }
  });

  it('should allow dependency without reason', async () => {
    // Arrange
    const note1Result = await service.createNote({
      workspaceId,
      title: 'Task 1',
      content: 'Content 1',
    });
    const note2Result = await service.createNote({
      workspaceId,
      title: 'Task 2',
      content: 'Content 2',
    });

    expect(note1Result.ok && note2Result.ok).toBe(true);
    if (!note1Result.ok || !note2Result.ok) return;

    const note1 = note1Result.data;
    const note2 = note2Result.data;

    // Act
    const result = await service.addDependency(workspaceId, note1.id, {
      noteId: note2.id,
      type: 'related',
    });

    // Assert
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.metadata?.dependencies).toHaveLength(1);
      expect(result.data.metadata?.dependencies?.[0].reason).toBeUndefined();
    }
  });
});
