// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getItems } from '@themislib/themis/utils/collections/collection-utils';
import type { StoreState } from '$store/renderer/types';
import { annotationReducer } from '$store/renderer/slices/annotation/annotation-slice';
import { initialState as providerCatalog } from '$store/renderer/slices/provider-catalog/provider-catalog-slice';
import { initialState as specialists } from '$store/renderer/slices/specialists/specialists-slice';
import { initialState as githubAuth } from '$store/renderer/slices/github-auth/github-auth-slice';
import { withHostPrincipal } from '../../test/fixtures/principal-state';
import { selectPrincipalActionContext } from '$store/renderer/slices/principal/principal-selectors';
import { agentCircuitBreaker } from '$shared/services/agent-circuit-breaker';
import { CHIEF_WORKSPACE_ID } from '$shared/types/branded-ids';
import { CHIEF_SPECIALIST_ID } from '$shared/chief-agent-config';
import { BackendError } from '$lib/client/live/backend-transport-types';
import { resolveAnnotationRecipient, submitAnnotation } from './annotation-submit-service';
import { NEW_ASSISTANT_RECIPIENT, type AnnotationSubmission } from './annotation-types';

const fixture = vi.hoisted(() => ({
  state: {} as StoreState,
  dispatch: vi.fn(),
  transport: {
    request: vi.fn<(method: string, params?: unknown) => Promise<unknown>>(),
    observeNodeCapabilities: vi.fn<() => Promise<unknown>>(),
  },
}));

vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');
  return createAppStoreMockModule({
    state: () => fixture.state,
    dispatch: fixture.dispatch,
  });
});

// Keep backendRequest and its placement/admission observation path real. Never
// instantiate an Electron/WebSocket transport, even when run beside a live app.
vi.mock('$lib/client/live/backend-transport-factory', () => ({
  resolveBackendTransport: () => fixture.transport,
}));
vi.mock('$lib/client/live/electron-ipc-transport', () => ({ electronAPI: () => undefined }));
vi.mock('$lib/electron-bridge', () => ({
  invoke: () => {
    throw new Error('Unexpected native invocation in isolated annotation test');
  },
}));
vi.mock('$lib/client', async () => {
  const { LiveAgentsClient } = await import('$lib/client/live/live-agents-client');
  return { appClient: { agents: new LiveAgentsClient() } };
});
vi.mock('$features/layout/panel-layout-adapter', () => ({
  hasPanelLayoutManager: () => false,
  getPanelLayoutManager: () => {
    throw new Error('Annotation must not initialize workspace panels');
  },
}));

