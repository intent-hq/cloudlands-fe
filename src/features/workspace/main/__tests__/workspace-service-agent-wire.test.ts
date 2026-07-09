import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Wire-contract tests for the workspace.service ↔ daemon `agent.*` rewire
 * (PROTOCOL.md §5.5). The legacy on-disk `agentPersistence` layer is
 * retired; the daemon owns the session record, the initial-agent save is
 * routed through `agent.create`, and workspace-derived agent IDs / activity
 * timestamps are read via `agent.list`.
 *
 * These tests pin the exact JSON-RPC method name and params shape emitted by
 * `WorkspaceService` so the wire contract cannot drift without the tests
 * failing.
 */

const requestMock = vi.hoisted(() =>
  vi.fn(async (method: string) => {
    if (method === 'agent.list') return { agents: [] };
    if (method === 'agent.create') return { agent: { id: 'agent-init' } };
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
    requestMock.mockImplementation(async (method: string) => {
      if (method === 'agent.list') return { agents: [] };
      if (method === 'agent.create') return { agent: { id: 'agent-init' } };
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

  it('createWorkspace routes the initial-agent save through agent.create', async () => {
    const result = await service.createWorkspace({
      repositoryPath: '/path/to/repo',
      skipWorktree: true,
      initialAgent: {
        agentId: 'agent-init',
        name: 'Initial',
        prompt: 'Kick things off',
        model: 'sonnet',
        provider: 'auggie',
        agentType: 'workspace',
        metadata: { flavor: 'wire-test' },
        contextReferences: [{ type: 'selection', content: 'ctx' }],
        imageBlocks: [{ mimeType: 'image/png', data: 'AAA=' }],
      } as any,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const createCalls = requestMock.mock.calls.filter(([m]) => m === 'agent.create');
    expect(createCalls).toHaveLength(1);
    const [, params] = createCalls[0];
    const body = params as Record<string, unknown>;

    // Wire-shape guarantees per PROTOCOL.md §5.5 `agent.create`.
    expect(body.workspaceId).toBe(result.data.id);
    expect(body.agentId).toBe('agent-init');
    expect(body.name).toBe('Initial');
    expect(body.model).toBe('sonnet');
    expect(body.provider).toBe('auggie');
    expect(body.agentType).toBe('workspace');
    expect(typeof body.workspacePath).toBe('string');
    // Top-level `contextReferences` / `imageBlocks` are forwarded verbatim so
    // they win over the `metadata` copies (P3-1.2b harvest rule).
    expect(body.contextReferences).toEqual([{ type: 'selection', content: 'ctx' }]);
    expect(body.imageBlocks).toEqual([{ mimeType: 'image/png', data: 'AAA=' }]);
    // `metadata` carries the persisted gap fields (initialMessage, specialist,
    // provider, roleReminder, specialistName, isInitialAgent, …).
    const metadata = body.metadata as Record<string, unknown>;
    expect(metadata.initialMessage).toBe('Kick things off');
    expect(metadata.isInitialAgent).toBe(true);
    expect(metadata.provider).toBe('auggie');
    expect(metadata.flavor).toBe('wire-test');
  });

  it('listWorkspaces (lite) issues agent.list { workspaceId } per workspace', async () => {
    const created = await service.createWorkspace({
      repositoryPath: '/path/to/repo',
      skipWorktree: true,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    requestMock.mockClear();

    const listed = await service.listWorkspaces({ lite: true });
    expect(listed.ok).toBe(true);

    const listCalls = requestMock.mock.calls.filter(([m]) => m === 'agent.list');
    expect(listCalls.length).toBeGreaterThanOrEqual(1);
    for (const [, params] of listCalls) {
      expect(params).toEqual({ workspaceId: created.data.id });
    }
  });

  it('addAgentActivityCandidates routes through agent.list when repairing activity timestamps', async () => {
    const created = await service.createWorkspace({
      repositoryPath: '/path/to/repo',
      skipWorktree: true,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    // Force the activity-repair path by clearing the workspace's lastActivity;
    // `listWorkspaces` will then call `deriveWorkspaceLastActivity` →
    // `addAgentActivityCandidates` → daemon `agent.list`.
    const stored = await repository.findById(created.data.id);
    expect(stored).not.toBeNull();
    if (!stored) return;
    (stored as any).lastActivity = undefined;
    await repository.save(stored);

    requestMock.mockClear();
    // Feed an AgentLite-shaped response so the activity-candidate reducer has
    // something to iterate.
    requestMock.mockImplementation(async (method: string) => {
      if (method === 'agent.list') {
        return {
          agents: [
            {
              id: 'agent-a',
              lastActivity: '2025-01-02T03:04:05.000Z',
              updatedAt: '2025-01-02T03:04:05.000Z',
              createdAt: '2025-01-01T00:00:00.000Z',
            },
          ],
        };
      }
      return {};
    });

    await service.listWorkspaces({ lite: true });

    const listCalls = requestMock.mock.calls.filter(([m]) => m === 'agent.list');
    // Both getWorkspaceAgentIds (lite path) and addAgentActivityCandidates
    // route through `agent.list { workspaceId }`.
    expect(listCalls.length).toBeGreaterThanOrEqual(2);
    for (const [, params] of listCalls) {
      expect(params).toEqual({ workspaceId: created.data.id });
    }
  });
});
