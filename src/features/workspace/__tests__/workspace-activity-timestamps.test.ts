import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { WorkspaceService } from '../main/workspace.service';
import { InMemoryWorkspaceRepository } from '../main/workspace.repository';
import type { Workspace, WorkspaceId } from '../../../shared/types';
import {
  PullRequestStatus,
  TimelineEventType,
  WorkspaceStatus,
} from '../../../shared/types';
import { getWorkspaceActivityDisplayTime } from '../../../shared/utils/workspace-activity-time';

vi.mock('../../../store/main/redux-store-bridge', () => ({
  mainDispatch: vi.fn((action: any) => action),
}));

vi.mock('../../terminal/main/terminal.ipc', () => ({
  createTerminalFromBackend: vi.fn(),
}));

vi.mock('child_process', () => {
  const exec = vi.fn();
  const execFile = vi.fn();
  const spawn = vi.fn();
  return {
    default: { exec, execFile, spawn },
    exec,
    execFile,
    spawn,
    ChildProcess: class {},
  };
});

const githubServiceMocks = vi.hoisted(() => ({
  getPullRequest: vi.fn(),
  getCheckRuns: vi.fn(),
  getReviews: vi.fn(),
}));

// Notes and agents now come from the daemon (PROTOCOL.md §5.4 `note.list`,
// §5.5 `agent.list`). Each test seeds `notesByWorkspace` / `agentsByWorkspace`
// (or a rejection map) instead of writing through in-memory repositories.
const backendMocks = vi.hoisted(() => {
  const notesByWorkspace = new Map<string, Array<{ createdAt?: string; updatedAt?: string }>>();
  const agentsByWorkspace = new Map<
    string,
    Array<{ lastActivity?: string; updatedAt?: string; createdAt?: string }>
  >();
  const rejectMethods = new Set<string>();
  const request = vi.fn(async (method: string, params: unknown) => {
    if (rejectMethods.has(method)) {
      throw new Error(`${method} unavailable`);
    }
    const workspaceId =
      params && typeof params === 'object' && 'workspaceId' in params
        ? String((params as { workspaceId?: unknown }).workspaceId ?? '')
        : '';
    if (method === 'note.list') {
      return { notes: notesByWorkspace.get(workspaceId) ?? [] };
    }
    if (method === 'agent.list') {
      return { agents: agentsByWorkspace.get(workspaceId) ?? [] };
    }
    return {};
  });
  return { notesByWorkspace, agentsByWorkspace, rejectMethods, request };
});

vi.mock('../../backend/main/backend.ipc', () => ({
  getBackendClient: () => ({ request: backendMocks.request }),
}));

vi.mock('../../git-tracking/main/github.service', () => ({
  GitHubService: class {},
  githubService: {
    getPullRequest: githubServiceMocks.getPullRequest,
    getCheckRuns: githubServiceMocks.getCheckRuns,
    getReviews: githubServiceMocks.getReviews,
  },
}));

