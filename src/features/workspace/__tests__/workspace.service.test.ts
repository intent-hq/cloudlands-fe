/**
 * Tests for Workspace Service
 */

import {
  describe,
  it,
  expect,
  beforeEach,
  vi,
  afterEach,
} from 'vitest';
import { WorkspaceService } from '../main/workspace.service';
import { InMemoryWorkspaceRepository } from '../main/workspace.repository';

import { mainDispatch } from '../../../store/main/redux-store-bridge';
import {
  workspaceCreated,
  workspaceUpdated,
  workspaceDeleted,
  workspaceArchived,
} from '../../../store/main/slices/workspace-lifecycle-events/workspace-lifecycle-events-slice';
import { CHIEF_WORKSPACE_ID } from '../../../shared/types/branded-ids';
import { type Workspace, WorkspaceStatus } from '../../../shared/types';
import { Logger } from '../../../shared/logger';

// Mock mainDispatch
vi.mock('../../../store/main/redux-store-bridge', () => ({
  mainDispatch: vi.fn((action: any) => action),
}));

const mockedMainDispatch = mainDispatch as ReturnType<typeof vi.fn>;

// Mock child_process first
vi.mock('child_process', () => {
  const mockExecFile = vi.fn((cmd: string, args: string[], options?: any, callback?: any) => {
    // Handle both callback and options+callback forms
    const cb = typeof options === 'function' ? options : callback;

    // If no callback is provided, return undefined (for promisified version)
    if (!cb) {
      // This shouldn't happen with our promisify mock
      return;
    }

    // Mock git commands
    if (cmd === 'git') {
      // Use setTimeout to make it async
      setTimeout(() => {
        if (args[0] === 'branch' && args[1] === '--list') {
          // Branch doesn't exist
          cb(null, '', '');
        } else if (args[0] === 'worktree' && args[1] === 'add') {
          // Successfully create worktree
          cb(null, '', '');
        } else if (args[0] === 'rev-parse') {
          if (args[1] === 'HEAD') {
            // Return a mock commit SHA
            cb(null, 'abc123def456\n', '');
          } else if (args[1] === '--verify') {
            // Verify ref exists
            cb(null, 'abc123def456\n', '');
          } else {
            cb(null, '', '');
          }
        } else if (args[0] === 'worktree' && args[1] === 'remove') {
          // Successfully remove worktree
          cb(null, '', '');
        } else if (args[0] === 'gc' && args[1] === '--aggressive') {
          // Git gc
          cb(null, '', '');
        } else {
          cb(null, '', '');
        }
      }, 0);
    } else {
      setTimeout(() => cb(new Error('Command not found'), '', ''), 0);
    }
  });

  const mockExec = vi.fn((cmd: string, options?: any, callback?: any) => {
    const cb = typeof options === 'function' ? options : callback;
    if (cb) {
      setTimeout(() => cb(null, '', ''), 0);
    }
  });

  return {
    default: {
      exec: mockExec,
      execFile: mockExecFile,
    },
    exec: mockExec,
    execFile: mockExecFile,
  };
});

// Mock util.promisify - must be after child_process mock
vi.mock('util', async () => {
  const actual = await vi.importActual('util');
  const childProcess = await import('child_process');

  return {
    ...actual,
    promisify: (fn: any) => {
      // Special handling for execFile and exec
      if (fn === childProcess.execFile || fn === childProcess.exec) {
        return (...args: any[]) =>
          new Promise((resolve, reject) => {
            // Call the function with a callback
            const callback = (err: any, stdout: any, stderr: any) => {
              if (err) {
                reject(err);
              } else {
                resolve({ stdout: stdout || '', stderr: stderr || '' });
              }
            };

            // Add callback to the arguments
            fn(...args, callback);
          });
      }
      // For other functions, use the actual promisify
      return actual.promisify(fn);
    },
  };
});

