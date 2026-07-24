/**
 * Tests for workspace, git, and cross-workspace JS API functions.
 * Ported from deleted workspace-management-tools.test.ts, git-tools.test.ts,
 * and cross-workspace-tools.test.ts.
 */

import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
} from 'vitest';

// --- Mocks for workspace API dependencies ---
// Default backend client stub — individual tests may re-`vi.doMock` it after
// `vi.resetModules()` when they need a scoped mockRequest.
vi.mock('$features/backend/main/backend.ipc', () => ({
  getBackendClient: () => ({ request: vi.fn().mockResolvedValue({ ok: true }) }),
}));

vi.mock('$shared/main/config', () => ({
  WorkspaceConfig: { resolveWorkspaceRoot: vi.fn().mockReturnValue('/tmp') },
}));

vi.mock('$shared/constants', () => ({
  getSessionPath: vi.fn().mockReturnValue('/tmp/session.json'),
}));

vi.mock('$features/system/main/system.ipc', () => ({
  sendToWorkspaceWindows: vi.fn(),
}));

vi.mock('$features/events/types', () => ({
  createWorkspaceEvent: vi.fn().mockReturnValue({ id: 'evt-1' }),
  WorkspaceEventType: { AgentRenamed: 'agent:renamed' },
}));

vi.mock('../../../../../store/main/redux-store-bridge', () => ({
  mainDispatch: vi.fn(),
}));

vi.mock('../../../../../store/main/slices/workspace-events/workspace-events-slice', () => ({
  emitWorkspaceEvent: vi.fn().mockReturnValue({ type: 'workspaceEvents/emitWorkspaceEvent', payload: [] }),
}));

vi.mock('$lib/utils/workspace-validation', () => ({
  sanitizeBranchName: (name: string) => name.toLowerCase().replace(/\s+/g, '-'),
}));

// --- Mocks for git API dependencies ---
vi.mock('$features/git/main/git-router', () => ({
  getWorkspaceGitInfo: vi.fn(),
}));

vi.mock('$shared/git/git-env', () => ({
  execFileAsync: vi.fn(),
}));

vi.mock('$features/workspace/main/workspace-settings.service', () => ({
  assertAgentCommitAllowed: vi.fn().mockReturnValue({ allowed: true }),
}));

vi.mock('$features/git/main/background-git-ops.service', () => ({
  backgroundGitOpsService: { agentCommit: vi.fn() },
}));

// --- Mocks for cross-workspace API dependencies ---
vi.mock('$features/notes/main/assets.service', () => ({
  assetsService: {},
}));

vi.mock('$features/terminal/main/terminal.ipc', () => ({
  terminalManager: {},
}));

vi.mock('$features/browser/main/browser.ipc', () => ({
  executeBrowserActions: vi.fn(),
}));

vi.mock('diff', () => ({ default: {} }));

import { buildWorkspaceApi } from '../ws-workspace-api';
import { buildCrossWorkspaceApi } from '../ws-misc-api';
import { WORKSPACE_STATUS_MESSAGE_MAX_LENGTH } from '$shared/types';

