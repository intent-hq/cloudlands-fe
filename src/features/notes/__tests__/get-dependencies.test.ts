import {
  describe,
  it,
  expect,
  beforeEach,
} from 'vitest';
import { NotesService } from '../notes.service';
import type { WorkspaceId } from '../../../shared/types';
import { randomUUID } from 'crypto';

describe('NotesService.getDependencies', () => {
  let service: NotesService;
  let workspaceId: WorkspaceId;

  beforeEach(async () => {
    service = new NotesService();
    workspaceId = randomUUID() as WorkspaceId;
  });

  it('should return dependencies for a note', async () => {
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

    // Add dependency
    await service.addDependency(workspaceId, note1.id, {
      noteId: note2.id,
      type: 'blocks',
      reason: 'Must complete Task 2 first',
    });

    // Act
    const result = await service.getDependencies(workspaceId, note1.id);

    // Assert
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toHaveLength(1);
      expect(result.data[0].noteId).toBe(note2.id);
      expect(result.data[0].type).toBe('blocks');
      expect(result.data[0].reason).toBe('Must complete Task 2 first');
      expect(result.data[0].createdAt).toBeDefined();
    }
  });

  it('should return multiple dependencies', async () => {
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

    // Add two dependencies
    await service.addDependency(workspaceId, note1.id, {
      noteId: note2.id,
      type: 'blocks',
    });
    await service.addDependency(workspaceId, note1.id, {
      noteId: note3.id,
      type: 'related',
    });

    // Act
    const result = await service.getDependencies(workspaceId, note1.id);

    // Assert
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toHaveLength(2);
      const noteIds = result.data.map((d) => d.noteId);
      expect(noteIds).toContain(note2.id);
      expect(noteIds).toContain(note3.id);
    }
  });

  it('should return empty array for note with no dependencies', async () => {
    // Arrange
    const note1Result = await service.createNote({
      workspaceId,
      title: 'Task 1',
      content: 'Content 1',
    });

    expect(note1Result.ok).toBe(true);
    if (!note1Result.ok) return;

    const note1 = note1Result.data;

    // Act
    const result = await service.getDependencies(workspaceId, note1.id);

    // Assert
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toEqual([]);
    }
  });

  it('should return error when note does not exist', async () => {
    // Act
    const result = await service.getDependencies(workspaceId, 'nonexistent' as any);

    // Assert
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('not found');
    }
  });
});
