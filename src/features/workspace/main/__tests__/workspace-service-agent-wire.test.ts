import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Wire-contract tests for the workspace.service ↔ daemon card aggregate.
 * Workspace agent summaries come from the `agentSummary` card aggregate on
 * `workspace.list` / `workspace.get` rows (PROTOCOL.md §5.1) — the service
 * must NOT fan out per-workspace `agent.list` RPCs (monorepo#1768).
 *
 * These tests pin the exact JSON-RPC traffic emitted by `WorkspaceService`
 * so the wire contract cannot drift without the tests failing.
 */

// Shared workspace list surfaced by the daemon read seam so
// `WorkspaceService.listWorkspaces` (which now issues `workspace.list` per
// PROTOCOL.md §5.1) sees the workspace the tests created through the in-memory
// repository write path.
const daemonWorkspaces: Array<Record<string, unknown>> = [];

const requestMock = vi.hoisted(() =>
  vi.fn(async (method: string, params?: Record<string, unknown>) => {
    if (method === 'agent.list') return { agents: [] };
    if (method === 'agent.create') return { agent: { id: 'agent-init' } };
    if (method === 'workspace.list') {
      return { workspaces: daemonWorkspaces };
    }
    if (method === 'workspace.get') {
      const id = params?.workspaceId;
      const match = daemonWorkspaces.find((w) => w.id === id);
      if (!match) throw new Error('Workspace not found');
      return { workspace: match };
    }
    return {};
  }),
);

vi.mock('../../../backend/main/backend.ipc', () => ({
  getBackendClient: () => ({ request: requestMock }),
  onBackendReconnected: () => () => {},
}));

import { WorkspaceService } from '../workspace.service';
import { InMemoryWorkspaceRepository } from '../workspace.repository';
import { WorkspaceId } from '../../../../shared/types/branded-ids';

const GIT_CONFIG_FIXTURE = `
[core]
    repositoryformatversion = 0
[remote "origin"]
    url = https://github.com/test/repo.git
    fetch = +refs/heads/*:refs/remotes/origin/*
`;

describe('workspace.service ↔ daemon agentSummary card aggregate (PROTOCOL.md §5.1)', () => {
  let service: WorkspaceService;
  let repository: InMemoryWorkspaceRepository;

  beforeEach(() => {
    requestMock.mockClear();
    daemonWorkspaces.length = 0;
    requestMock.mockImplementation(async (method: string, params?: Record<string, unknown>) => {
      if (method === 'agent.list') return { agents: [] };
      if (method === 'agent.create') return { agent: { id: 'agent-init' } };
      if (method === 'workspace.list') return { workspaces: daemonWorkspaces };
      if (method === 'workspace.get') {
        const id = params?.workspaceId;
        const match = daemonWorkspaces.find((w) => w.id === id);
        if (!match) throw new Error('Workspace not found');
        return { workspace: match };
      }
      return {};
    });

    repository = new InMemoryWorkspaceRepository();
    vi.spyOn(repository, 'readGitConfig').mockResolvedValue(GIT_CONFIG_FIXTURE);

    service = new WorkspaceService(repository);
  });

  afterEach(() => {
    service.cleanup();
    vi.clearAllMocks();
  });

  it('preserves agent cards through the desktop list entry point without agent.list fan-out', async () => {
    const now = new Date().toISOString();
    daemonWorkspaces.push({
      id: 'wire-test-ws',
      title: 'Wire Test',
      branch: 'wire-test-ws',
      status: 'Active',
      repositoryPath: '/path/to/repo',
      createdAt: now,
      updatedAt: now,
      // PROTOCOL.md §5.1 card aggregate shape: { count, agents, agentIds }.
      agentSummary: {
        count: 2,
        agents: [
          { id: 'agent-a', name: 'A', status: 'idle', isStreaming: false, isResponding: false },
          {
            id: 'agent-b',
            name: 'B',
            status: 'active',
            parentAgentId: 'agent-a',
            lastActivity: now,
            isBackground: true,
            isStreaming: false,
            isResponding: false,
          },
        ],
        agentIds: ['agent-a', 'agent-b'],
      },
    });
    daemonWorkspaces.push({
      id: 'wire-test-ws-empty',
      title: 'Wire Test Empty',
      branch: 'wire-test-ws-empty',
      status: 'Active',
      repositoryPath: '/path/to/repo',
      createdAt: now,
      updatedAt: now,
      agentSummary: { count: 0, agents: [], agentIds: [] },
    });
    daemonWorkspaces.push({
      id: 'wire-test-ws-no-summary',
      title: 'No summary',
      status: 'Active',
      createdAt: now,
      updatedAt: now,
    });

    requestMock.mockClear();

    const listed = await service.listAllWorkspaces({ lite: true });
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;

    expect(requestMock.mock.calls).toEqual([['workspace.list', { includeArchived: true }]]);

    const withAgents = listed.data.find((w) => w.id === 'wire-test-ws');
    expect(withAgents?.agentSummary).toEqual(daemonWorkspaces[0].agentSummary);

    const withoutAgents = listed.data.find((w) => w.id === 'wire-test-ws-empty');
    expect(withoutAgents).toBeDefined();
    expect(withoutAgents?.agentSummary).toEqual({ count: 0, agents: [], agentIds: [] });
    expect(listed.data.find((w) => w.id === 'wire-test-ws-no-summary')).not.toHaveProperty(
      'agentSummary',
    );
  });

  it('listWorkspaces (non-lite) also issues no agent.list', async () => {
    const now = new Date().toISOString();
    daemonWorkspaces.push({
      id: 'wire-test-ws',
      title: 'Wire Test',
      branch: 'wire-test-ws',
      status: 'Active',
      repositoryPath: '/path/to/repo',
      createdAt: now,
      updatedAt: now,
      agentSummary: {
        count: 1,
        agents: [
          { id: 'agent-a', name: 'A', status: 'idle', isStreaming: false, isResponding: false },
        ],
        agentIds: ['agent-a'],
      },
    });

    requestMock.mockClear();

    const listed = await service.listWorkspaces({ lite: false });
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;

    expect(requestMock.mock.calls).toEqual([['workspace.list', { includeArchived: false }]]);
    expect(listed.data.workspaces[0]?.agentSummary).toEqual(daemonWorkspaces[0].agentSummary);
  });

  it('keeps card agents when desktop workspace detail replaces a list row', async () => {
    const summary = {
      count: 1,
      agentIds: ['agent-a'],
      agents: [
        {
          id: 'agent-a',
          name: 'Coordinator',
          status: 'active',
          isStreaming: false,
          isResponding: false,
        },
      ],
    };
    daemonWorkspaces.push({
      id: 'wire-test-ws',
      title: 'Wire Test',
      status: 'Active',
      createdAt: '2026-10-08T20:00:00Z',
      updatedAt: '2026-10-08T20:00:00Z',
      agentSummary: summary,
    });

    const result = await service.getWorkspace(WorkspaceId('wire-test-ws'));

    expect(requestMock).toHaveBeenCalledWith('workspace.get', { workspaceId: 'wire-test-ws' });
    expect(requestMock.mock.calls.filter(([method]) => method === 'agent.list')).toHaveLength(0);
    expect(result).toMatchObject({ ok: true, data: { agentSummary: summary } });
  });

  it('listWorkspaces carries taskStats from the workspace.list row through the metadata payload (monorepo#1934)', async () => {
    const now = new Date().toISOString();
    daemonWorkspaces.push({
      id: 'wire-test-ws-stats',
      title: 'Wire Test Stats',
      branch: 'wire-test-ws-stats',
      status: 'Active',
      repositoryPath: '/path/to/repo',
      createdAt: now,
      updatedAt: now,
      // PROTOCOL.md §5.1: cheap daemon-computed task progress rollup.
      taskStats: { total: 4, completed: 2, inProgress: 1 },
      // High-frequency summaries stay stripped from the metadata payload.
      gitSummary: { ahead: 1, behind: 0, hasUnpushed: true },
      diffSummary: { totalAdditions: 1, totalDeletions: 0, fileCount: 1 },
    });
    daemonWorkspaces.push({
      id: 'wire-test-ws-no-stats',
      title: 'Wire Test No Stats',
      branch: 'wire-test-ws-no-stats',
      status: 'Active',
      repositoryPath: '/path/to/repo',
      createdAt: now,
      updatedAt: now,
    });

    requestMock.mockClear();

    const listed = await service.listWorkspaces({ lite: true });
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;

    const withStats = listed.data.workspaces.find((w) => w.id === 'wire-test-ws-stats');
    expect(withStats?.taskStats).toEqual({ total: 4, completed: 2, inProgress: 1 });
    expect(withStats?.gitSummary).toBeUndefined();
    expect(withStats?.diffSummary).toBeUndefined();

    // Rows without a daemon-provided rollup simply omit the field.
    const withoutStats = listed.data.workspaces.find((w) => w.id === 'wire-test-ws-no-stats');
    expect(withoutStats).toBeDefined();
    expect(withoutStats?.taskStats).toBeUndefined();
  });

  // NOTE: The former `addAgentActivityCandidates routes through agent.list
  // when repairing activity timestamps` test was retired alongside the FE
  // `deriveWorkspaceLastActivity` / `addAgentActivityCandidates` helpers —
  // the daemon now owns `lastActivity` on every wire path (PROTOCOL.md §5.1
  // / §9.1), so there is no FE-side repair to exercise.
});
