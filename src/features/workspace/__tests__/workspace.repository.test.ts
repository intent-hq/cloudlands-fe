/**
 * Tests for Workspace Repository
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryWorkspaceRepository } from '../main/workspace.repository';
import type { Workspace } from '../../../shared/types';
import { WorkspaceStatus } from '../../../shared/types';

import { randomUUID } from 'crypto';

describe('InMemoryWorkspaceRepository', () => {
  let repository: InMemoryWorkspaceRepository;

  beforeEach(() => {
    repository = new InMemoryWorkspaceRepository();
  });

  // Helper function to create test workspace
  const createTestWorkspace = (overrides?: Partial<Workspace>): Workspace => ({
    id: randomUUID(),
    title: 'Test Workspace',
    branch: 'main',
    changesets: [],
    timeline: [],
    conversationInfo: [],
    status: WorkspaceStatus.Active,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  });

  describe('save and findById', () => {
    it('should save and retrieve a workspace', async () => {
      const workspace = createTestWorkspace();

      await repository.save(workspace);
      const retrieved = await repository.findById(workspace.id);

      expect(retrieved).toEqual(workspace);
    });

    it('should return null for non-existent workspace', async () => {
      const result = await repository.findById(randomUUID());
      expect(result).toBeNull();
    });

    it('should update existing workspace', async () => {
      const workspace = createTestWorkspace({ title: 'Original Title' });

      await repository.save(workspace);

      const updated = { ...workspace, title: 'Updated Title' };
      await repository.save(updated);

      const retrieved = await repository.findById(workspace.id);
      expect(retrieved?.title).toBe('Updated Title');
    });
  });

  describe('findAll', () => {
    it('should return empty array when no workspaces', async () => {
      const workspaces = await repository.findAll();
      expect(workspaces).toEqual([]);
    });

    it('should return all workspaces', async () => {
      const workspace1 = createTestWorkspace({ title: 'Workspace 1' });
      const workspace2 = createTestWorkspace({ title: 'Workspace 2' });

      await repository.save(workspace1);
      await repository.save(workspace2);

      const workspaces = await repository.findAll();
      expect(workspaces).toHaveLength(2);
      expect(workspaces.map((w) => w.id)).toContain(workspace1.id);
      expect(workspaces.map((w) => w.id)).toContain(workspace2.id);
    });
  });

  describe('delete', () => {
    it('should delete a workspace', async () => {
      const workspace = createTestWorkspace();

      await repository.save(workspace);
      await repository.delete(workspace.id);

      const retrieved = await repository.findById(workspace.id);
      expect(retrieved).toBeNull();
    });

    it('should throw when deleting non-existent workspace', async () => {
      await expect(repository.delete(randomUUID())).rejects.toThrow('not found');
    });
  });

  describe('exists', () => {
    it('should return true for existing workspace', async () => {
      const workspace = createTestWorkspace();

      await repository.save(workspace);
      const exists = await repository.exists(workspace.id);
      expect(exists).toBe(true);
    });

    it('should return false for non-existent workspace', async () => {
      const exists = await repository.exists(randomUUID());
      expect(exists).toBe(false);
    });
  });

  describe('count', () => {
    it('should return 0 when no workspaces', () => {
      expect(repository.count()).toBe(0);
    });

    it('should return correct count', async () => {
      const workspace1 = createTestWorkspace({ title: 'Workspace 1' });
      const workspace2 = createTestWorkspace({ title: 'Workspace 2' });

      await repository.save(workspace1);
      expect(repository.count()).toBe(1);

      await repository.save(workspace2);
      expect(repository.count()).toBe(2);

      await repository.delete(workspace1.id);
      expect(repository.count()).toBe(1);
    });
  });

  describe('clear', () => {
    it('should remove all workspaces', async () => {
      const workspace1 = createTestWorkspace({ title: 'Workspace 1' });
      const workspace2 = createTestWorkspace({ title: 'Workspace 2' });

      await repository.save(workspace1);
      await repository.save(workspace2);

      repository.clear();

      expect(repository.count()).toBe(0);
      const workspaces = await repository.findAll();
      expect(workspaces).toEqual([]);
    });
  });
});
