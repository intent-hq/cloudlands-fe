import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Wire-contract tests for the workspace.service ↔ daemon `agent.*` rewire
 * (PROTOCOL.md §5.5). The daemon owns the session record, and
 * workspace-derived agent IDs / activity timestamps are read via
 * `agent.list`.
 *
 * These tests pin the exact JSON-RPC method name and params shape emitted by
 * `WorkspaceService` so the wire contract cannot drift without the tests
 * failing.
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

describe('workspace.service ↔ daemon agent.* (PROTOCOL.md §5.5)', () => {
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

  it('listWorkspaces (lite) issues agent.list { workspaceId } per workspace', async () => {
    const now = new Date().toISOString();
    daemonWorkspaces.push({
      id: 'wire-test-ws',
      title: 'Wire Test',
      branch: 'wire-test-ws',
      status: 'Active',
      repositoryPath: '/path/to/repo',
      createdAt: now,
      updatedAt: now,
    });

    requestMock.mockClear();

    const listed = await service.listWorkspaces({ lite: true });
    expect(listed.ok).toBe(true);

    const listCalls = requestMock.mock.calls.filter(([m]) => m === 'agent.list');
    expect(listCalls.length).toBeGreaterThanOrEqual(1);
    for (const [, params] of listCalls) {
      expect(params).toEqual({ workspaceId: 'wire-test-ws' });
    }
  });


  // NOTE: The former `addAgentActivityCandidates routes through agent.list
  // when repairing activity timestamps` test was retired alongside the FE
  // `deriveWorkspaceLastActivity` / `addAgentActivityCandidates` helpers —
  // the daemon now owns `lastActivity` on every wire path (PROTOCOL.md §5.1
  // / §9.1), so there is no FE-side repair to exercise.
});
