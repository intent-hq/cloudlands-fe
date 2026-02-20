import { describe, it, expect, beforeEach } from 'vitest';
import { NotesService } from '../notes.service';
import type { WorkspaceId } from '../../../shared/types';
import { randomUUID } from 'crypto';

describe('NotesService.removeDependency', () => {
  let service: NotesService;
  let workspaceId: WorkspaceId;

  beforeEach(async () => {
    service = new NotesService();
    workspaceId = randomUUID() as WorkspaceId;
  });

  it('should remove a dependency from a note', async () => {
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
    });

    // Act - remove the dependency
    const result = await service.removeDependency(workspaceId, note1.id, note2.id);

    // Assert
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.metadata?.dependencies).toEqual([]);
    }
  });

  it('should remove specific dependency when multiple exist', async () => {
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
      type: 'blocks',
    });

    // Act - remove only the first dependency
    const result = await service.removeDependency(workspaceId, note1.id, note2.id);

    // Assert
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.metadata?.dependencies).toHaveLength(1);
      expect(result.data.metadata?.dependencies?.[0].noteId).toBe(note3.id);
    }
  });

  it('should return error when source note does not exist', async () => {
    // Arrange
    const note2Result = await service.createNote({
      workspaceId,
      title: 'Task 2',
      content: 'Content 2',
    });

    expect(note2Result.ok).toBe(true);
    if (!note2Result.ok) return;

    const note2 = note2Result.data;

    // Act
    const result = await service.removeDependency(workspaceId, 'nonexistent' as any, note2.id);

    // Assert
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('not found');
    }
  });

  it('should return error when dependency does not exist', async () => {
    // Arrange
    const note1Result = await service.createNote({
      workspaceId,
      title: 'Task 1',
      content: 'Content 1',
    });

    expect(note1Result.ok).toBe(true);
    if (!note1Result.ok) return;

    const note1 = note1Result.data;

    // Act - try to remove non-existent dependency
    const result = await service.removeDependency(workspaceId, note1.id, 'nonexistent' as any);

    // Assert
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('not found');
    }
  });

  it('should handle note with no dependencies', async () => {
    // Arrange
    const note1Result = await service.createNote({
      workspaceId,
      title: 'Task 1',
      content: 'Content 1',
    });

    expect(note1Result.ok).toBe(true);
    if (!note1Result.ok) return;

    const note1 = note1Result.data;

    // Act - try to remove dependency from note with no dependencies
    const result = await service.removeDependency(workspaceId, note1.id, 'nonexistent' as any);

    // Assert
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('not found');
    }
  });
});