const createdAgent = {
  id: 'agent-11111111-1111-4111-8111-111111111111',
  workspaceId: CHIEF_WORKSPACE_ID,
  name: 'Assistant',
  status: 'idle',
  provider: 'codex',
  model: 'fixture-model',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

function submission(): AnnotationSubmission {
  return {
    messageId: crypto.randomUUID(),
    sourceWorkspaceId: 'annotation-source',
    sourceWorkspaceTitle: 'Source workspace',
    recipient: {
      id: NEW_ASSISTANT_RECIPIENT,
      agentId: null,
      workspaceId: CHIEF_WORKSPACE_ID,
      name: 'New Assistant conversation',
      kind: 'assistant',
    },
    message: 'Please inspect this captured frame.',
    frames: [
      { id: 'frame-a', imageDataUrl: 'data:image/png;base64,AA==', elapsedMs: 20, pins: [] },
    ],
  };
}

function methods(): string[] {
  return fixture.transport.request.mock.calls.map(([method]) => method);
}

async function scriptedRequest(method: string): Promise<unknown> {
  switch (method) {
    case 'agent.list':
      return { agents: [] };
    case 'specialist.get':
      return { specialist: { id: CHIEF_SPECIALIST_ID } };
    case 'workspace.get':
      // Positive control explicitly supplies this policy read. The refusal case
      // below injects a workspace-read error; it does not describe the daemon.
      return { workspace: { id: CHIEF_WORKSPACE_ID } };
    case 'agent.create':
    case 'agent.get':
      return { agent: createdAgent };
    case 'agent.sendMessage':
      return { success: true };
    default:
      throw new Error(`Unexpected isolated transport method: ${method}`);
  }
}

function expectEvidenceRetained(input: AnnotationSubmission): void {
  const remembered = fixture.state.annotation.submission;
  expect(remembered?.messageId).toBe(input.messageId);
  expect(remembered?.message).toBe(input.message);
  expect(getItems(remembered!.frames)).toEqual(input.frames);
  expect(fixture.state.annotation.createdRecipient).toBeNull();
  expect(fixture.state.annotation.preparedDelivery).toBeNull();
  expect(methods()).not.toContain('agent.sendMessage');
}

describe('annotation New Assistant through the real creation and placement chain', () => {
  beforeEach(() => {
    agentCircuitBreaker.removeWorkspace(CHIEF_WORKSPACE_ID);
    fixture.dispatch.mockReset();
    fixture.transport.request.mockReset().mockImplementation(scriptedRequest);
    fixture.transport.observeNodeCapabilities.mockReset().mockResolvedValue({
      server: { capabilities: { agentNodes: 1, localNodeIsolation: 1 } },
    });
    fixture.state = withHostPrincipal({
      connections: { windowBackendId: 'isolated-remote', activeId: 'local' },
      daemonHealth: { connectionGeneration: 7 },
      workspaceEvents: { subscriptionGeneration: 3 },
      annotation: annotationReducer.initialState,
      githubAuth,
      specialists,
      providerCatalog: {
        ...providerCatalog,
        byWorkspaceId: {
          [CHIEF_WORKSPACE_ID]: {
            catalog: { providers: [] },
            readiness: {},
            specialists: [],
            settings: [
              ['model.defaultProvider', 'codex'],
              ['model.default', 'fixture-model'],
            ].map(([path, value]) => ({
              path,
              value,
              label: path,
              description: '',
              category: 'model',
              type: 'string',
            })),
          },
        },
      },
    });
    fixture.dispatch.mockImplementation((action) => {
      fixture.state = {
        ...fixture.state,
        annotation: annotationReducer(fixture.state.annotation, action),
      };
    });
    expect(selectPrincipalActionContext.select(fixture.state)).not.toBeNull();
  });

  it('uses the daemon-assigned CHIEF agent and sends one captured frame after creation', async () => {
    const input = submission();
    input.recipient = await resolveAnnotationRecipient(
      { workspaceId: CHIEF_WORKSPACE_ID, workspaceTitle: 'Assistant', agentId: null },
      input.messageId,
    );
    await submitAnnotation(input);
    expect(methods()).toEqual([
      'agent.list',
      'specialist.get',
      'workspace.get',
      'agent.create',
      'agent.get',
      'agent.sendMessage',
    ]);
    expect(fixture.transport.request).toHaveBeenCalledWith('specialist.get', {
      id: CHIEF_SPECIALIST_ID,
      workspaceId: CHIEF_WORKSPACE_ID,
      workspacePath: '/tmp',
    });
    expect(fixture.transport.request).toHaveBeenCalledWith(
      'agent.create',
      expect.objectContaining({
        workspaceId: CHIEF_WORKSPACE_ID,
        specialistId: CHIEF_SPECIALIST_ID,
        provider: 'codex',
        model: 'fixture-model',
        idempotencyKey: expect.any(String),
      }),
      undefined,
    );
    const send = fixture.transport.request.mock.calls.find(
      ([method]) => method === 'agent.sendMessage',
    )![1];
    expect(send).toMatchObject({
      agentId: createdAgent.id,
      workspaceId: CHIEF_WORKSPACE_ID,
      messageId: input.messageId,
      imageBlocks: [{ type: 'image', mimeType: 'image/png', data: 'AA==' }],
      messageMetadata: { type: 'screen_feedback', sourceWorkspaceId: input.sourceWorkspaceId },
    });
    expect(fixture.state.annotation.createdRecipient?.agentId).toBe(createdAgent.id);
  });

  it('retains evidence when capability bootstrap is unavailable, before any creation RPC', async () => {
    const input = submission();
    fixture.transport.observeNodeCapabilities.mockRejectedValue(
      new Error('fixture-bootstrap-unavailable'),
    );
    await expect(submitAnnotation(input)).rejects.toMatchObject({
      message: 'fixture-bootstrap-unavailable',
      uncertain: true,
    });
    expect(methods()).toEqual([]);
    expectEvidenceRetained(input);
  });

  it('preserves a definitive host admission refusal without sending or claiming delivery uncertainty', async () => {
    const input = submission();
    fixture.transport.observeNodeCapabilities.mockRejectedValue(
      new BackendError({
        code: 'FORBIDDEN',
        rpcCode: -32003,
        message: 'fixture-host-admission-required',
      }),
    );
    await expect(submitAnnotation(input)).rejects.toMatchObject({
      message: 'fixture-host-admission-required',
      uncertain: false,
    });
    expect(methods()).toEqual([]);
    expectEvidenceRetained(input);
  });

  it('localizes a virtual CHIEF workspace refusal to placement lookup, before agent.create', async () => {
    const input = submission();
    fixture.transport.request.mockImplementation(async (method) => {
      if (method === 'workspace.get')
        throw new BackendError({
          code: 'NOT_FOUND',
          rpcCode: -32602,
          message: 'fixture-workspace-read-refused',
        });
      return scriptedRequest(method);
    });
    await expect(submitAnnotation(input)).rejects.toMatchObject({
      message: 'fixture-workspace-read-refused',
      uncertain: false,
    });
    expect(methods()).toEqual(['specialist.get', 'workspace.get']);
    expect(fixture.transport.request).toHaveBeenCalledWith('workspace.get', {
      workspaceId: CHIEF_WORKSPACE_ID,
    });
    expectEvidenceRetained(input);
  });

  it('leaves cold provider/model settings to daemon defaults', async () => {
    const input = submission();
    fixture.state = { ...fixture.state, providerCatalog };
    await submitAnnotation(input);
    const create = fixture.transport.request.mock.calls.find(
      ([method]) => method === 'agent.create',
    )![1] as Record<string, unknown>;
    expect(create).not.toHaveProperty('provider');
    expect(create).not.toHaveProperty('model');
    expect(create.specialistId).toBe(CHIEF_SPECIALIST_ID);
    expect(methods().filter((method) => method === 'agent.sendMessage')).toHaveLength(1);
  });
});