// =====================================================================
// Workspace API tests
// =====================================================================
describe('buildWorkspaceApi – details and statusMessage', () => {
  const workspaceId = 'ws-status-test';
  const call = { context: { agentId: 'agent-1' }, name: 'workspace_api', arguments: {} } as any;

  function makeApi(workspaceManager: any) {
    return buildWorkspaceApi({
      workspacePath: '/tmp/test',
      workspaceId,
      workspaceManager,
      call,
    });
  }

  it('returns statusMessage separately from lifecycle status', async () => {
    const api = makeApi({
      getWorkspace: vi.fn().mockResolvedValue({
        id: workspaceId,
        title: 'Status Workspace',
        status: 'Active',
        statusMessage: 'Reviewing the implementation plan.',
        branch: 'status-branch',
        tags: [],
      }),
      updateWorkspace: vi.fn(),
      getCurrentContext: vi.fn(),
    });

    await expect(api.details()).resolves.toMatchObject({
      status: 'Active',
      statusMessage: 'Reviewing the implementation plan.',
    });
  });

  it('updates statusMessage through a dedicated setter', async () => {
    const manager = {
      getWorkspace: vi.fn(),
      updateWorkspace: vi.fn().mockResolvedValue({ ok: true }),
      getCurrentContext: vi.fn(),
    };
    const api = makeApi(manager);

    await expect(api.setStatusMessage('  Building the data model.  ')).resolves.toEqual({
      ok: true,
      statusMessage: 'Building the data model.',
    });
    expect(manager.updateWorkspace).toHaveBeenCalledWith({
      id: workspaceId,
      statusMessage: 'Building the data model.',
    });
  });

  it('rejects overly long statusMessage values', async () => {
    const api = makeApi({
      getWorkspace: vi.fn(),
      updateWorkspace: vi.fn(),
      getCurrentContext: vi.fn(),
    });

    await expect(
      api.setStatusMessage('x'.repeat(WORKSPACE_STATUS_MESSAGE_MAX_LENGTH + 1)),
    ).rejects.toThrow(`${WORKSPACE_STATUS_MESSAGE_MAX_LENGTH} characters or fewer`);
  });
});

describe('buildWorkspaceApi – setTitle', () => {
  const workspaceId = 'ws-123';
  const call = { context: { agentId: 'agent-1' }, name: 'workspace_api', arguments: {} } as any;

  function makeApi(workspaceManager: any) {
    return buildWorkspaceApi({
      workspacePath: '/tmp/test',
      workspaceId,
      workspaceManager,
      call,
    });
  }

  it('allows rename when workspace has no title', async () => {
    const manager = {
      getWorkspace: vi.fn().mockResolvedValue({ id: workspaceId, title: '', branch: null }),
      updateWorkspace: vi.fn().mockResolvedValue({ ok: true }),
      getCurrentContext: vi.fn(),
    };
    const api = makeApi(manager);
    const result = await api.setTitle('My Project');
    expect(result.ok).toBe(true);
    expect(result.title).toBe('My Project');
    expect(result.skipped).toBeUndefined();
    expect(manager.updateWorkspace).toHaveBeenCalled();
  });

  it('allows rename when title matches workspace ID', async () => {
    const manager = {
      getWorkspace: vi.fn().mockResolvedValue({ id: workspaceId, title: workspaceId, branch: 'old' }),
      updateWorkspace: vi.fn().mockResolvedValue({ ok: true }),
      getCurrentContext: vi.fn(),
    };
    const api = makeApi(manager);
    const result = await api.setTitle('New Title');
    expect(result.ok).toBe(true);
    expect(result.title).toBe('New Title');
  });

  it('skips when custom title already set', async () => {
    const manager = {
      getWorkspace: vi.fn().mockResolvedValue({ id: workspaceId, title: 'Existing Title', branch: 'b' }),
      updateWorkspace: vi.fn(),
      getCurrentContext: vi.fn(),
    };
    const api = makeApi(manager);
    const result = await api.setTitle('Ignored');
    expect(result.skipped).toBe(true);
    expect(result.title).toBe('Existing Title');
    expect(manager.updateWorkspace).not.toHaveBeenCalled();
  });

  it('trims whitespace before comparing', async () => {
    const manager = {
      getWorkspace: vi.fn().mockResolvedValue({ id: workspaceId, title: '  ', branch: null }),
      updateWorkspace: vi.fn().mockResolvedValue({ ok: true }),
      getCurrentContext: vi.fn(),
    };
    const api = makeApi(manager);
    const result = await api.setTitle('  Trimmed  ');
    expect(result.ok).toBe(true);
    expect(result.title).toBe('Trimmed');
  });

  it('throws when title is empty string', async () => {
    const api = makeApi({ getWorkspace: vi.fn(), updateWorkspace: vi.fn(), getCurrentContext: vi.fn() });
    await expect(api.setTitle('')).rejects.toThrow('title is required');
  });
});

