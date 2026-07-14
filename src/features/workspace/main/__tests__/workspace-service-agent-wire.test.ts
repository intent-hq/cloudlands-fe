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
    // Mirror the in-memory `save` into the daemon-read stub so `listWorkspaces`
    // (now served by `workspace.list`) sees rows the tests create through the
    // legacy `WorkspaceService.createWorkspace` write path.
    const originalSave = repository.save.bind(repository);
    vi.spyOn(repository, 'save').mockImplementation(async (ws) => {
      await originalSave(ws);
      const idx = daemonWorkspaces.findIndex((row) => row.id === ws.id);
      if (idx >= 0) daemonWorkspaces[idx] = { ...ws };
      else daemonWorkspaces.push({ ...ws });
    });

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


  // NOTE: The former `addAgentActivityCandidates routes through agent.list
  // when repairing activity timestamps` test was retired alongside the FE
  // `deriveWorkspaceLastActivity` / `addAgentActivityCandidates` helpers —
  // the daemon now owns `lastActivity` on every wire path (PROTOCOL.md §5.1
  // / §9.1), so there is no FE-side repair to exercise.
});
