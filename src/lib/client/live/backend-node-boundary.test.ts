import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const fixture = vi.hoisted(() => ({
  state: {
    daemonHealth: { connectionGeneration: 0 },
    userPreferences: { labsRemoteAgentsEnabled: false as unknown },
  },
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
import { setLocale } from '$shared/paraglide/runtime.js';
afterEach(() => setLocale('en', { reload: false }));
import { backendRequest } from './backend-transport';
import { BackendError } from './backend-transport-types';

beforeEach(() => {
  fixture.state.userPreferences.labsRemoteAgentsEnabled = false;
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
  it.each([
    'Claude agent Builder uses settings Intent cannot apply: hooks',
    'Claude agent Builder requires skills that are unavailable: review',
  ])('preserves imported specialist launch guidance after placement: %s', async (message) => {
    const placement = { target: 'local', checkout: 'isolated' };
    const original = new BackendError({ code: 'invalid-params', rpcCode: -32602, message });
    fixture.request.mockImplementation(async (method: string) => {
      if (method === 'client.hello')
        return { server: { capabilities: { agentNodes: 1, localNodeIsolation: 1 } } };
      if (method === 'specialist.get')
        return {
          specialist: {
            importedFrom: 'claude-code',
            unsupportedFields: ['hooks'],
            missingSkills: ['review'],
            runsOn: placement,
          },
        };
      if (method === 'agent.create') throw original;
      throw new Error(`Unexpected ${method}`);
    });
    const input = { workspaceId: 'ws', workspacePath: '/project', specialistId: 'builder' };
    await expect(backendRequest('agent.create', input)).rejects.toBe(original);
    expect(fixture.request).toHaveBeenCalledWith('specialist.get', {
      id: 'builder',
      workspaceId: 'ws',
      workspacePath: '/project',
    });
    expect(fixture.request).toHaveBeenLastCalledWith(
      'agent.create',
      { ...input, placement },
      undefined,
    );
    expect(fixture.choose).not.toHaveBeenCalled();
  });
  it.each(['workspace.get', 'agent.create'])(
    'preserves host authorization recovery for %s during guarded creation',
    async (deniedMethod) => {
      const original = new BackendError({
        code: 'host-execution-authorization',
        rpcCode: -32603,
        message: 'raw provider secret=do-not-render',
        data: {
          executionAuthorization: {
            resource: 'ai',
            reason: 'missing',
            providerId: 'codex',
            host: null,
            recovery: { actor: 'host-owner', action: 'check-ai-authorization' },
          },
        },
      });
      fixture.request.mockImplementation(async (method: string) => {
        if (method === deniedMethod) throw original;
        if (method === 'client.hello')
          return { server: { capabilities: { agentNodes: 1, localNodeIsolation: 1 } } };
        return { workspace: { defaultAgentPlacement: { target: 'local', checkout: 'isolated' } } };
      });
      const error = await backendRequest('agent.create', { workspaceId: 'ws' }).catch((e) => e);
      expect(error).toBeInstanceOf(BackendError);
      expect(error.message).not.toContain('do-not-render');
      expect(error.message).toMatch(/owner/i);
      expect(error.code).toBe(original.code);
      expect(error.rpcCode).toBe(original.rpcCode);
      expect(error.data).toEqual(original.data);
      if (deniedMethod === 'workspace.get')
        expect(fixture.request.mock.calls.some(([method]) => method === 'agent.create')).toBe(
          false,
        );
      else
        expect(fixture.request).toHaveBeenLastCalledWith(
          'agent.create',
          { workspaceId: 'ws', placement: { target: 'local', checkout: 'isolated' } },
          undefined,
        );
    },
  );
  it.each([undefined, null, false, 0, 1, 'true', {}])(
    'rejects non-boolean remote opt-in: %s',
    async (value) => {
      fixture.state.userPreferences.labsRemoteAgentsEnabled = value;
      await expect(
        backendRequest('agent.create', {
          placement: { target: 'remote', checkout: 'isolated' },
        }),
      ).rejects.toThrow();
      expect(fixture.request.mock.calls.some(([method]) => method === 'agent.create')).toBe(false);
    },
  );
  it('allows a remote launch only with the current true preference', async () => {
    fixture.state.userPreferences.labsRemoteAgentsEnabled = true;
    const input = { placement: { target: 'remote', checkout: 'isolated' } };
    await backendRequest('agent.create', input);
    expect(fixture.request).toHaveBeenLastCalledWith('agent.create', input, undefined);
  });
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
    fixture.state.userPreferences.labsRemoteAgentsEnabled = true;
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
    fixture.state.userPreferences.labsRemoteAgentsEnabled = false;
    resolve({ server: { capabilities: { agentNodes: 1 } } });
    await expect(creation).rejects.toThrow();
    expect(fixture.request).toHaveBeenCalledTimes(1);
  });
  it.each([
    ['en', 'Backend changed'],
    ['fr', 'Le backend a changé'],
  ] as const)('rejects a reconnect during preflight in %s', async (locale, message) => {
    setLocale(locale, { reload: false });
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
    await expect(creation).rejects.toThrow(message);
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