// =====================================================================
// Workspace API tests – setAgentName
// =====================================================================
describe('buildWorkspaceApi – setAgentName', () => {
  const workspaceId = 'ws-name-test';
  const agentId = 'agent-name-1';
  const call = { context: { agentId }, name: 'workspace_api', arguments: {} } as any;

  beforeEach(() => {
    vi.resetModules();
  });

  function makeApi(workspaceManager: any) {
    return buildWorkspaceApi({
      workspacePath: '/tmp/test',
      workspaceId,
      workspaceManager,
      call,
    });
  }

  it('sends agent.rename to the daemon and emits a workspace event', async () => {
    const mockRequest = vi
      .fn()
      .mockResolvedValue({ success: true, name: 'My Custom Name' });
    vi.doMock('$features/backend/main/backend.ipc', () => ({
      getBackendClient: () => ({ request: mockRequest }),
    }));

    const { buildWorkspaceApi: freshBuildApi } = await import('../ws-workspace-api');

    const api = freshBuildApi({
      workspacePath: '/tmp/test',
      workspaceId,
      workspaceManager: {},
      call,
    });
    const result = await api.setAgentName('My Custom Name');

    expect(result.ok).toBe(true);
    expect(result.name).toBe('My Custom Name');

    // Direct daemon RPC: guarded agent.rename (PROTOCOL.md §5.5)
    expect(mockRequest).toHaveBeenCalledWith('agent.rename', {
      agentId,
      name: 'My Custom Name',
      skipIfExplicitlySet: true,
    });

    // Verify workspace event is emitted (replaced direct IPC call)
    const { createWorkspaceEvent: mockCreate } = await import('$features/events/types');
    const { emitWorkspaceEvent: mockEmit } = await import(
      '../../../../../store/main/slices/workspace-events/workspace-events-slice'
    );
    const { mainDispatch: mockDispatch } = await import(
      '../../../../../store/main/redux-store-bridge'
    );
    expect(mockCreate).toHaveBeenCalledWith(
      'agent:renamed',
      workspaceId,
      { type: 'user', id: 'user' },
      { agentId, workspaceId, name: 'My Custom Name' },
    );
    expect(mockEmit).toHaveBeenCalled();
    expect(mockDispatch).toHaveBeenCalled();

    vi.doUnmock('$features/backend/main/backend.ipc');
  });

  it('throws when name is empty', async () => {
    const api = makeApi({});
    await expect(api.setAgentName('')).rejects.toThrow('name is required');
  });


});