describe('workspace activity timestamps', () => {
  let service: WorkspaceService;
  let repository: InMemoryWorkspaceRepository;

  const createWorkspace = (overrides: Partial<Workspace> = {}): Workspace => {
    const timestamp = '2023-06-01T10:00:00.000Z';
    return {
      id: 'old-space' as WorkspaceId,
      title: 'Old Workspace',
      branch: 'workspace-branch',
      baseRef: 'main',
      changesets: [],
      timeline: [],
      conversationInfo: [],
      status: WorkspaceStatus.Active,
      createdAt: timestamp,
      updatedAt: timestamp,
      ...overrides,
    };
  };

  const createOpenPullRequest = (timestamp: string) => ({
    id: 'pr-1',
    number: 1,
    url: 'https://github.com/test/repo/pull/1',
    title: 'Test PR',
    status: PullRequestStatus.Open,
    createdAt: timestamp,
    updatedAt: timestamp,
  });

  const seedNoteActivity = (workspaceId: WorkspaceId, updatedAt: string): void => {
    const existing = backendMocks.notesByWorkspace.get(workspaceId) ?? [];
    existing.push({ createdAt: '2023-02-01T10:00:00.000Z', updatedAt });
    backendMocks.notesByWorkspace.set(workspaceId, existing);
  };

  const seedAgentActivity = (
    workspaceId: WorkspaceId,
    agent: { lastActivity?: string; updatedAt?: string; createdAt?: string },
  ): void => {
    const existing = backendMocks.agentsByWorkspace.get(workspaceId) ?? [];
    existing.push(agent);
    backendMocks.agentsByWorkspace.set(workspaceId, existing);
  };

  beforeEach(() => {
    repository = new InMemoryWorkspaceRepository();
    service = new WorkspaceService(repository);
    githubServiceMocks.getPullRequest.mockReset();
    githubServiceMocks.getCheckRuns.mockReset();
    githubServiceMocks.getReviews.mockReset();
    backendMocks.notesByWorkspace.clear();
    backendMocks.agentsByWorkspace.clear();
    backendMocks.rejectMethods.clear();
    backendMocks.request.mockClear();
  });

  afterEach(() => {
    service.cleanup();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('advances updatedAt for explicit workspace edits', async () => {
    const workspace = createWorkspace({ id: 'edit-space' as WorkspaceId });
    await repository.save(workspace);

    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-02-01T12:00:00.000Z'));
    const result = await service.updateWorkspace({ id: workspace.id, title: 'Updated Title' });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.updatedAt).toBe('2024-02-01T12:00:00.000Z');
    }
  });

  it('clears a stale PR link during background enrichment without advancing updatedAt', async () => {
    const oldTimestamp = '2023-06-01T10:00:00.000Z';
    const pullRequest = createOpenPullRequest(oldTimestamp);
    const workspace = createWorkspace({
      id: 'stale-link' as WorkspaceId,
      repositoryPath: '/path/to/repo',
      repositoryOwner: 'test',
      repositoryName: 'repo',
      activePullRequest: pullRequest,
      pullRequests: [pullRequest],
    });
    await repository.save(workspace);
    githubServiceMocks.getPullRequest.mockResolvedValue({ sourceBranch: 'other-branch' });

    await (service as any).performBackgroundEnrichment(workspace.id);

    const saved = await repository.findById(workspace.id);
    expect(saved?.activePullRequest).toBeUndefined();
    expect(saved?.pullRequests).toEqual([]);
    expect(saved?.updatedAt).toBe(oldTimestamp);
  });

  it('clears a stale PR link during periodic refresh without advancing updatedAt', async () => {
    const oldTimestamp = '2023-07-01T10:00:00.000Z';
    const pullRequest = createOpenPullRequest(oldTimestamp);
    const workspace = createWorkspace({
      id: 'stale-refresh' as WorkspaceId,
      createdAt: oldTimestamp,
      updatedAt: oldTimestamp,
      repositoryOwner: 'test',
      repositoryName: 'repo',
      activePullRequest: pullRequest,
      pullRequests: [pullRequest],
    });
    await repository.save(workspace);
    githubServiceMocks.getPullRequest.mockResolvedValue({ sourceBranch: 'other-branch' });

    await (service as any).performPRRefreshEnrichment(workspace.id);

    const saved = await repository.findById(workspace.id);
    expect(saved?.activePullRequest).toBeUndefined();
    expect(saved?.pullRequests).toEqual([]);
    expect(saved?.updatedAt).toBe(oldTimestamp);
  });

  it('repairs corrupted workspace recency from durable activity without using updatedAt', async () => {
    const createdAt = '2023-01-01T10:00:00.000Z';
    const noteActivity = '2023-04-01T10:00:00.000Z';
    const agentActivity = '2023-05-01T10:00:00.000Z';
    const corruptedUpdatedAt = '2026-05-07T15:00:00.000Z';
    const workspace = createWorkspace({
      id: 'corrupted-recency' as WorkspaceId,
      createdAt,
      updatedAt: corruptedUpdatedAt,
      timeline: [
        {
          id: 'timeline-1',
          type: TimelineEventType.NoteCreated,
          actor: { type: 'user', name: 'User', email: 'user@example.com' },
          timestamp: '2023-02-01T10:00:00.000Z',
          description: 'Older timeline activity',
        },
      ],
      conversationInfo: [
        {
          agentId: 'agent-1',
          threadId: 'thread-1',
          model: 'test-model',
          startedAt: '2023-02-15T10:00:00.000Z',
          endedAt: '2023-03-01T10:00:00.000Z',
        },
      ],
    });
    await repository.save(workspace);
    seedNoteActivity(workspace.id, noteActivity);
    seedAgentActivity(workspace.id, {
      lastActivity: agentActivity,
      updatedAt: '2023-04-15T10:00:00.000Z',
      createdAt: '2023-02-10T10:00:00.000Z',
    });
    vi.spyOn(service as any, 'scheduleBackgroundEnrichment').mockImplementation(() => {});

    const result = await service.listWorkspaces();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const repaired = result.data.workspaces.find((item) => item.id === workspace.id);
    expect(repaired?.lastActivity).toBe(agentActivity);
    expect(repaired?.updatedAt).toBe(corruptedUpdatedAt);
    expect(getWorkspaceActivityDisplayTime(repaired!)).toBe(Date.parse(agentActivity));

    const saved = await repository.findById(workspace.id);
    expect(saved?.lastActivity).toBe(agentActivity);
    expect(saved?.updatedAt).toBe(corruptedUpdatedAt);
  });

  it('preserves existing valid lastActivity during repair', async () => {
    const lastActivity = '2023-03-01T10:00:00.000Z';
    const workspace = createWorkspace({
      id: 'valid-activity' as WorkspaceId,
      lastActivity,
      updatedAt: '2026-05-07T15:00:00.000Z',
    });
    await repository.save(workspace);
    seedNoteActivity(workspace.id, '2023-04-01T10:00:00.000Z');
    const saveSpy = vi.spyOn(repository, 'save');
    vi.spyOn(service as any, 'scheduleBackgroundEnrichment').mockImplementation(() => {});

    const result = await service.listWorkspaces();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.workspaces[0]?.lastActivity).toBe(lastActivity);
    expect(saveSpy).not.toHaveBeenCalled();
  });

  it('falls back to createdAt for corrupted metadata without durable activity', async () => {
    const createdAt = '2023-01-01T10:00:00.000Z';
    const corruptedUpdatedAt = '2026-05-07T15:00:00.000Z';
    const workspace = createWorkspace({
      id: 'created-fallback' as WorkspaceId,
      createdAt,
      updatedAt: corruptedUpdatedAt,
    });
    await repository.save(workspace);
    vi.spyOn(service as any, 'scheduleBackgroundEnrichment').mockImplementation(() => {});

    const result = await service.listWorkspaces();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.workspaces[0]?.lastActivity).toBe(createdAt);
    expect(result.data.workspaces[0]?.lastActivity).not.toBe(corruptedUpdatedAt);
  });

  it('does not rewrite already repaired activity on later loads', async () => {
    const createdAt = '2023-01-01T10:00:00.000Z';
    const workspace = createWorkspace({
      id: 'idempotent-repair' as WorkspaceId,
      createdAt,
      updatedAt: '2026-05-07T15:00:00.000Z',
    });
    await repository.save(workspace);
    vi.spyOn(service as any, 'scheduleBackgroundEnrichment').mockImplementation(() => {});

    const firstResult = await service.listWorkspaces();
    expect(firstResult.ok).toBe(true);

    const saveSpy = vi.spyOn(repository, 'save');
    const secondResult = await service.getWorkspace(workspace.id);

    expect(secondResult.ok).toBe(true);
    if (secondResult.ok) {
      expect(secondResult.data.lastActivity).toBe(createdAt);
    }
    expect(saveSpy).not.toHaveBeenCalled();
  });

  it('falls back safely when notes and agent activity lookups fail during repair', async () => {
    const createdAt = '2023-01-01T10:00:00.000Z';
    const workspace = createWorkspace({
      id: 'lookup-failure' as WorkspaceId,
      createdAt,
      updatedAt: '2026-05-07T15:00:00.000Z',
    });
    await repository.save(workspace);
    backendMocks.rejectMethods.add('note.list');
    backendMocks.rejectMethods.add('agent.list');
    vi.spyOn(service as any, 'scheduleBackgroundEnrichment').mockImplementation(() => {});

    const result = await service.listWorkspaces();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.workspaces[0]?.lastActivity).toBe(createdAt);
  });

  it('repairs activity only for workspaces returned by list status filters', async () => {
    const activeWorkspace = createWorkspace({ id: 'active-space' as WorkspaceId });
    const archivedWorkspace = createWorkspace({
      id: 'archived-space' as WorkspaceId,
      status: WorkspaceStatus.Archived,
    });
    const deletedWorkspace = createWorkspace({
      id: 'deleted-space' as WorkspaceId,
      status: WorkspaceStatus.Deleted,
    });
    await repository.save(activeWorkspace);
    await repository.save(archivedWorkspace);
    await repository.save(deletedWorkspace);
    const repairSpy = vi
      .spyOn(service as any, 'repairWorkspaceActivityTimestamp')
      .mockImplementation(async (workspace) => workspace);
    vi.spyOn(service as any, 'scheduleBackgroundEnrichment').mockImplementation(() => {});

    const defaultResult = await service.listWorkspaces();
    expect(defaultResult.ok).toBe(true);
    expect(repairSpy).toHaveBeenCalledTimes(1);
    expect(repairSpy.mock.calls.map(([workspace]) => workspace.id)).toEqual(['active-space']);

    repairSpy.mockClear();
    const includeArchivedResult = await service.listWorkspaces({ includeArchived: true });
    expect(includeArchivedResult.ok).toBe(true);
    expect(repairSpy.mock.calls.map(([workspace]) => workspace.id)).toEqual([
      'active-space',
      'archived-space',
    ]);
  });

  it('limits concurrent workspace activity repairs', async () => {
    const workspaces = Array.from({ length: 25 }, (_, index) =>
      createWorkspace({ id: `space-${index}` as WorkspaceId }),
    );
    let activeRepairs = 0;
    let maxActiveRepairs = 0;
    vi.spyOn(service as any, 'repairWorkspaceActivityTimestamp').mockImplementation(async (workspace) => {
      activeRepairs += 1;
      maxActiveRepairs = Math.max(maxActiveRepairs, activeRepairs);
      await Promise.resolve();
      activeRepairs -= 1;
      return workspace;
    });

    const repaired = await (service as any).repairWorkspaceActivityTimestamps(workspaces);

    expect(repaired).toHaveLength(workspaces.length);
    expect(maxActiveRepairs).toBeLessThanOrEqual(10);
  });
});
