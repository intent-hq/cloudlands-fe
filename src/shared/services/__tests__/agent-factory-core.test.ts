import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentFactoryCore, type AgentFactoryRuntime } from '../agent-factory-core';
import { agentCircuitBreaker } from '../agent-circuit-breaker';
import type { Workspace, AgentSession } from '$shared/types';
import { createAgentId, createWorkspaceId } from '$shared/types/branded-ids';
import { AgentStatus, type UnifiedAgentConfig } from '$shared/types/agent.types';
import { BackendError } from '$lib/client/live/backend-transport-types';

// A runtime-bound factory must work without booting any source renderer owners.
vi.mock('$store/renderer/store', () => {
  throw new Error('Shared agent factory loaded the source Store');
});
vi.mock('$lib/client', () => {
  throw new Error('Shared agent factory loaded the source client');
});
vi.mock('$lib/client/live/backend-transport', () => {
  throw new Error('Shared agent factory loaded the source transport');
});
vi.mock('$features/layout/panel-layout-adapter', () => {
  throw new Error('Shared agent factory loaded the source layout');
});
vi.mock('$lib/components/chat/input/image-attachment-placement', () => {
  throw new Error('Shared agent factory loaded the source image uploader');
});

const workspace = {
  id: createWorkspaceId('factory-runtime'),
  title: 'Runtime workspace',
  worktreePath: '/repo/worktree',
  path: '/workspace',
  repositoryPath: '/repo',
} as Workspace;

function binding() {
  let principal = 'connection-a';
  const session: AgentSession = {
    id: createAgentId('agent-host-identity'),
    workspaceId: workspace.id,
    backendSessionId: null,
    name: 'Host agent',
    provider: 'codex',
    model: 'host-default-model',
    status: AgentStatus.Idle,
    messages: [],
    createdAt: '2026-10-15T00:00:00Z',
    updatedAt: '2026-10-15T00:00:00Z',
  };
  const runtime = {
    isBackend: false,
    getPrincipalContext: () => principal,
    getActiveProviderId: vi.fn<AgentFactoryRuntime['getActiveProviderId']>(() => null),
    getProviderAvailability: vi.fn(() => ({
      hasCheckedOnce: true,
      availableEnabledProviderIds: ['codex'],
    })),
    isHostMember: () => false,
    getWorkspaceContext: vi.fn<AgentFactoryRuntime['getWorkspaceContext']>(async () => undefined),
    create: vi.fn<AgentFactoryRuntime['create']>(async () => session),
    sendMessage: vi.fn<AgentFactoryRuntime['sendMessage']>(async () => ({
      success: true,
      queued: false,
      messageId: 'message-host-identity',
    })),
    toImageReferenceBlocks: vi.fn<AgentFactoryRuntime['toImageReferenceBlocks']>(
      async (_workspaceId, blocks) => blocks,
    ),
    upsertSession: vi.fn<AgentFactoryRuntime['upsertSession']>(),
    addMessage: vi.fn<AgentFactoryRuntime['addMessage']>(),
    setAgentStreaming: vi.fn<AgentFactoryRuntime['setAgentStreaming']>(),
  } satisfies AgentFactoryRuntime;
  return {
    runtime,
    session,
    factory: new AgentFactoryCore(runtime),
    retire: () => {
      principal = 'connection-b';
    },
  };
}

beforeEach(() => agentCircuitBreaker.removeWorkspace(workspace.id));

