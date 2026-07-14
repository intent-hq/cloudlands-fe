/**
 * Tests for Workspace Repository
 */

import {
  describe,
  it,
  expect,
  beforeEach,
  vi,
} from 'vitest';
import {
  getChiefWorkspace,
  InMemoryWorkspaceRepository,
  DaemonWorkspaceRepository,
} from '../main/workspace.repository';
import type { Workspace } from '../../../shared/types';
import { WorkspaceStatus } from '../../../shared/types';
import { CHIEF_WORKSPACE_ID } from '../../../shared/types/branded-ids';

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
    it('should return the synthetic chief workspace by fixed id', async () => {
      const chiefWorkspace = await repository.findById(CHIEF_WORKSPACE_ID);

      expect(chiefWorkspace).toEqual(getChiefWorkspace());
      expect(chiefWorkspace?.title).toBe('Chief of Staff');
      expect(chiefWorkspace?.repositoryPath).toBeUndefined();
      expect(chiefWorkspace?.worktreePath).toBeUndefined();
    });

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
    it('should not include the synthetic chief workspace in workspace scans', async () => {
      const workspaces = await repository.findAll();
      expect(workspaces.map((w) => w.id)).not.toContain(CHIEF_WORKSPACE_ID);
    });

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
    it('should return true for the synthetic chief workspace', async () => {
      await expect(repository.exists(CHIEF_WORKSPACE_ID)).resolves.toBe(true);
    });

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

// FileSystemWorkspaceRepository tests removed — workspace metadata is now
// resolved via daemon RPCs (workspace.get / workspace.list, PROTOCOL.md §5.1).
// Tests use InMemoryWorkspaceRepository for isolation.

// Mock the backend client before importing DaemonWorkspaceRepository
vi.mock('../../backend/main/backend.ipc');

describe('DaemonWorkspaceRepository', () => {
  let repository: DaemonWorkspaceRepository;
  let mockBackendClient: { request: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    const { getBackendClient } = await import('../../backend/main/backend.ipc');

    mockBackendClient = { request: vi.fn() };
    vi.mocked(getBackendClient).mockReturnValue(mockBackendClient as any);

    repository = new DaemonWorkspaceRepository();
  });

  describe('findById', () => {
    it('should call workspace.get with correct params and return workspace', async () => {
      const testWorkspace = {
        id: 'ws-test-123',
        title: 'Test Workspace',
        branch: 'main',
        status: WorkspaceStatus.Active,
      };

      mockBackendClient.request.mockResolvedValue({ workspace: testWorkspace });

      const result = await repository.findById('ws-test-123' as any);

      expect(mockBackendClient.request).toHaveBeenCalledWith('workspace.get', {
        workspaceId: 'ws-test-123',
      });
      expect(result).toEqual(testWorkspace);
    });

    it('should return null when workspace not found', async () => {
      mockBackendClient.request.mockResolvedValue({});

      const result = await repository.findById('ws-nonexistent' as any);

      expect(result).toBeNull();
    });
  });

  describe('findAll', () => {
    it('should call workspace.list and return workspaces', async () => {
      const testWorkspaces = [
        { id: 'ws-1', title: 'Workspace 1' },
        { id: 'ws-2', title: 'Workspace 2' },
      ];

      mockBackendClient.request.mockResolvedValue({ workspaces: testWorkspaces });

      const result = await repository.findAll();

      expect(mockBackendClient.request).toHaveBeenCalledWith('workspace.list');
      expect(result).toEqual(testWorkspaces);
    });

    it('should guard against non-array responses', async () => {
      mockBackendClient.request.mockResolvedValue({ workspaces: { notAnArray: true } });

      const result = await repository.findAll();

      expect(result).toEqual([]);
    });

    it('should return empty array on error', async () => {
      mockBackendClient.request.mockRejectedValue(new Error('Connection failed'));

      const result = await repository.findAll();

      expect(result).toEqual([]);
    });
  });

  describe('save', () => {
    it('should call workspace.update with workspace fields', async () => {
      const workspace = {
        id: 'ws-123',
        title: 'Updated Workspace',
        tags: ['tag1'],
        branch: 'feature-branch',
        status: WorkspaceStatus.Active,
      } as Workspace;

      mockBackendClient.request.mockResolvedValue({ workspace });

      await repository.save(workspace);

      expect(mockBackendClient.request).toHaveBeenCalledWith('workspace.update', {
        workspaceId: 'ws-123',
        title: 'Updated Workspace',
        tags: ['tag1'],
        branch: 'feature-branch',
        status: WorkspaceStatus.Active,
      });
    });
  });

  describe('delete', () => {
    it('should call workspace.delete with workspaceId', async () => {
      mockBackendClient.request.mockResolvedValue({ success: true });

      await repository.delete('ws-123' as any);

      expect(mockBackendClient.request).toHaveBeenCalledWith('workspace.delete', {
        workspaceId: 'ws-123',
      });
    });
  });
});
