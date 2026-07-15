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

  describe('readGitConfig', () => {
    it('should call git.getConfig when workspaceId provided', async () => {
      const testConfig = '[remote "origin"]\n    url = git@github.com:test/repo.git';

      mockBackendClient.request.mockResolvedValue({ config: testConfig });

      const result = await repository.readGitConfig('/path/to/repo', 'ws-123' as any);

      expect(mockBackendClient.request).toHaveBeenCalledWith('git.getConfig', {
        workspaceId: 'ws-123',
      });
      expect(result).toEqual(testConfig);
    });

    it('should return empty string when config not in response', async () => {
      mockBackendClient.request.mockResolvedValue({});

      const result = await repository.readGitConfig('/path/to/repo', 'ws-123' as any);

      expect(result).toBe('');
    });

    it('should not call RPC when workspaceId not provided', async () => {
      // When no workspaceId, the DaemonWorkspaceRepository will not call the backend
      // and will fall back to filesystem (which throws if no .git/config exists)
      await expect(repository.readGitConfig('/path/to/repo')).rejects.toThrow();

      // Should not have called the backend
      expect(mockBackendClient.request).not.toHaveBeenCalled();
    });

    it('should fallback to filesystem when RPC fails', async () => {
      mockBackendClient.request.mockRejectedValue(new Error('RPC failed'));

      // DaemonWorkspaceRepository catches RPC errors and falls back to filesystem
      // (which throws if no .git/config exists)
      await expect(repository.readGitConfig('/path/to/repo', 'ws-123' as any)).rejects.toThrow();
    });
  });

  describe('saveContext', () => {
    it('should call workspace.updateUiContext when workspaceId provided', async () => {
      const testContext = {
        workspaceId: 'ws-123',
        mainContentType: 'file' as const,
        mainContentPath: '/path/to/file.ts',
        lastUpdated: '2026-07-15T00:00:00.000Z',
      };

      mockBackendClient.request.mockResolvedValue({ uiContext: testContext });

      await repository.saveContext('ws-123' as any, testContext);

      expect(mockBackendClient.request).toHaveBeenCalledWith('workspace.updateUiContext', {
        workspaceId: 'ws-123',
        uiContext: testContext,
      });
    });

    it('should round-trip complex context unchanged', async () => {
      const complexContext = {
        workspaceId: 'ws-123',
        mainContentType: 'diff' as const,
        mainContentPath: '/path/to/file.ts',
        diffInfo: {
          additions: 10,
          deletions: 5,
          isStaged: true,
          gitStatus: 'modified',
          changeType: 'modified' as const,
        },
        secondaryContentType: 'terminal' as const,
        secondaryContentId: 'term-1',
        lastUpdated: '2026-07-15T00:00:00.000Z',
      };

      mockBackendClient.request.mockResolvedValue({ uiContext: complexContext });

      await repository.saveContext('ws-123' as any, complexContext);

      expect(mockBackendClient.request).toHaveBeenCalledWith('workspace.updateUiContext', {
        workspaceId: 'ws-123',
        uiContext: complexContext,
      });
    });

    it('should fallback to filesystem when RPC fails', async () => {
      mockBackendClient.request.mockRejectedValue(new Error('RPC failed'));

      const testContext = { workspaceId: 'ws-123', mainContentType: 'file' as const };

      // Mock filesystem fallback
      const mockFsSaveContext = vi.fn().mockResolvedValue(undefined);
      (repository as any).filesystemFallback = {
        saveContext: mockFsSaveContext,
      };

      await repository.saveContext('ws-123' as any, testContext);

      // Should have fallen back to filesystem
      expect(mockFsSaveContext).toHaveBeenCalledWith('ws-123', testContext);
    });
  });

  describe('readContext', () => {
    it('should call workspace.getUiContext when workspaceId provided', async () => {
      const testContext = {
        workspaceId: 'ws-123',
        mainContentType: 'note' as const,
        mainContentId: 'note-123',
        lastUpdated: '2026-07-15T00:00:00.000Z',
      };

      mockBackendClient.request.mockResolvedValue({ uiContext: testContext });

      const result = await repository.readContext('ws-123' as any);

      expect(mockBackendClient.request).toHaveBeenCalledWith('workspace.getUiContext', {
        workspaceId: 'ws-123',
      });
      expect(result).toEqual(testContext);
    });

    it('should return null when daemon returns null (no coercion)', async () => {
      mockBackendClient.request.mockResolvedValue({ uiContext: null });

      // Mock filesystem fallback to return null (no FS context)
      const mockFsReadContext = vi.fn().mockResolvedValue(null);
      (repository as any).filesystemFallback = {
        readContext: mockFsReadContext,
      };

      const result = await repository.readContext('ws-123' as any);

      // Should have checked filesystem for migration but found nothing
      expect(mockFsReadContext).toHaveBeenCalledWith('ws-123');
      expect(result).toBeNull();
    });

    it('should return null when daemon returns undefined', async () => {
      mockBackendClient.request.mockResolvedValue({});

      // Mock filesystem fallback to return null (no FS context)
      const mockFsReadContext = vi.fn().mockResolvedValue(null);
      (repository as any).filesystemFallback = {
        readContext: mockFsReadContext,
      };

      const result = await repository.readContext('ws-123' as any);

      // Should have checked filesystem for migration but found nothing
      expect(mockFsReadContext).toHaveBeenCalledWith('ws-123');
      expect(result).toBeNull();
    });

    it('should perform one-time migration from filesystem to daemon', async () => {
      const fsContext = {
        workspaceId: 'ws-123',
        mainContentType: 'file' as const,
        mainContentPath: '/legacy/file.ts',
        lastUpdated: '2026-07-14T00:00:00.000Z',
      };

      // First call: daemon returns null (no context stored)
      // Second call: migration write-through
      mockBackendClient.request
        .mockResolvedValueOnce({ uiContext: null })
        .mockResolvedValueOnce({ uiContext: fsContext });

      // Mock filesystem fallback to return FS context
      const mockFsReadContext = vi.fn().mockResolvedValue(fsContext);
      (repository as any).filesystemFallback = {
        readContext: mockFsReadContext,
        saveContext: vi.fn(),
        readGitConfig: vi.fn(),
      };

      const result = await repository.readContext('ws-123' as any);

      // Should have called daemon getUiContext
      expect(mockBackendClient.request).toHaveBeenNthCalledWith(1, 'workspace.getUiContext', {
        workspaceId: 'ws-123',
      });

      // Should have read from filesystem fallback
      expect(mockFsReadContext).toHaveBeenCalledWith('ws-123');

      // Should have migrated to daemon with updateUiContext
      expect(mockBackendClient.request).toHaveBeenNthCalledWith(2, 'workspace.updateUiContext', {
        workspaceId: 'ws-123',
        uiContext: fsContext,
      });

      // Should return the FS context
      expect(result).toEqual(fsContext);
    });

    it('should not migrate if daemon already has context', async () => {
      const daemonContext = {
        workspaceId: 'ws-123',
        mainContentType: 'file' as const,
        mainContentPath: '/daemon/file.ts',
        lastUpdated: '2026-07-15T00:00:00.000Z',
      };

      mockBackendClient.request.mockResolvedValue({ uiContext: daemonContext });

      const result = await repository.readContext('ws-123' as any);

      // Should only call getUiContext, not updateUiContext
      expect(mockBackendClient.request).toHaveBeenCalledTimes(1);
      expect(mockBackendClient.request).toHaveBeenCalledWith('workspace.getUiContext', {
        workspaceId: 'ws-123',
      });

      expect(result).toEqual(daemonContext);
    });

    it('should return FS context if migration write-through fails', async () => {
      const fsContext = {
        workspaceId: 'ws-123',
        mainContentType: 'file' as const,
        lastUpdated: '2026-07-14T00:00:00.000Z',
      };

      // First call: daemon returns null
      // Second call: migration fails
      mockBackendClient.request
        .mockResolvedValueOnce({ uiContext: null })
        .mockRejectedValueOnce(new Error('Migration failed'));

      const mockFsReadContext = vi.fn().mockResolvedValue(fsContext);
      (repository as any).filesystemFallback = {
        readContext: mockFsReadContext,
      };

      const result = await repository.readContext('ws-123' as any);

      // Should still return FS context even though migration failed
      expect(result).toEqual(fsContext);
    });

    it('should fallback to filesystem when RPC fails', async () => {
      mockBackendClient.request.mockRejectedValue(new Error('RPC failed'));

      const fsContext = { workspaceId: 'ws-123', mainContentType: 'file' as const };

      // Mock filesystem fallback to return context
      const mockFsReadContext = vi.fn().mockResolvedValue(fsContext);
      (repository as any).filesystemFallback = {
        readContext: mockFsReadContext,
      };

      const result = await repository.readContext('ws-123' as any);

      // Should have fallen back to filesystem
      expect(mockFsReadContext).toHaveBeenCalledWith('ws-123');
      expect(result).toEqual(fsContext);
    });
  });
});
