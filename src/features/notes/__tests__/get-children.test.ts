import {
  describe,
  it,
  expect,
  beforeEach,
} from 'vitest';
import { NotesService } from '../notes.service';
import type { WorkspaceId } from '../../../shared/types';
import { randomUUID } from 'crypto';

/**
 * Tests for NotesService.getChildren
 *
 * The task orchestration system now uses parentId (sidebar hierarchy) as the dependency graph.
 * getChildren() returns all notes that have the given note as their parent.
 * This replaces the old getDependents() which scanned metadata.dependencies.
 */
describe('NotesService.getChildren', () => {
  let service: NotesService;
  let workspaceId: WorkspaceId;

  beforeEach(async () => {
    service = new NotesService();
    workspaceId = randomUUID() as WorkspaceId;
  });

  it('should return notes that have the target note as parent', async () => {
    // Arrange - create parent and child notes
    const parentResult = await service.createNote({
      workspaceId,
      title: 'Parent Task',
      content: 'Parent content',
    });

    expect(parentResult.ok).toBe(true);
    if (!parentResult.ok) return;

    const parent = parentResult.data;

    // Create child note with parentId
    const childResult = await service.createNote({
      workspaceId,
      title: 'Child Task',
      content: 'Child content',
      parentId: parent.id,
    });

    expect(childResult.ok).toBe(true);
    if (!childResult.ok) return;

    const child = childResult.data;

    // Act - get children of parent
    const result = await service.getChildren(workspaceId, parent.id);

    // Assert
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toHaveLength(1);
      expect(result.data[0].id).toBe(child.id);
    }
  });

  it('should return multiple children', async () => {
    // Arrange
    const parentResult = await service.createNote({
      workspaceId,
      title: 'Parent Task',
      content: 'Parent content',
    });

    expect(parentResult.ok).toBe(true);
    if (!parentResult.ok) return;

    const parent = parentResult.data;

    // Create multiple children
    const child1Result = await service.createNote({
      workspaceId,
      title: 'Child 1',
      content: 'Content 1',
      parentId: parent.id,
    });
    const child2Result = await service.createNote({
      workspaceId,
      title: 'Child 2',
      content: 'Content 2',
      parentId: parent.id,
    });

    expect(child1Result.ok && child2Result.ok).toBe(true);
    if (!child1Result.ok || !child2Result.ok) return;

    const child1 = child1Result.data;
    const child2 = child2Result.data;

    // Act - get children of parent
    const result = await service.getChildren(workspaceId, parent.id);

    // Assert
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toHaveLength(2);
      const childIds = result.data.map((c) => c.id);
      expect(childIds).toContain(child1.id);
      expect(childIds).toContain(child2.id);
    }
  });

  it('should return empty array for note with no children', async () => {
    // Arrange
    const noteResult = await service.createNote({
      workspaceId,
      title: 'Leaf Task',
      content: 'No children',
    });

    expect(noteResult.ok).toBe(true);
    if (!noteResult.ok) return;

    const note = noteResult.data;

    // Act - note has no children
    const result = await service.getChildren(workspaceId, note.id);

    // Assert
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toEqual([]);
    }
  });

  it('should only return direct children, not grandchildren', async () => {
    // Arrange - Grandparent -> Parent -> Child
    const grandparentResult = await service.createNote({
      workspaceId,
      title: 'Grandparent',
      content: 'Content',
    });

    expect(grandparentResult.ok).toBe(true);
    if (!grandparentResult.ok) return;

    const grandparent = grandparentResult.data;

    const parentResult = await service.createNote({
      workspaceId,
      title: 'Parent',
      content: 'Content',
      parentId: grandparent.id,
    });

    expect(parentResult.ok).toBe(true);
    if (!parentResult.ok) return;

    const parent = parentResult.data;

    const childResult = await service.createNote({
      workspaceId,
      title: 'Child',
      content: 'Content',
      parentId: parent.id,
    });

    expect(childResult.ok).toBe(true);
    if (!childResult.ok) return;

    // Act - get children of grandparent (should only return parent, not child)
    const result = await service.getChildren(workspaceId, grandparent.id);

    // Assert - only direct children
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toHaveLength(1);
      expect(result.data[0].id).toBe(parent.id);
    }
  });
});
