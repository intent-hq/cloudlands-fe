import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Wire-contract tests for the workspace.service ↔ daemon agent-ID surface.
 * Workspace agent IDs come from the `agentSummary.agentIds` card aggregate on
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

vi.mock('../../../../store/main/redux-store-bridge', () => ({
  mainDispatch: vi.fn((action: unknown) => action),
}));

import { WorkspaceService } from '../workspace.service';
import { InMemoryWorkspaceRepository } from '../workspace.repository';

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

  it('listWorkspaces issues no agent.list and reads agentSummary.agentIds off the workspace.list row', async () => {
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
          { id: 'agent-b', name: 'B', status: 'idle', isStreaming: false, isResponding: false },
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

    requestMock.mockClear();

    const listed = await service.listWorkspaces({ lite: true });
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;

    const agentListCalls = requestMock.mock.calls.filter(([m]) => m === 'agent.list');
    expect(agentListCalls).toHaveLength(0);

    const withAgents = listed.data.workspaces.find((w) => w.id === 'wire-test-ws');
    expect(withAgents?.agentSummary).toEqual({ agentIds: ['agent-a', 'agent-b'] });

    // Empty agentIds ⇒ agentSummary omitted from the outgoing metadata payload.
    const withoutAgents = listed.data.workspaces.find((w) => w.id === 'wire-test-ws-empty');
    expect(withoutAgents).toBeDefined();
    expect(withoutAgents?.agentSummary).toBeUndefined();
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

    expect(requestMock.mock.calls.filter(([m]) => m === 'agent.list')).toHaveLength(0);
    expect(listed.data.workspaces[0]?.agentSummary).toEqual({ agentIds: ['agent-a'] });
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