describe('WorkspaceService', () => {
  let service: WorkspaceService;
  let workspaceRepository: InMemoryWorkspaceRepository;

  async function saveBackingWorkspace(
    workspaceId: Workspace['id'],
    patch: Partial<Workspace>,
  ): Promise<void> {
    const backingWorkspace = await workspaceRepository.findById(workspaceId);
    expect(backingWorkspace).not.toBeNull();
    if (!backingWorkspace) return;

    await workspaceRepository.save({
      ...backingWorkspace,
      ...patch,
      id: workspaceId,
    });
  }

  beforeEach(() => {
    workspaceRepository = new InMemoryWorkspaceRepository();

    // Mock readGitConfig to return a sample git config
    vi.spyOn(workspaceRepository, 'readGitConfig').mockResolvedValue(`
[core]
    repositoryformatversion = 0
[remote "origin"]
    url = https://github.com/test/repo.git
    fetch = +refs/heads/*:refs/remotes/origin/*
`);

    service = new WorkspaceService(workspaceRepository);
  });

  afterEach(() => {
    service.cleanup();
    vi.clearAllMocks();
    mockedMainDispatch.mockClear();
  });

  describe('createWorkspace', () => {
    it('should create a workspace with title', async () => {
      const result = await service.createWorkspace({
        title: 'Test Workspace',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.title).toBe('Test Workspace');
        expect(result.data.id).toBeDefined();
        expect(result.data.status).toBe('Active');
        expect(result.data.branch).toMatch(/^workspace-/);
      }
    });

    it('should create a workspace with repository path', async () => {
      const result = await service.createWorkspace({
        title: 'Test Workspace',
        repositoryPath: '/path/to/repo',
      });

      if (!result.ok) {
        console.error('Test failed with error:', result.error);
      }
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.repositoryPath).toBe('/path/to/repo');
      }
    });

    it('should create a workspace with custom branch', async () => {
      const result = await service.createWorkspace({
        title: 'Test Workspace',
        branch: 'feature/test',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.branch).toBe('feature/test');
      }
    });

    it('should apply branch prefix when configured', async () => {
      // Mock the app-settings service to return a prefix
      const appSettingsModule = await import('../main/app-settings.service');
      const mockGetBranchPrefix = vi.spyOn(appSettingsModule, 'getBranchPrefix');
      mockGetBranchPrefix.mockReturnValue('feature/');

      const result = await service.createWorkspace({
        title: 'Test With Prefix',
        repositoryPath: '/path/to/repo',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        // Branch should start with the prefix
        expect(result.data.branch).toMatch(/^feature\//);
      }

      mockGetBranchPrefix.mockRestore();
    });

    it('should not apply prefix when branch prefix is empty', async () => {
      // Mock the app-settings service to return empty prefix
      const appSettingsModule = await import('../main/app-settings.service');
      const mockGetBranchPrefix = vi.spyOn(appSettingsModule, 'getBranchPrefix');
      mockGetBranchPrefix.mockReturnValue('');

      const result = await service.createWorkspace({
        title: 'Test Without Prefix',
        repositoryPath: '/path/to/repo',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        // Branch should NOT start with 'feature/' - it should be the workspace ID
        expect(result.data.branch).not.toMatch(/^feature\//);
      }

      mockGetBranchPrefix.mockRestore();
    });

    it('should emit workspace:created event', async () => {
      const result = await service.createWorkspace({
        title: 'Test Workspace',
      });

      expect(result.ok).toBe(true);
      expect(mockedMainDispatch).toHaveBeenCalledWith(
        workspaceCreated(
          expect.objectContaining({
            workspaceId: expect.any(String),
            workspace: expect.objectContaining({
              title: 'Test Workspace',
            }),
          }),
        ),
      );
    });

    it('should create workspace in skipWorktree mode', async () => {
      const result = await service.createWorkspace({
        title: 'Test Workspace Skip Worktree',
        repositoryPath: '/path/to/repo',
        skipWorktree: true,
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.skipWorktree).toBe(true);
        expect(result.data.worktreePath).toBe('/path/to/repo');
        expect(result.data.repositoryPath).toBe('/path/to/repo');
      }
    });

    it('should create workspace with worktree when skipWorktree is false', async () => {
      const result = await service.createWorkspace({
        title: 'Test Workspace With Worktree',
        repositoryPath: '/path/to/repo',
        skipWorktree: false,
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.skipWorktree).toBe(false);
        // worktreePath should be different from repositoryPath when worktree is created
        expect(result.data.worktreePath).not.toBe('/path/to/repo');
      }
    });

    it('should create workspace with worktree when skipWorktree is undefined', async () => {
      const result = await service.createWorkspace({
        title: 'Test Workspace Default',
        repositoryPath: '/path/to/repo',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.skipWorktree).toBeUndefined();
        // worktreePath should be different from repositoryPath when worktree is created
        expect(result.data.worktreePath).not.toBe('/path/to/repo');
      }
    });

    it('should store scope when provided', async () => {
      const result = await service.createWorkspace({
        title: 'Test Scoped Workspace',
        repositoryPath: '/path/to/repo/apps/web',
        scope: 'apps/web',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.scope).toBe('apps/web');
        // repositoryPath should be the effective path (parent git root)
        expect(result.data.repositoryPath).toBeDefined();
      }
    });

    it('should not store scope when scope is "."', async () => {
      const result = await service.createWorkspace({
        title: 'Test Workspace',
        repositoryPath: '/path/to/repo',
        scope: '.',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.scope).toBeUndefined();
      }
    });

    it('should not store scope when scope is undefined', async () => {
      const result = await service.createWorkspace({
        title: 'Test Workspace',
        repositoryPath: '/path/to/repo',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.scope).toBeUndefined();
      }
    });
  });

  describe('listWorkspaces', () => {
    it('should return empty array when no workspaces', async () => {
      const result = await service.listWorkspaces();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.workspaces).toEqual([]);
        expect(result.data.total).toBe(0);
        expect(result.data.hasMore).toBe(false);
      }
    });

    it('should return all workspaces', async () => {
      await service.createWorkspace({ title: 'Workspace 1' });
      await service.createWorkspace({ title: 'Workspace 2' });

      const result = await service.listWorkspaces();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.workspaces).toHaveLength(2);
        expect(result.data.total).toBe(2);
        expect(result.data.workspaces.map((w) => w.title)).toContain('Workspace 1');
        expect(result.data.workspaces.map((w) => w.title)).toContain('Workspace 2');
      }
    });

    it('should list multiple workspaces', async () => {
      const ws1 = await service.createWorkspace({ title: 'Workspace 1' });
      const ws2 = await service.createWorkspace({ title: 'Workspace 2' });

      const result = await service.listWorkspaces();

      expect(result.ok).toBe(true);
      if (result.ok && ws1.ok && ws2.ok) {
        const ids = result.data.workspaces.map((w) => w.id);
        expect(ids).toContain(ws1.data.id);
        expect(ids).toContain(ws2.data.id);
      }
    });

    it('should keep the default list path lite and schedule background enrichment', async () => {
      await service.createWorkspace({ title: 'Workspace 1', repositoryPath: '/path/to/repo' });

      const buildListWorkspaceSpy = vi.spyOn(service as any, 'buildListWorkspace');
      const scheduleBackgroundEnrichmentSpy = vi
        .spyOn(service as any, 'scheduleBackgroundEnrichment')
        .mockImplementation(() => {});

      const result = await service.listWorkspaces();

      expect(result.ok).toBe(true);
      expect(buildListWorkspaceSpy).not.toHaveBeenCalled();
      expect(scheduleBackgroundEnrichmentSpy).toHaveBeenCalledTimes(1);
      if (result.ok) {
        expect(result.data.workspaces[0]?.taskStats).toBeUndefined();
        expect(result.data.workspaces[0]?.gitSummary).toBeUndefined();
      }
    });

    it('should only build list summaries when explicitly requested', async () => {
      await service.createWorkspace({ title: 'Workspace 1', repositoryPath: '/path/to/repo' });

      vi.spyOn(service as any, 'scheduleBackgroundEnrichment').mockImplementation(() => {});

      const buildListWorkspacesWithConcurrencySpy = vi.spyOn(
        service as any,
        'buildListWorkspacesWithConcurrency',
      );

      const result = await service.listWorkspaces({ lite: false });

      expect(result.ok).toBe(true);
      expect(buildListWorkspacesWithConcurrencySpy).toHaveBeenCalledTimes(1);
    });

    it('should read fresh backing repository state on consecutive list calls', async () => {
      const created = await service.createWorkspace({ title: 'Original List Title' });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      const firstList = await service.listWorkspaces();
      expect(firstList.ok).toBe(true);

      await saveBackingWorkspace(created.data.id, { title: 'External List Title' });

      const secondList = await service.listWorkspaces();

      expect(secondList.ok).toBe(true);
      if (secondList.ok) {
        expect(secondList.data.workspaces.find((w) => w.id === created.data.id)?.title).toBe(
          'External List Title',
        );
      }
    });
  });

  describe('getWorkspace', () => {
    it('should return the synthetic chief workspace without repository lookup', async () => {
      const findByIdSpy = vi.spyOn(workspaceRepository, 'findById');

      const result = await service.getWorkspace(CHIEF_WORKSPACE_ID);

      expect(result.ok).toBe(true);
      expect(findByIdSpy).not.toHaveBeenCalled();
      if (result.ok) {
        expect(result.data.id).toBe(CHIEF_WORKSPACE_ID);
        expect(result.data.title).toBe('Chief of Staff');
        expect(result.data.repositoryPath).toBeUndefined();
        expect(result.data.worktreePath).toBeUndefined();
      }
    });

    it('should get workspace by id', async () => {
      const created = await service.createWorkspace({ title: 'Test Workspace' });

      expect(created.ok).toBe(true);
      if (!created.ok) return;

      const result = await service.getWorkspace(created.data.id);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.id).toBe(created.data.id);
        expect(result.data.title).toBe('Test Workspace');
      }
    });

    it('should read fresh backing repository state on consecutive get calls', async () => {
      const created = await service.createWorkspace({ title: 'Original Title' });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      const firstResult = await service.getWorkspace(created.data.id);
      expect(firstResult.ok).toBe(true);
      if (firstResult.ok) {
        expect(firstResult.data.title).toBe('Original Title');
      }

      await saveBackingWorkspace(created.data.id, { title: 'External Title' });

      const secondResult = await service.getWorkspace(created.data.id);

      expect(secondResult.ok).toBe(true);
      if (secondResult.ok) {
        expect(secondResult.data.title).toBe('External Title');
      }
    });

    it('should return error for non-existent workspace', async () => {
      // Use a valid UUID format that doesn't exist
      const result = await service.getWorkspace('00000000-0000-0000-0000-000000000000');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain('not found');
      }
    });
  });

  describe('updateWorkspace', () => {
    it('should update workspace title', async () => {
      const created = await service.createWorkspace({ title: 'Original Title' });

      expect(created.ok).toBe(true);
      if (!created.ok) return;

      const result = await service.updateWorkspace({
        id: created.data.id,
        title: 'Updated Title',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.title).toBe('Updated Title');
      }
    });

    it('should emit workspace:updated event', async () => {
      const created = await service.createWorkspace({ title: 'Original Title' });

      expect(created.ok).toBe(true);
      if (!created.ok) return;

      await service.updateWorkspace({
        id: created.data.id,
        title: 'Updated Title',
      });

      expect(mockedMainDispatch).toHaveBeenCalledWith(
        workspaceUpdated(
          expect.objectContaining({
            workspaceId: created.data.id,
            changes: expect.objectContaining({
              title: 'Updated Title',
            }),
          }),
        ),
      );
    });

    it('should return error for non-existent workspace', async () => {
      const result = await service.updateWorkspace({
        id: '00000000-0000-0000-0000-000000000000',
        title: 'Updated Title',
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain('not found');
      }
    });

    it('should merge updates with fresh backing repository state', async () => {
      const created = await service.createWorkspace({ title: 'Original Title' });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      await service.getWorkspace(created.data.id);
      await saveBackingWorkspace(created.data.id, { branch: 'external-branch' });

      const result = await service.updateWorkspace({
        id: created.data.id,
        title: 'Updated Title',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.title).toBe('Updated Title');
        expect(result.data.branch).toBe('external-branch');
      }
    });

    it('should preserve backing changes that land after the initial update read', async () => {
      const created = await service.createWorkspace({ title: 'Original Title' });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      await saveBackingWorkspace(created.data.id, { lastActivity: created.data.createdAt });

      const originalFindById = workspaceRepository.findById.bind(workspaceRepository);
      const originalSave = workspaceRepository.save.bind(workspaceRepository);
      let injectedConcurrentChange = false;
      const findByIdSpy = vi.spyOn(workspaceRepository, 'findById').mockImplementation(async (id) => {
        const workspace = await originalFindById(id);
        if (id === created.data.id && workspace && !injectedConcurrentChange) {
          injectedConcurrentChange = true;
          await originalSave({
            ...workspace,
            branch: 'concurrent-branch-change',
            prUrl: 'https://github.com/test/repo/pull/1',
          });
        }
        return workspace;
      });

      try {
        const result = await service.updateWorkspace({
          id: created.data.id,
          title: 'Updated Title',
        });

        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.data.title).toBe('Updated Title');
          expect(result.data.branch).toBe('concurrent-branch-change');
          expect(result.data.prUrl).toBe('https://github.com/test/repo/pull/1');
        }

        const persisted = await originalFindById(created.data.id);
        expect(persisted?.title).toBe('Updated Title');
        expect(persisted?.branch).toBe('concurrent-branch-change');
        expect(persisted?.prUrl).toBe('https://github.com/test/repo/pull/1');
      } finally {
        findByIdSpy.mockRestore();
      }
    });
  });

  describe('deleteWorkspace', () => {
    it('should delete workspace', async () => {
      const created = await service.createWorkspace({ title: 'Test Workspace' });

      expect(created.ok).toBe(true);
      if (!created.ok) return;

      const result = await service.deleteWorkspace(created.data.id);

      expect(result.ok).toBe(true);

      // Verify workspace is deleted
      const getResult = await service.getWorkspace(created.data.id);
      expect(getResult.ok).toBe(false);
    });

    it('should emit workspace:deleted event', async () => {
      const created = await service.createWorkspace({ title: 'Test Workspace' });

      expect(created.ok).toBe(true);
      if (!created.ok) return;

      await service.deleteWorkspace(created.data.id);

      expect(mockedMainDispatch).toHaveBeenCalledWith(
        workspaceDeleted(
          expect.objectContaining({
            workspaceId: created.data.id,
          }),
        ),
      );
    });

    it('should delete workspace in skipWorktree mode without removing repository', async () => {
      const created = await service.createWorkspace({
        title: 'Test Workspace Skip Worktree',
        repositoryPath: '/path/to/repo',
        skipWorktree: true,
      });

      expect(created.ok).toBe(true);
      if (!created.ok) return;

      // Local git-worktree removal is now owned by the daemon
      // (`workspace.delete`, PROTOCOL.md §5.1); the FE has no local
      // `removeGitWorktree` to spy on. Assert that `workspace.delete` still
      // fires and the workspace is gone from the FE view.
      const result = await service.deleteWorkspace(created.data.id);

      expect(result.ok).toBe(true);

      const getResult = await service.getWorkspace(created.data.id);
      expect(getResult.ok).toBe(false);
    });
  });

  describe('archiveWorkspace', () => {
    it('should archive workspace', async () => {
      const created = await service.createWorkspace({ title: 'Test Workspace' });

      expect(created.ok).toBe(true);
      if (!created.ok) return;

      const result = await service.archiveWorkspace(created.data.id);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.archived).toBe(true);
      }
    });

    it('should archive fresh backing repository state', async () => {
      const created = await service.createWorkspace({ title: 'Original Archive Title' });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      await service.getWorkspace(created.data.id);
      await saveBackingWorkspace(created.data.id, { title: 'External Archive Title' });

      const result = await service.archiveWorkspace(created.data.id);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.title).toBe('External Archive Title');
        expect(result.data.archived).toBe(true);
        expect(result.data.status).toBe(WorkspaceStatus.Archived);
      }
    });

    it('should emit workspace:archived event', async () => {
      const created = await service.createWorkspace({ title: 'Test Workspace' });

      expect(created.ok).toBe(true);
      if (!created.ok) return;

      await service.archiveWorkspace(created.data.id);

      expect(mockedMainDispatch).toHaveBeenCalledWith(
        workspaceArchived(
          expect.objectContaining({
            workspaceId: created.data.id,
          }),
        ),
      );
    });
  });

  describe('getGitRepoInfo', () => {
    let warnSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      warnSpy = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
      warnSpy.mockRestore();
    });

    it('returns {} without warning when git config is empty', async () => {
      vi.spyOn(workspaceRepository, 'readGitConfig').mockResolvedValue('');

      const result = await (service as any).getGitRepoInfo('/tmp/no-remote-repo');

      expect(result).toEqual({});
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it('returns {} without warning when git config is null or undefined', async () => {
      for (const value of [null, undefined]) {
        vi.spyOn(workspaceRepository, 'readGitConfig').mockResolvedValue(value as any);

        const result = await (service as any).getGitRepoInfo('/tmp/no-config-repo');

        expect(result).toEqual({});
        expect(warnSpy).not.toHaveBeenCalled();
      }
    });

    it('warns when git config content is a non-string contract violation', async () => {
      vi.spyOn(workspaceRepository, 'readGitConfig').mockResolvedValue(123 as any);

      const result = await (service as any).getGitRepoInfo('/tmp/bad-config-repo');

      expect(result).toEqual({});
      expect(warnSpy).toHaveBeenCalledWith(
        'Invalid git config content',
        expect.objectContaining({ type: 'number' }),
      );
    });

    it('warns for falsy non-string config content (e.g. false)', async () => {
      vi.spyOn(workspaceRepository, 'readGitConfig').mockResolvedValue(false as any);

      const result = await (service as any).getGitRepoInfo('/tmp/bad-config-repo');

      expect(result).toEqual({});
      expect(warnSpy).toHaveBeenCalledWith(
        'Invalid git config content',
        expect.objectContaining({ type: 'boolean' }),
      );
    });
  });

  describe('unarchiveWorkspace', () => {
    it('should unarchive fresh backing repository state', async () => {
      const created = await service.createWorkspace({ title: 'Original Unarchive Title' });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      await service.getWorkspace(created.data.id);
      await saveBackingWorkspace(created.data.id, {
        title: 'External Unarchive Title',
        status: WorkspaceStatus.Archived,
        archived: true,
        archivedAt: '2026-06-09T00:00:00.000Z',
      });

      const result = await service.unarchiveWorkspace(created.data.id);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.title).toBe('External Unarchive Title');
        expect(result.data.archived).toBe(false);
        expect(result.data.status).toBe(WorkspaceStatus.Active);
      }
    });
  });
});
