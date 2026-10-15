import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBackendAgentCreator } from './backend-agent-creator';
import type { BackendRuntime } from './backend-transport-runtime';
import { BackendError } from './backend-transport-types';
import * as idempotency from './idempotency-key';
import { AgentFactoryCore, type AgentFactoryRuntime } from '$shared/services/agent-factory-core';
import { agentCircuitBreaker } from '$shared/services/agent-circuit-breaker';
import type { Workspace } from '$shared/types';
import { createWorkspaceId } from '$shared/types/branded-ids';

vi.mock('$store/renderer/store', () => {
  throw new Error('Injected creator imported the source Store');
});
vi.mock('./backend-transport', () => {
  throw new Error('Injected creator imported the source transport');
});
vi.mock('$lib/client', () => {
  throw new Error('Injected creator imported the source AppClient');
});

const workspace = { id: createWorkspaceId('creator-workspace'), path: '/repo' } as Workspace;
const daemonAgent = {
  id: 'agent-daemon-created',
  workspaceId: workspace.id,
  acpSessionId: 'provider-session',
  status: 'pending',
  name: 'Host session',
  provider: 'codex',
  model: 'resolved-model',
  createdAt: '2026-10-15T00:00:00Z',
  updatedAt: '2026-10-15T00:00:00Z',
};

function binding() {
  const backendRequest = vi
    .fn<BackendRuntime['backendRequest']>()
    .mockResolvedValue({ agent: daemonAgent });
  const create = createBackendAgentCreator({
    backendRequest: <T>(...args: Parameters<BackendRuntime['backendRequest']>) => {
      args[2]?.onDispatch?.();
      return backendRequest<T>(args[0], args[1]);
    },
  });
  const runtime = {
    isBackend: false,
    getPrincipalContext: () => 'connection',
    getActiveProviderId: (): string | null => null,
    getProviderAvailability: () => ({ hasCheckedOnce: true, availableEnabledProviderIds: [] }),
    isHostMember: () => false,
    getWorkspaceContext: async () => undefined,
    create,
    sendMessage: vi.fn(async () => ({ success: true, queued: false })),
    toImageReferenceBlocks: async (_workspaceId, blocks) => blocks,
    upsertSession: vi.fn(),
    addMessage: vi.fn(),
    setAgentStreaming: vi.fn(),
  } satisfies AgentFactoryRuntime;
  return { backendRequest, create, runtime, factory: new AgentFactoryCore(runtime) };
}

afterEach(() => {
  agentCircuitBreaker.removeWorkspace(workspace.id);
  vi.restoreAllMocks();
});