// =====================================================================
// Git API tests – checkMergeConflicts wire contract
// =====================================================================
describe('buildWsGitApi – checkMergeConflicts', () => {
  // After Wave B FE cut-over, the FE just forwards to the daemon RPC
  // `git.checkMergeConflicts` (PROTOCOL.md §5.6); all merge-conflict detection
  // logic lives on the daemon side. We pin the wire contract here.

  const workspaceId = 'ws-git-1';
  const call = { context: { agentId: 'agent-1' }, name: 'workspace_api', arguments: {} } as any;

  beforeEach(() => {
    vi.resetModules();
  });

  it('forwards workspaceId + targetBranch to git.checkMergeConflicts and returns the daemon envelope', async () => {
    const daemonResult = {
      hasConflicts: false,
      conflictedFiles: [],
      targetBranch: 'main',
      currentBranch: 'feature-branch',
    };
    const mockRequest = vi.fn().mockResolvedValue(daemonResult);
    vi.doMock('$features/backend/main/backend.ipc', () => ({
      getBackendClient: () => ({ request: mockRequest }),
    }));

    const { buildWsGitApi } = await import('../ws-git-api');
    const api = buildWsGitApi({ workspaceId, call });
    const result = await api.checkMergeConflicts('main');

    expect(mockRequest).toHaveBeenCalledWith('git.checkMergeConflicts', {
      workspaceId,
      targetBranch: 'main',
    });
    expect(result).toEqual(daemonResult);

    vi.doUnmock('$features/backend/main/backend.ipc');
  });

  it('omits targetBranch when the caller did not supply one', async () => {
    const daemonResult = {
      hasConflicts: true,
      conflictedFiles: ['src/a.ts'],
      targetBranch: 'main',
      currentBranch: 'feature',
    };
    const mockRequest = vi.fn().mockResolvedValue(daemonResult);
    vi.doMock('$features/backend/main/backend.ipc', () => ({
      getBackendClient: () => ({ request: mockRequest }),
    }));

    const { buildWsGitApi } = await import('../ws-git-api');
    const api = buildWsGitApi({ workspaceId, call });
    const result = await api.checkMergeConflicts();

    expect(mockRequest).toHaveBeenCalledWith('git.checkMergeConflicts', { workspaceId });
    expect(result).toEqual(daemonResult);

    vi.doUnmock('$features/backend/main/backend.ipc');
  });

  it('propagates daemon rejections as a thrown Error', async () => {
    const mockRequest = vi.fn().mockRejectedValue(new Error('not a git repo'));
    vi.doMock('$features/backend/main/backend.ipc', () => ({
      getBackendClient: () => ({ request: mockRequest }),
    }));

    const { buildWsGitApi } = await import('../ws-git-api');
    const api = buildWsGitApi({ workspaceId, call });

    await expect(api.checkMergeConflicts('main')).rejects.toThrow('not a git repo');

    vi.doUnmock('$features/backend/main/backend.ipc');
  });
});

