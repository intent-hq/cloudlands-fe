import { beforeEach, describe, expect, it, vi } from 'vitest';
const fixture = vi.hoisted(() => ({
  enabled: false,
  state: { daemonHealth: { connectionGeneration: 0 } },
  choose: vi.fn(),
  request: vi.fn(),
  transport: {} as { request: ReturnType<typeof vi.fn> },
}));
vi.mock('./backend-transport-factory', () => ({
  resolveBackendTransport: () => fixture.transport,
}));
vi.mock('$store/renderer/store', () => ({
  store: { state: fixture.state, dispatch: fixture.choose },
}));
vi.mock('$store/renderer/slices/workspace-agents/workspace-agents-slice', () => ({
  localPlacementRequested: (caps: unknown) => caps,
}));
vi.mock('$store/renderer/slices/user-preferences/user-preferences-selectors', () => ({
  selectLabsRemoteAgentsEnabled: { select: () => fixture.enabled },
}));
import { backendRequest } from './backend-transport';

beforeEach(() => {
  fixture.enabled = false;
  fixture.state.daemonHealth.connectionGeneration = 0;
  fixture.request.mockReset();
  fixture.choose.mockReset().mockRejectedValue(new Error('cancelled'));
  fixture.transport = { request: fixture.request };
  fixture.request.mockImplementation(async (method: string) => {
    if (method === 'client.hello')
      return { server: { capabilities: { agentNodes: 1, localNodeIsolation: 1 } } };
    return { ok: true };
  });
});
describe('renderer final wire boundary', () => {
  it('sends the canonical local request without altering workspace checkout selection', async () => {
    const params = {
      checkoutMode: 'cow',
      initialAgent: { placement: { target: 'local', checkout: 'isolated' } },
    };
    expect(await backendRequest('workspace.create', params)).toEqual({ ok: true });
    expect(fixture.request.mock.calls).toEqual([
      ['client.hello', {}],
      ['workspace.create', params, undefined],
    ]);
  });
  it('blocks remote command or deep-link payloads with Labs off', async () => {
    await expect(
      backendRequest('agent.create', {
        workspaceId: 'ws',
        placement: { target: 'remote', checkout: 'isolated' },
      }),
    ).rejects.toThrow();
    expect(fixture.request.mock.calls.some(([method]) => method === 'agent.create')).toBe(false);
  });
  it('checks fresh Labs state after deferred capability discovery', async () => {
    fixture.enabled = true;
    let resolve: (value: unknown) => void = () => {};
    const pending = new Promise((done) => {
      resolve = done;
    });
    fixture.request.mockImplementation(() => pending);
    const creation = backendRequest('agent.create', {
      workspaceId: 'ws',
      placement: { target: 'remote', checkout: 'isolated' },
    });
    await vi.waitFor(() => expect(fixture.request).toHaveBeenCalledWith('client.hello', {}));
    fixture.enabled = false;
    resolve({ server: { capabilities: { agentNodes: 1 } } });
    await expect(creation).rejects.toThrow();
    expect(fixture.request).toHaveBeenCalledTimes(1);
  });
  it('rejects a reconnect that reuses the same transport during preflight', async () => {
    let resolve!: (value: unknown) => void;
    const pending = new Promise((done) => {
      resolve = done;
    });
    fixture.request.mockImplementationOnce(() => pending);
    const creation = backendRequest('agent.create', {
      placement: { target: 'local', checkout: 'shared' },
    });
    await vi.waitFor(() => expect(fixture.request).toHaveBeenCalled());
    fixture.state.daemonHealth.connectionGeneration++;
    resolve({ server: { capabilities: { agentNodes: 1 } } });
    await expect(creation).rejects.toThrow(/changed/);
    expect(fixture.request).toHaveBeenCalledTimes(1);
  });
  it('uses the explicit local answer for an unresolved launch', async () => {
    fixture.choose.mockResolvedValue({ target: 'local', checkout: 'worktree' });
    await backendRequest('agent.delegate', { workspaceId: 'ws', taskNoteId: 'task' });
    expect(fixture.choose).toHaveBeenCalledOnce();
    expect(fixture.request).toHaveBeenLastCalledWith(
      'agent.delegate',
      {
        workspaceId: 'ws',
        taskNoteId: 'task',
        placement: { target: 'local', checkout: 'worktree' },
      },
      undefined,
    );
  });
  it('preserves management of existing remote agents with Labs off', async () => {
    await backendRequest('agent.stop', { agentId: 'remote' });
    await backendRequest('hub.discard', {
      workspaceId: 'ws',
      agentId: 'remote',
      requestId: '00000000-0000-4000-8000-000000000004',
    });
    expect(fixture.request.mock.calls.map(([method]) => method)).toEqual([
      'agent.stop',
      'hub.discard',
    ]);
  });
  it('preserves project-specialist isolation at the actual create wire boundary', async () => {
    fixture.request.mockImplementation(
      async (method: string, params?: { workspacePath?: string }) => {
        if (method === 'client.hello')
          return { server: { capabilities: { agentNodes: 1, localNodeIsolation: 1 } } };
        if (method === 'specialist.get')
          return {
            specialist: {
              runsOn: {
                target: 'local',
                checkout: params?.workspacePath === '/project/checkout' ? 'isolated' : 'shared',
              },
            },
          };
        return { ok: true };
      },
    );
    const input = {
      workspaceId: 'ws',
      workspacePath: '/project/checkout',
      specialistId: 'builder',
    };
    await backendRequest('agent.create', input);
    expect(fixture.request).toHaveBeenCalledWith('specialist.get', {
      id: 'builder',
      workspaceId: 'ws',
      workspacePath: '/project/checkout',
    });
    expect(fixture.request).toHaveBeenLastCalledWith(
      'agent.create',
      { ...input, placement: { target: 'local', checkout: 'isolated' } },
      undefined,
    );
    expect(fixture.choose).not.toHaveBeenCalled();
  });
});