describe('runtime-bound canonical agent creation', () => {
  it('keeps canonical naming, metadata, daemon defaults and one optimistic/wire message identity', async () => {
    const { factory, runtime } = binding();
    const context = {
      openPanels: [{ type: 'note', title: 'Spec', id: 'spec' }],
      linkedReferences: [],
    };
    runtime.getWorkspaceContext.mockResolvedValue(context);
    const result = await factory.createAgent(workspace, {
      workspaceId: workspace.id,
      id: 'agent-optimistic-only',
      initialMessage: ' Please explain the code. ',
      appMessageId: 'app_msg_first',
      nameExplicitlySet: false,
      isBackground: false,
      metadata: { specialist: 'implementor', isBackground: true },
      rememberSpecialist: true,
      behaviorPrompt: 'Follow the task',
      placement: { target: 'local', checkout: 'isolated' },
    });

    expect(runtime.create).toHaveBeenCalledExactlyOnceWith(
      {
        placement: { target: 'local', checkout: 'isolated' },
        workspaceId: workspace.id,
        workspacePath: '/repo/worktree',
        name: 'Explain the code',
        nameExplicitlySet: false,
        model: undefined,
        provider: undefined,
        reasoningEffort: undefined,
        agentType: undefined,
        prompt: 'Follow the task',
        specialist: 'implementor',
        rememberSpecialist: true,
        metadata: {
          agentType: undefined,
          specialist: 'implementor',
          isBackground: true,
          source: 'api',
        },
        workspaceContext: context,
      },
      expect.any(Function),
    );
    expect(result).toMatchObject({
      success: true,
      agentId: 'agent-host-identity',
      agent: { provider: 'codex', model: 'host-default-model', isBackground: false },
    });
    expect(runtime.upsertSession).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'agent-host-identity' }),
    );
    expect(runtime.addMessage).toHaveBeenCalledWith(
      'agent-host-identity',
      expect.objectContaining({
        appMessageId: 'app_msg_first',
        role: 'user',
        contentBlocks: [{ type: 'text', text: 'Please explain the code.' }],
      }),
    );
    expect(runtime.sendMessage).toHaveBeenCalledExactlyOnceWith({
      agentId: 'agent-host-identity',
      workspaceId: workspace.id,
      content: 'Please explain the code.',
      contextReferences: [],
      imageBlocks: [],
      userAppMessageId: 'app_msg_first',
    });
    expect(runtime.upsertSession.mock.invocationCallOrder[0]).toBeLessThan(
      runtime.addMessage.mock.invocationCallOrder[0],
    );
    expect(runtime.addMessage.mock.invocationCallOrder[0]).toBeLessThan(
      runtime.sendMessage.mock.invocationCallOrder[0],
    );
  });

  it('coalesces repeated activation within the runtime but separates replacement authority', async () => {
    const { factory, runtime, session, retire } = binding();
    const response = Promise.withResolvers<AgentSession>();
    runtime.create.mockReturnValueOnce(response.promise);
    const config = { workspaceId: workspace.id };
    const first = factory.createAgent(workspace, config, 'new-conversation');
    expect(factory.createAgent(workspace, config, 'new-conversation')).toBe(first);
    await vi.waitFor(() => expect(runtime.create).toHaveBeenCalledTimes(1));
    retire();
    const replacement = factory.createAgent(workspace, config, 'new-conversation');
    expect(replacement).not.toBe(first);
    await expect(replacement).resolves.toMatchObject({ success: true });
    response.resolve(session);
    await expect(first).resolves.toMatchObject({ success: false });
    expect(runtime.create).toHaveBeenCalledTimes(2);
    expect(runtime.upsertSession).toHaveBeenCalledTimes(1);
  });

  it('stops before agent.create if authority retires during context loading', async () => {
    const { factory, runtime, retire } = binding();
    const context = Promise.withResolvers<UnifiedAgentConfig['workspaceContext']>();
    runtime.getWorkspaceContext.mockReturnValue(context.promise);
    const result = factory.createAgent(workspace, { workspaceId: workspace.id });
    await vi.waitFor(() => expect(runtime.getWorkspaceContext).toHaveBeenCalledOnce());
    retire();
    context.resolve(undefined);
    await expect(result).resolves.toMatchObject({ success: false });
    expect(runtime.create).not.toHaveBeenCalled();
    expect(runtime.upsertSession).not.toHaveBeenCalled();
  });

  it('does not publish a late create acknowledgement or send its initial prompt', async () => {
    const { factory, runtime, session, retire } = binding();
    const response = Promise.withResolvers<AgentSession>();
    runtime.create.mockReturnValue(response.promise);
    const result = factory.createAgent(workspace, {
      workspaceId: workspace.id,
      initialMessage: 'Hello',
    });
    await vi.waitFor(() => expect(runtime.create).toHaveBeenCalledOnce());
    retire();
    response.resolve(session);
    await expect(result).resolves.toMatchObject({ success: false, creationUncertain: true });
    expect(runtime.upsertSession).not.toHaveBeenCalled();
    expect(runtime.addMessage).not.toHaveBeenCalled();
    expect(runtime.sendMessage).not.toHaveBeenCalled();
  });

  it('passes a live retirement check to image placement and stops the prompt after retirement', async () => {
    const { factory, runtime, retire } = binding();
    const images = Promise.withResolvers<NonNullable<UnifiedAgentConfig['imageBlocks']>>();
    runtime.toImageReferenceBlocks.mockReturnValue(images.promise);
    await factory.createAgent(workspace, {
      workspaceId: workspace.id,
      initialMessage: 'Inspect this',
      imageBlocks: [{ type: 'image', data: 'aGVsbG8=', mimeType: 'image/png' }],
    });
    const isCurrent = runtime.toImageReferenceBlocks.mock.calls[0][2];
    expect(isCurrent()).toBe(true);
    retire();
    expect(isCurrent()).toBe(false);
    images.resolve([{ type: 'image', attachmentId: 'attachment-host-identity' }]);
    await images.promise;
    expect(runtime.sendMessage).not.toHaveBeenCalled();
  });

  it('sends an image-only initial prompt using attachment references and the caller message identity', async () => {
    const { factory, runtime } = binding();
    runtime.toImageReferenceBlocks.mockResolvedValue([
      { type: 'image', attachmentId: 'attachment-host-identity' },
    ]);
    const images = [{ type: 'image' as const, data: 'aGVsbG8=', mimeType: 'image/png' }];
    await factory.createAgent(workspace, {
      workspaceId: workspace.id,
      imageBlocks: images,
      appMessageId: 'app_msg_image',
    });
    await vi.waitFor(() => expect(runtime.sendMessage).toHaveBeenCalledOnce());
    expect(runtime.toImageReferenceBlocks).toHaveBeenCalledWith(
      workspace.id,
      images,
      expect.any(Function),
    );
    expect(runtime.addMessage).toHaveBeenCalledWith(
      'agent-host-identity',
      expect.objectContaining({ appMessageId: 'app_msg_image', contentBlocks: images }),
    );
    expect(runtime.sendMessage).toHaveBeenCalledExactlyOnceWith({
      agentId: 'agent-host-identity',
      workspaceId: workspace.id,
      content: '',
      contextReferences: [],
      imageBlocks: [{ type: 'image', attachmentId: 'attachment-host-identity' }],
      userAppMessageId: 'app_msg_image',
    });
  });

  it('sends context-only initial prompts instead of dropping them as empty text', async () => {
    const { factory, runtime } = binding();
    const contextReferences = [{ type: 'note', id: 'spec', title: 'Task spec' }];
    await factory.createAgent(workspace, { workspaceId: workspace.id, contextReferences });
    expect(runtime.sendMessage).toHaveBeenCalledExactlyOnceWith({
      agentId: 'agent-host-identity',
      workspaceId: workspace.id,
      content: expect.stringMatching(/\S/),
      contextReferences,
      imageBlocks: [],
      userAppMessageId: expect.stringMatching(/^app_msg_/),
    });
    expect(runtime.addMessage).toHaveBeenCalledWith(
      'agent-host-identity',
      expect.objectContaining({ metadata: { contextReferences } }),
    );
  });

  it.each([
    new BackendError({ code: 'FORBIDDEN', rpcCode: -32003, message: 'Host refused creation' }),
    new Error('Connection lost after request'),
  ])('preserves the exact error cause without retrying creation: %s', async (cause) => {
    const { factory, runtime } = binding();
    runtime.create.mockRejectedValue(cause);
    const result = await factory.createAgent(workspace, { workspaceId: workspace.id });
    expect(result).toMatchObject({ success: false, error: cause.message });
    expect(result.cause).toBe(cause);
    expect(runtime.create).toHaveBeenCalledOnce();
    expect(runtime.upsertSession).not.toHaveBeenCalled();
    expect(runtime.sendMessage).not.toHaveBeenCalled();
  });

  it('retains the circuit breaker before any runtime create request', async () => {
    const { factory, runtime } = binding();
    for (let index = 0; index < 30; index++)
      agentCircuitBreaker.recordAgentStart(workspace.id, `agent-${index}`);
    const result = await factory.createAgent(workspace, { workspaceId: workspace.id });
    expect(result.success).toBe(false);
    expect(runtime.create).not.toHaveBeenCalled();
  });

  it('uses current provider availability while leaving specialist resolution to the host', async () => {
    const { factory, runtime } = binding();
    runtime.getActiveProviderId.mockReturnValue('claude-code');
    const refused = await factory.createAgent(workspace, { workspaceId: workspace.id });
    expect(refused.success).toBe(false);
    expect(runtime.create).not.toHaveBeenCalled();
    runtime.getProviderAvailability.mockReturnValue({
      hasCheckedOnce: false,
      availableEnabledProviderIds: [],
    });
    await expect(
      factory.createAgent(workspace, { workspaceId: workspace.id }),
    ).resolves.toMatchObject({ success: true });
    expect(runtime.create).toHaveBeenLastCalledWith(
      expect.objectContaining({ provider: 'claude-code', model: undefined }),
      expect.any(Function),
    );
    runtime.getProviderAvailability.mockReturnValue({
      hasCheckedOnce: true,
      availableEnabledProviderIds: [],
    });
    await expect(
      factory.createAgent(workspace, {
        workspaceId: workspace.id,
        metadata: { specialist: 'implementor' },
      }),
    ).resolves.toMatchObject({ success: true });
    expect(runtime.create).toHaveBeenLastCalledWith(
      expect.objectContaining({ provider: undefined, model: undefined, specialist: 'implementor' }),
      expect.any(Function),
    );
  });
});