// =====================================================================
// Cross-Workspace API tests
// =====================================================================
describe('buildCrossWorkspaceApi', () => {
  const workspaceId = 'ws-current';

  function makeWorkspace(id: string, repoPath: string | null, title = 'Workspace') {
    return { id, repositoryPath: repoPath, title, branch: 'main', status: 'active', createdAt: '2024-01-01', updatedAt: '2024-01-02' };
  }

  function makeMockRepository(workspaces: any[]) {
    return {
      findById: vi.fn().mockImplementation((id: string) =>
        Promise.resolve(workspaces.find((w) => w.id === id) || null),
      ),
      findAll: vi.fn().mockResolvedValue(workspaces),
    };
  }

  describe('listSiblings', () => {
    it('filters to same repo path and excludes self', async () => {
      const workspaces = [
        makeWorkspace('ws-current', '/repo/path'),
        makeWorkspace('ws-sibling', '/repo/path', 'Sibling'),
        makeWorkspace('ws-other', '/different/repo', 'Other'),
      ];
      const api = buildCrossWorkspaceApi({
        workspaceId,
        repository: makeMockRepository(workspaces) as any,
      });

      const result = await api.listSiblings();
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('ws-sibling');
      expect(result[0].title).toBe('Sibling');
    });

    it('returns empty array when no siblings', async () => {
      const workspaces = [makeWorkspace('ws-current', '/repo/path')];
      const api = buildCrossWorkspaceApi({
        workspaceId,
        repository: makeMockRepository(workspaces) as any,
      });

      const result = await api.listSiblings();
      expect(result).toEqual([]);
    });

    it('throws when current workspace has no repository', async () => {
      const workspaces = [makeWorkspace('ws-current', null)];
      const api = buildCrossWorkspaceApi({
        workspaceId,
        repository: makeMockRepository(workspaces) as any,
      });

      await expect(api.listSiblings()).rejects.toThrow('not associated with a repository');
    });
  });

  describe('readNote', () => {
    it('denies access to workspace in a different repo', async () => {
      const workspaces = [
        makeWorkspace('ws-current', '/repo/a'),
        makeWorkspace('ws-unrelated', '/repo/b'),
      ];
      const mockManager = {
        getNote: vi.fn(),
        listNotes: vi.fn(),
      };
      const api = buildCrossWorkspaceApi({
        workspaceId,
        workspaceManager: mockManager,
        repository: makeMockRepository(workspaces) as any,
      });

      await expect(api.readNote('ws-unrelated', 'note-1')).rejects.toThrow('Access denied');
      expect(mockManager.getNote).not.toHaveBeenCalled();
    });

    it('throws when note is not found', async () => {
      const workspaces = [
        makeWorkspace('ws-current', '/repo/a'),
        makeWorkspace('ws-sibling', '/repo/a'),
      ];
      const mockManager = {
        getNote: vi.fn().mockResolvedValue(null),
        listNotes: vi.fn(),
      };
      const api = buildCrossWorkspaceApi({
        workspaceId,
        workspaceManager: mockManager,
        repository: makeMockRepository(workspaces) as any,
      });

      await expect(api.readNote('ws-sibling', 'missing')).rejects.toThrow('Note not found');
    });

    it('returns note data for valid sibling workspace', async () => {
      const workspaces = [
        makeWorkspace('ws-current', '/repo/a'),
        makeWorkspace('ws-sibling', '/repo/a', 'Sibling WS'),
      ];
      const mockManager = {
        getNote: vi.fn().mockResolvedValue({ id: 'note-1', title: 'Test Note', content: 'Hello\nWorld' }),
        listNotes: vi.fn(),
      };
      const api = buildCrossWorkspaceApi({
        workspaceId,
        workspaceManager: mockManager,
        repository: makeMockRepository(workspaces) as any,
      });

      const result = await api.readNote('ws-sibling', 'note-1');
      expect(result.id).toBe('note-1');
      expect(result.title).toBe('Test Note');
      expect(result.content).toBe('Hello\nWorld');
      expect(result.sourceWorkspaceId).toBe('ws-sibling');
      expect(result.lineCount).toBe(2);
    });
  });

  describe('listNotes', () => {
    it('denies access to workspace in a different repo', async () => {
      const workspaces = [
        makeWorkspace('ws-current', '/repo/a'),
        makeWorkspace('ws-unrelated', '/repo/b'),
      ];
      const mockManager = {
        getNote: vi.fn(),
        listNotes: vi.fn(),
      };
      const api = buildCrossWorkspaceApi({
        workspaceId,
        workspaceManager: mockManager,
        repository: makeMockRepository(workspaces) as any,
      });

      await expect(api.listNotes('ws-unrelated')).rejects.toThrow('Access denied');
    });

    it('returns mapped note list for valid sibling', async () => {
      const workspaces = [
        makeWorkspace('ws-current', '/repo/a'),
        makeWorkspace('ws-sibling', '/repo/a'),
      ];
      const mockManager = {
        getNote: vi.fn(),
        listNotes: vi.fn().mockResolvedValue([
          { id: 'n1', title: 'Note 1', created_at: '2024-01-01', updated_at: '2024-01-02' },
          { id: 'n2', title: 'Note 2', createdAt: '2024-02-01', updatedAt: '2024-02-02' },
        ]),
      };
      const api = buildCrossWorkspaceApi({
        workspaceId,
        workspaceManager: mockManager,
        repository: makeMockRepository(workspaces) as any,
      });

      const result = await api.listNotes('ws-sibling');
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ id: 'n1', title: 'Note 1', createdAt: '2024-01-01', updatedAt: '2024-01-02' });
      expect(result[1]).toEqual({ id: 'n2', title: 'Note 2', createdAt: '2024-02-01', updatedAt: '2024-02-02' });
    });

    it('returns empty list when sibling has no notes', async () => {
      const workspaces = [
        makeWorkspace('ws-current', '/repo/a'),
        makeWorkspace('ws-sibling', '/repo/a'),
      ];
      const mockManager = {
        getNote: vi.fn(),
        listNotes: vi.fn().mockResolvedValue([]),
      };
      const api = buildCrossWorkspaceApi({
        workspaceId,
        workspaceManager: mockManager,
        repository: makeMockRepository(workspaces) as any,
      });

      const result = await api.listNotes('ws-sibling');
      expect(result).toEqual([]);
    });
  });
});