describe('canonical injected agent creator', () => {
  it('sends the exact creation envelope and uses the existing agent normalization', async () => {
    const { create, backendRequest } = binding();
    const onDispatch = vi.fn();
    const session = await create(
      {
        workspaceId: workspace.id,
        agentId: 'client-id-must-not-be-sent',
        name: 'Requested',
        nameExplicitlySet: false,
        prompt: 'Follow this task',
        specialist: 'implementor',
        rememberSpecialist: true,
        provider: 'codex',
        model: 'explicit-model',
        reasoningEffort: 'high',
        agentType: 'workspace',
        workspacePath: '/repo',
        workspaceContext: { openPanels: [], linkedReferences: [] },
        metadata: { source: 'api' },
        placement: { target: 'local', checkout: 'isolated' },
      },
      onDispatch,
    );
    expect(backendRequest).toHaveBeenCalledExactlyOnceWith('agent.create', {
      workspaceId: workspace.id,
      idempotencyKey: expect.any(String),
      name: 'Requested',
      nameExplicitlySet: false,
      behaviorPrompt: 'Follow this task',
      specialistId: 'implementor',
      rememberSpecialist: true,
      provider: 'codex',
      model: 'explicit-model',
      reasoningEffort: 'high',
      agentType: 'workspace',
      workspacePath: '/repo',
      workspaceContext: { openPanels: [], linkedReferences: [] },
      metadata: { source: 'api' },
      placement: { target: 'local', checkout: 'isolated' },
    });
    expect(session).toMatchObject({
      id: 'agent-daemon-created',
      workspaceId: workspace.id,
      backendSessionId: 'provider-session',
      provider: 'codex',
      model: 'resolved-model',
      messages: [],
    });
    expect(onDispatch).toHaveBeenCalledOnce();
    expect(onDispatch.mock.invocationCallOrder[0]).toBeLessThan(
      backendRequest.mock.invocationCallOrder[0],
    );
  });

  it('omits caller-unspecified defaults and mints a distinct idempotency key per explicit create', async () => {
    const { create, backendRequest } = binding();
    await create({ workspaceId: workspace.id });
    await create({ workspaceId: workspace.id });
    expect(backendRequest).toHaveBeenCalledTimes(2);
    for (const call of backendRequest.mock.calls) {
      expect(call).toEqual([
        'agent.create',
        { workspaceId: workspace.id, idempotencyKey: expect.any(String) },
      ]);
    }
    expect(backendRequest.mock.calls[0][1]?.idempotencyKey).not.toEqual(
      backendRequest.mock.calls[1][1]?.idempotencyKey,
    );
  });

  it.each([
    ['lost reply', new Error('Connection lost after sending'), true],
    [
      'generic RPC error',
      new BackendError({
        code: 'INTERNAL_ERROR',
        message: 'After operation failed',
        rpcCode: -32603,
      }),
      true,
    ],
    [
      'unclassified server error',
      new BackendError({
        code: 'SERVER_ERROR',
        message: 'Unknown operation outcome',
        rpcCode: -32000,
      }),
      true,
    ],
    ...[-32600, -32601, -32602, -32003].map(
      (code) =>
        [
          String(code),
          new BackendError({ code: 'REJECTED', message: 'Definite refusal', rpcCode: code }),
          false,
        ] as const,
    ),
  ] as const)(
    'classifies %s without losing its typed cause or retrying',
    async (_name, cause, uncertain) => {
      const { factory, backendRequest, runtime } = binding();
      backendRequest.mockRejectedValue(cause);
      const result = await factory.createAgent(workspace, { workspaceId: workspace.id });
      expect(result.success).toBe(false);
      expect(result.cause).toBe(cause);
      expect(result.creationUncertain === true).toBe(uncertain);
      expect(backendRequest).toHaveBeenCalledOnce();
      expect(runtime.upsertSession).not.toHaveBeenCalled();
      expect(runtime.sendMessage).not.toHaveBeenCalled();
    },
  );

  it.each([null, {}, { agent: {} }, { agent: { id: '' } }, { agent: { id: 123 } }])(
    'marks a malformed create response as uncertain: %j',
    async (response) => {
      const { factory, backendRequest, runtime } = binding();
      backendRequest.mockResolvedValue(response);
      const result = await factory.createAgent(workspace, { workspaceId: workspace.id });
      expect(result).toMatchObject({ success: false, creationUncertain: true });
      expect(backendRequest).toHaveBeenCalledOnce();
      expect(runtime.upsertSession).not.toHaveBeenCalled();
    },
  );

  it('does not mark local key preparation failure as a possibly executed creation', async () => {
    const { factory, backendRequest } = binding();
    const cause = new Error('Cannot prepare idempotency key');
    vi.spyOn(idempotency, 'newIdempotencyKey').mockImplementationOnce(() => {
      throw cause;
    });
    const result = await factory.createAgent(workspace, { workspaceId: workspace.id });
    expect(result.success).toBe(false);
    expect(result.cause).toBe(cause);
    expect(result.creationUncertain).toBeUndefined();
    expect(backendRequest).not.toHaveBeenCalled();
  });

  it('keeps runtime lease preflight failures definite without a wire dispatch', async () => {
    const { factory, runtime, backendRequest } = binding();
    const cause = new Error('Workspace lease retired');
    runtime.create = async () => {
      throw cause;
    };
    const result = await factory.createAgent(workspace, { workspaceId: workspace.id });
    expect(result.success).toBe(false);
    expect(result.cause).toBe(cause);
    expect(result.creationUncertain).toBeUndefined();
    expect(backendRequest).not.toHaveBeenCalled();
  });

  it('stops retirement during async request preparation before the final wire dispatch', async () => {
    const { factory, runtime, create, backendRequest } = binding();
    const prepared = Promise.withResolvers<void>();
    const preparing = Promise.withResolvers<void>();
    runtime.create = async (request, onDispatch) => {
      preparing.resolve();
      await prepared.promise;
      return create(request, onDispatch);
    };
    const pending = factory.createAgent(workspace, { workspaceId: workspace.id });
    await preparing.promise;
    runtime.getPrincipalContext = () => 'replacement';
    prepared.resolve();
    const result = await pending;
    expect(result.success).toBe(false);
    expect(result.creationUncertain).toBeUndefined();
    expect(backendRequest).not.toHaveBeenCalled();
    expect(runtime.upsertSession).not.toHaveBeenCalled();
  });

  it('preserves a lost create reply as uncertain even when its authority has retired', async () => {
    const { factory, runtime, backendRequest } = binding();
    const response = Promise.withResolvers<unknown>();
    backendRequest.mockReturnValue(response.promise);
    const pending = factory.createAgent(workspace, { workspaceId: workspace.id });
    await vi.waitFor(() => expect(backendRequest).toHaveBeenCalledOnce());
    runtime.getPrincipalContext = () => 'replacement';
    const cause = new Error('Connection lost after creation');
    response.reject(cause);
    const result = await pending;
    expect(result).toMatchObject({ success: false, creationUncertain: true });
    expect(result.cause).toBe(cause);
    expect(runtime.upsertSession).not.toHaveBeenCalled();
  });

  it('does not mark invalid workspace/provider preflight or a successful create as uncertain', async () => {
    const { factory, runtime, backendRequest } = binding();
    const invalid = await factory.createAgent(
      { ...workspace, path: undefined },
      { workspaceId: workspace.id },
    );
    expect(invalid).toMatchObject({ success: false });
    expect(invalid.creationUncertain).toBeUndefined();
    runtime.getActiveProviderId = () => 'codex';
    const unavailable = await factory.createAgent(workspace, { workspaceId: workspace.id });
    expect(unavailable.success).toBe(false);
    expect(unavailable.creationUncertain).toBeUndefined();
    expect(backendRequest).not.toHaveBeenCalled();
    const success = await factory.createAgent(workspace, {
      workspaceId: workspace.id,
      provider: 'codex',
    });
    expect(success).toMatchObject({ success: true, agentId: 'agent-daemon-created' });
    expect(success.creationUncertain).toBeUndefined();
    expect(backendRequest).toHaveBeenCalledOnce();
  });
});
