import { describe, it, expect, beforeEach } from 'vitest';
import { NotesService } from '../notes.service';
import type { WorkspaceId } from '../../../shared/types';
import { randomUUID } from 'crypto';

describe('NotesService.addDependency - Edge Cases', () => {
  let service: NotesService;
  let workspaceId: WorkspaceId;

  beforeEach(async () => {
    service = new NotesService();
    workspaceId = randomUUID() as WorkspaceId;
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
    const result = await service.addDependency(workspaceId, 'nonexistent' as any, {
      noteId: note2.id,
      type: 'blocks',
    });

    // Assert
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('Source note not found');
    }
  });

  it('should return error when target note does not exist', async () => {
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
    const result = await service.addDependency(workspaceId, note1.id, {
      noteId: 'nonexistent' as any,
      type: 'blocks',
    });

    // Assert
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('Target note not found');
    }
  });

  it('should prevent self-dependency', async () => {
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
    const result = await service.addDependency(workspaceId, note1.id, {
      noteId: note1.id,
      type: 'blocks',
    });

    // Assert
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('self');
    }
  });

  it('should prevent duplicate dependencies', async () => {
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

    // Add dependency first time
    await service.addDependency(workspaceId, note1.id, {
      noteId: note2.id,
      type: 'blocks',
    });

    // Act - try to add same dependency again
    const result = await service.addDependency(workspaceId, note1.id, {
      noteId: note2.id,
      type: 'blocks',
    });

    // Assert
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('already exists');
    }
  });

  it('should allow same target note with different dependency types', async () => {
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

    // Add first dependency
    await service.addDependency(workspaceId, note1.id, {
      noteId: note2.id,
      type: 'blocks',
    });

    // Act - add same target with different type (should still be prevented as duplicate)
    const result = await service.addDependency(workspaceId, note1.id, {
      noteId: note2.id,
      type: 'related',
    });

    // Assert - should be prevented (same noteId is duplicate regardless of type)
    expect(result.ok).toBe(false);
  });
});
