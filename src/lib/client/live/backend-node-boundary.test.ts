import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const fixture = vi.hoisted(() => ({
  state: {
    daemonHealth: { connectionGeneration: 0 },
    userPreferences: { labsRemoteAgentsEnabled: false as unknown },
  },
  choose: vi.fn(),
  request: vi.fn(),
  transport: {} as {
    request: ReturnType<typeof vi.fn>;
    observeNodeCapabilities?: () => Promise<unknown>;
  },
}));
vi.mock('./backend-transport-factory', () => ({
  resolveBackendTransport: () => fixture.transport,
}));
vi.mock('$store/renderer/store', () => ({
  store: { state: fixture.state, dispatch: fixture.choose },
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
  fixture.transport = {
    request: fixture.request,
    observeNodeCapabilities: () => fixture.request('client.hello', {}),
  };
  fixture.request.mockImplementation(async (method: string) => {
    if (method === 'client.hello')
      return { server: { capabilities: { agentNodes: 1, localNodeIsolation: 1 } } };
    return { ok: true };
  });
});
describe('renderer final wire boundary', () => {
  it('fails closed when capability observation is unavailable, without sending hello', async () => {
    fixture.transport = { request: fixture.request };
    await expect(
      backendRequest('workspace.create', { initialAgent: { prompt: 'Build' } }),
    ).rejects.toThrow();
    expect(fixture.request).not.toHaveBeenCalled();
  });
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
  it.each(['agent.create', 'agent.delegate', 'agent.wakeOrCreate'])(
    'sends omitted placement without dispatching a choice for %s',
    async (method) => {
      const input = { workspaceId: 'ws', taskNoteId: 'task' };
      await expect(backendRequest(method, input)).resolves.toEqual({ ok: true });
      expect(fixture.choose).not.toHaveBeenCalled();
      expect(fixture.request).toHaveBeenLastCalledWith(method, input, undefined);
    },
  );
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

describe('platform-default wire compatibility', () => {
  const placement = { arch: 'x86_64' };
  const hello = (
    routing: unknown = 1,
    agentNodes: unknown = 1,
    localNodeIsolation: unknown = 1,
  ) => ({
    server: { capabilities: { agentNodes, agentPlatformRouting: routing, localNodeIsolation } },
  });
  function useDefault(read: () => unknown = () => placement, capabilities = () => hello()) {
    fixture.request.mockImplementation(async (method: string) => {
      if (method === 'client.hello') return capabilities();
      if (method === 'workspace.get') return { workspace: { defaultAgentPlacement: await read() } };
      if (method === 'agent.create') return { agentId: 'created-agent' };
      return { ok: true };
    });
  }
  it('preserves an arch-only default and the actual launch response without opening a chooser', async () => {
    useDefault();
    await expect(backendRequest('agent.create', { workspaceId: 'ws' })).resolves.toEqual({
      agentId: 'created-agent',
    });
    expect(fixture.request).toHaveBeenLastCalledWith(
      'agent.create',
      { workspaceId: 'ws', placement },
      undefined,
    );
    expect(fixture.choose).not.toHaveBeenCalled();
  });
  it.each([undefined, null, false, true, 0, 2, '1'])(
    'rejects unsupported platform capability %j without dispatch',
    async (routing) => {
      useDefault(
        () => placement,
        () => ({ server: { capabilities: { agentNodes: 1, agentPlatformRouting: routing } } }),
      );
      await expect(backendRequest('agent.create', { workspaceId: 'ws' })).rejects.toThrow(
        /unavailable/,
      );
      expect(fixture.request.mock.calls.some(([method]) => method === 'agent.create')).toBe(false);
    },
  );
  it('requires agentNodes alongside the exact platform capability', async () => {
    useDefault(
      () => placement,
      () => hello(1, 2),
    );
    await expect(backendRequest('agent.create', { workspaceId: 'ws' })).rejects.toThrow(
      /unavailable/,
    );
    expect(fixture.request.mock.calls.some(([method]) => method === 'agent.create')).toBe(false);
  });
  it('rechecks platform support after the awaited default read', async () => {
    let supported = true;
    useDefault(
      () => {
        supported = false;
        return placement;
      },
      () => hello(supported ? 1 : 2),
    );
    await expect(backendRequest('agent.create', { workspaceId: 'ws' })).rejects.toThrow(
      /unavailable/,
    );
    expect(fixture.request.mock.calls.some(([method]) => method === 'agent.create')).toBe(false);
  });
  it('rejects a connection generation change during the default read', async () => {
    useDefault(() => {
      fixture.state.daemonHealth.connectionGeneration++;
      return placement;
    });
    await expect(backendRequest('agent.create', { workspaceId: 'ws' })).rejects.toThrow(/changed/i);
    expect(fixture.request.mock.calls.some(([method]) => method === 'agent.create')).toBe(false);
  });
  it('keeps known exclusive remote intent gated after Labs changes during an await', async () => {
    fixture.state.userPreferences.labsRemoteAgentsEnabled = true;
    useDefault(() => {
      fixture.state.userPreferences.labsRemoteAgentsEnabled = false;
      return { exclusive: true };
    });
    await expect(backendRequest('agent.create', { workspaceId: 'ws' })).rejects.toThrow(/Labs/);
    expect(fixture.request.mock.calls.some(([method]) => method === 'agent.create')).toBe(false);
  });
  it('does not downgrade local isolation when the local capability is absent', async () => {
    useDefault(
      () => ({ target: 'local' }),
      () => hello(1, 1, 0),
    );
    await expect(backendRequest('agent.create', { workspaceId: 'ws' })).rejects.toThrow(
      /unavailable/,
    );
    expect(fixture.request.mock.calls.some(([method]) => method === 'agent.create')).toBe(false);
  });
  it.each([
    ['agent.create', { workspaceId: 'ws', placement: {} }],
    ['agent.delegate', { workspaceId: 'ws', taskNoteId: 'task', placement: {} }],
    ['agent.wakeOrCreate', { workspaceId: 'ws', create: { placement: {} } }],
    ['workspace.create', { title: 'New workspace', initialAgent: { placement: {} } }],
  ])(
    'preserves explicit empty placement without inheriting workspace constraints for %s',
    async (method, input) => {
      useDefault(() => {
        throw new Error('Must not read a lower-precedence default');
      });
      await backendRequest(method as string, input);
      expect(fixture.request).toHaveBeenLastCalledWith(method, input, undefined);
    },
  );
  it('retains per-task whole-object overrides over a partial batch default', async () => {
    useDefault(() => {
      throw new Error('Must not read lower defaults');
    });
    await backendRequest('agent.delegate', {
      workspaceId: 'ws',
      placement,
      tasks: [{ taskNoteId: 'task-one', placement: {} }, { taskNoteId: 'task-two' }],
    });
    expect(fixture.request).toHaveBeenLastCalledWith(
      'agent.delegate',
      {
        workspaceId: 'ws',
        tasks: [
          { taskNoteId: 'task-one', placement: {} },
          { taskNoteId: 'task-two', placement },
        ],
      },
      undefined,
    );
  });
  it('preserves default-clear null without requiring node capabilities', async () => {
    await backendRequest('workspace.update', { workspaceId: 'ws', defaultAgentPlacement: null });
    expect(fixture.request).toHaveBeenCalledExactlyOnceWith(
      'workspace.update',
      { workspaceId: 'ws', defaultAgentPlacement: null },
      undefined,
    );
  });
});
