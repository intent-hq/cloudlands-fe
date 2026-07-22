/**
 * Agent Stream Lifecycle Integration Tests
 *
 * Focuses on the Wave 2 Redux lifecycle dispatch path. Runtime stream
 * lifecycle delivery should no longer emit dynamic `agent:stream:${sessionId}`
 * window events for legacy service delivery.
 */

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

const mocks = vi.hoisted(() => ({
  reduxDispatch: vi.fn(),
  backendRequest: vi.fn(),
  ipcHandlers: [] as Array<{ channel: string; handler: (data: any) => void }>,
  rafCallbacks: new Map<number, (timestamp: number) => void>(),
  nextRafId: 1,
}));

vi.mock(
  '$lib/electron-bridge',
  async () => await import('$store/renderer/utils/test-helpers/electron-bridge-mock'),
);
vi.mock('$lib/client/live/backend-transport', () => ({
  backendRequest: mocks.backendRequest,
}));
vi.mock(
  '$lib/utils/client-logger',
  async () => await import('$store/renderer/utils/test-helpers/client-logger-mock'),
);
vi.mock('$shared/types/branded-ids', () => ({
  createMessageId: (id: string) => id,
  WorkspaceId: (id: string) => id,
}));
vi.mock('$shared/types', () => ({
  AgentStatus: { Active: 'active', Idle: 'idle' },
  normalizeContentBlocks: (blocks: any[]) => blocks,
}));
vi.mock('$shared/utils/content-block-utils', () => ({
  buildOrderedContentBlocks: vi.fn(() => [{ type: 'text', text: 'built' }]),
}));
vi.mock('$shared/types/agent-session', () => ({
  AgentActivationState: { ACTIVE: 'active', ACTIVATING: 'activating' },
}));
vi.mock('$features/agent/services/performance-optimizer', () => ({
  performanceOptimizer: { track: vi.fn((_k: string, fn: () => any) => fn()) },
}));
vi.mock('../browser', () => ({
  errorBoundary: { wrap: vi.fn((fn: any) => fn()) },
}));
vi.mock('$store/renderer/slices/chat-state/chat-state-slice', () => ({
  streamStatusReceived: vi.fn((...payload: any[]) => ({
    type: 'chatState/streamStatusReceived',
    payload,
  })),
}));
vi.mock('$store/renderer/slices/workspace-agents/workspace-agents-slice', () => ({
  activateAgentRequested: vi.fn((...payload: any[]) => ({
    type: 'workspaceAgents/activateAgentRequested',
    payload,
  })),
  agentStreamResetStreamingMessagesRequested: vi.fn((payload: any) => ({
    type: 'workspaceAgents/agentStreamResetStreamingMessagesRequested',
    payload: [payload],
  })),
  agentStreamUpdateReceived: vi.fn((payload: any) => ({
    type: 'workspaceAgents/agentStreamUpdateReceived',
    payload: [payload],
  })),
  backendStreamsReconnectResultReceived: vi.fn((...payload: any[]) => ({
    type: 'workspaceAgents/backendStreamsReconnectResultReceived',
    payload,
  })),
  restoreAgentSessionRequested: vi.fn((...payload: any[]) => ({
    type: 'workspaceAgents/restoreAgentSessionRequested',
    payload,
  })),
  saveAgentSessionRequested: vi.fn((...payload: any[]) => ({
    type: 'workspaceAgents/saveAgentSessionRequested',
    payload,
  })),
  triggerStreamingSafetyCheck: vi.fn((...payload: any[]) => ({
    type: 'workspaceAgents/triggerStreamingSafetyCheck',
    payload,
  })),
}));
vi.mock('$store/renderer/slices/agent-session/agent-session-slice', () => ({
  addMessage: vi.fn((...payload: any[]) => ({ type: 'agentSession/addMessage', payload })),
  setAgentStreaming: vi.fn((...payload: any[]) => ({
    type: 'agentSession/setAgentStreaming',
    payload,
  })),
  upsertSession: vi.fn((...payload: any[]) => ({ type: 'agentSession/upsertSession', payload })),
}));
vi.mock('../browser/services/error-recovery.service', () => ({
  errorRecovery: { executeWithRecovery: vi.fn() },
  DEFAULT_STRATEGIES: {},
}));
vi.mock('$shared/constants/agent-streaming', () => ({
  AGENT_STREAMING_CONFIG: {},
  IN_FLIGHT_PROMPT_DROPPED_ERROR: 'Agent already has an in-flight prompt. Message was not delivered.',
}));
vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } = await import('$store/renderer/utils/test-helpers/store-mock');

  return createAppStoreMockModule({
    state: () => vi.fn(),
    dispatch: mocks.reduxDispatch,
  });
});
vi.mock('$features/agent/services/error-handler', () => ({
  errorHandler: { handleError: vi.fn(), track: vi.fn() },
  AgentError: class extends Error {},
  ErrorCode: { MESSAGE_SEND_FAILED: 'MESSAGE_SEND_FAILED' },
  ErrorCategory: { COMMUNICATION: 'COMMUNICATION' },
  ErrorSeverity: { HIGH: 'HIGH' },
}));
vi.mock('$store/renderer/slices/workspace/utils/workspace-metrics', () => ({
  workspaceMetrics: { incrementMessageSent: vi.fn() },
}));
vi.mock('../utils/streaming-invariants', () => ({
  assertStreamingInvariant: vi.fn(),
}));

import { buildOrderedContentBlocks } from '$shared/utils/content-block-utils';
import { errorBoundary } from '../browser';
import { errorRecovery } from '../browser/services/error-recovery.service';
import {
  restoreAgentSessionRequested,
  saveAgentSessionRequested,
} from '$store/renderer/slices/workspace-agents/workspace-agents-slice';
import { ensureStreamHandler, sendMessage } from '../agent-stream-lifecycle';
import {
  cleanupStreamHandler,
  cleanupPreviousHmrState,
  disposeAllStreamState,
  persistForHmr,
} from '../utils/stream-handler-registry';

function setupWindow() {
  mocks.ipcHandlers = [];
  mocks.rafCallbacks.clear();
  mocks.nextRafId = 1;
  (global as any).window = {
    electronAPI: {
      on: vi.fn((channel: string, handler: (data: any) => void) => {
        mocks.ipcHandlers.push({ channel, handler });
        return `listener:${channel}`;
      }),
      off: vi.fn(),
      offById: vi.fn(),
      removeAllListeners: vi.fn(),
      invoke: vi.fn(),
      send: vi.fn(),
    },
    dispatchEvent: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    requestAnimationFrame: vi.fn((callback: (timestamp: number) => void) => {
      const id = mocks.nextRafId++;
      mocks.rafCallbacks.set(id, callback);
      return id;
    }),
    cancelAnimationFrame: vi.fn((id: number) => {
      mocks.rafCallbacks.delete(id);
    }),
  };
  (global as any).requestAnimationFrame = (global as any).window.requestAnimationFrame;
  (global as any).cancelAnimationFrame = (global as any).window.cancelAnimationFrame;
}

function flushAnimationFrames() {
  const callbacks = Array.from(mocks.rafCallbacks.values());
  mocks.rafCallbacks.clear();
  for (const callback of callbacks) callback(Date.now());
}

describe('Agent Stream Lifecycle Integration', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mocks.reduxDispatch.mockClear();
    setupWindow();
    vi.mocked(buildOrderedContentBlocks).mockClear();
    vi.mocked(errorBoundary.wrap).mockImplementation((fn: any) => fn());
    vi.mocked(errorRecovery.executeWithRecovery).mockImplementation(async (operation: any) => ({
      success: true,
      data: await operation(),
      attempts: 1,
      totalTime: 0,
    }));
    vi.mocked(saveAgentSessionRequested).mockImplementation((...payload: any[]) => ({
      type: 'workspaceAgents/saveAgentSessionRequested',
      payload,
      promise: Promise.resolve(),
    }));
  });

  afterEach(() => {
    disposeAllStreamState();
    vi.useRealTimers();
    delete (global as any).requestAnimationFrame;
    delete (global as any).cancelAnimationFrame;
    delete (global as any).window;
  });

  it('restored chunk handling coalesces canonical agent stream updates until animation frame', () => {
    ensureStreamHandler('agent-1', {
      workspaceId: 'ws-1',
      assistantAppMessageId: 'app-msg-1',
    });
    const streamHandler = mocks.ipcHandlers.find(
      (entry) => entry.channel === 'agent:stream:agent-1',
    )?.handler;

    streamHandler?.({ type: 'chunk', data: 'Hello', streamId: 'stream-1' });
    streamHandler?.({ type: 'chunk', data: ' world', streamId: 'stream-1' });

    expect(mocks.reduxDispatch).not.toHaveBeenCalled();
    flushAnimationFrames();

    expect(window.dispatchEvent).not.toHaveBeenCalled();
    expect(mocks.reduxDispatch.mock.calls.map(([action]) => action.type)).toEqual([
      'workspaceAgents/agentStreamUpdateReceived',
    ]);
    expect(mocks.reduxDispatch.mock.calls[0][0].payload[0]).toMatchObject({
      eventType: 'chunk',
      workspaceId: 'ws-1',
      agentId: 'agent-1',
      handlerSessionId: 'agent-1',
      chunk: 'Hello world',
      source: 'restored',
      streamId: 'stream-1',
    });
    expect(buildOrderedContentBlocks).toHaveBeenCalledWith([], 'Hello world');
  });

  it('restored completion flushes a pending chunk before the complete update', () => {
    ensureStreamHandler('agent-flush', {
      workspaceId: 'ws-1',
      assistantAppMessageId: 'app-msg-flush',
    });
    const streamHandler = mocks.ipcHandlers.find(
      (entry) => entry.channel === 'agent:stream:agent-flush',
    )?.handler;

    streamHandler?.({ type: 'chunk', data: 'Hello', streamId: 'stream-flush' });
    streamHandler?.({
      type: 'complete',
      streamId: 'stream-flush',
      finishReason: 'end_turn',
      message: { id: 'msg-flush', appMessageId: 'app-msg-flush' },
    });

    const payloads = mocks.reduxDispatch.mock.calls.map(([action]) => action.payload[0]);
    expect(payloads.map((payload) => payload.eventType)).toEqual(['chunk', 'complete']);
    expect(payloads[0]).toMatchObject({ chunk: 'Hello', streamId: 'stream-flush' });
    expect(window.cancelAnimationFrame).toHaveBeenCalled();
    flushAnimationFrames();
    expect(mocks.reduxDispatch).toHaveBeenCalledTimes(2);
  });

  it('restored cleanup cancels a pending coalesced chunk without dispatching it', () => {
    ensureStreamHandler('agent-cleanup', {
      workspaceId: 'ws-1',
      assistantAppMessageId: 'app-msg-cleanup',
    });
    const streamHandler = mocks.ipcHandlers.find(
      (entry) => entry.channel === 'agent:stream:agent-cleanup',
    )?.handler;

    streamHandler?.({ type: 'chunk', data: 'stale', streamId: 'stream-cleanup' });
    cleanupStreamHandler('agent-cleanup');
    flushAnimationFrames();

    expect(window.cancelAnimationFrame).toHaveBeenCalled();
    expect(mocks.reduxDispatch).not.toHaveBeenCalled();
  });

  it('restored content-block events flush pending text before preserving ordered blocks', () => {
    ensureStreamHandler('agent-tool', {
      workspaceId: 'ws-1',
      assistantAppMessageId: 'app-msg-tool',
    });
    const streamHandler = mocks.ipcHandlers.find(
      (entry) => entry.channel === 'agent:stream:agent-tool',
    )?.handler;
    const toolBlock = { type: 'tool_use', id: 'tool-1', name: 'read', input: {} };

    streamHandler?.({ type: 'chunk', data: 'Before tool', streamId: 'stream-tool' });
    streamHandler?.({ type: 'content-blocks', data: [toolBlock], streamId: 'stream-tool' });

    const payloads = mocks.reduxDispatch.mock.calls.map(([action]) => action.payload[0]);
    expect(payloads.map((payload) => payload.eventType)).toEqual(['chunk', 'content-blocks']);
    expect(vi.mocked(buildOrderedContentBlocks).mock.calls[1][0]).toEqual([
      { type: 'text', content: 'Before tool', sequence: 0 },
      { type: 'block', content: toolBlock, sequence: 1 },
    ]);
  });

  it('sendMessage calls agent.sendMessage on the transport without registering a stream listener', async () => {
    // Streaming for sendMessage turns arrives via the daemon events bridge
    // (events.subscribe → agent:stream:*), NOT a per-agent `agent:stream:${id}`
    // Electron listener — sendMessage must not register one.
    const session = {
      id: 'agent-send',
      name: 'Agent Send',
      status: 'active',
      activationState: 'active',
      model: 'default',
      messages: [],
      metadata: {},
    };
    vi.mocked(restoreAgentSessionRequested).mockImplementation((...payload: any[]) => ({
      type: 'workspaceAgents/restoreAgentSessionRequested',
      payload,
      promise: Promise.resolve(session),
    }));
    mocks.backendRequest.mockResolvedValue({ success: true, queued: false, messageId: 'm-1' });

    await sendMessage('agent-send', 'Hello', { id: 'ws-1', path: '/tmp/ws' } as any);

    expect(mocks.backendRequest).toHaveBeenCalledTimes(1);
    expect(mocks.backendRequest).toHaveBeenCalledWith(
      'agent.sendMessage',
      expect.objectContaining({
        agentId: 'agent-send',
        workspaceId: 'ws-1',
        content: 'Hello',
      }),
    );
    expect(
      mocks.ipcHandlers.filter((entry) => entry.channel.startsWith('agent:stream:')),
    ).toHaveLength(0);
  });

  it('restored status handling dispatches status updates with timeout context', () => {
    ensureStreamHandler('agent-status', {
      workspaceId: 'ws-1',
      assistantAppMessageId: 'app-msg-status',
    });
    const streamHandler = mocks.ipcHandlers.find(
      (entry) => entry.channel === 'agent:stream:agent-status',
    )?.handler;

    streamHandler?.({ type: 'status', data: { phase: 'tool-call', message: 'Calling tool' } });
    streamHandler?.({ type: 'status', data: { phase: 'tool-waiting', message: 'Waiting' } });
    streamHandler?.({ type: 'status', data: { phase: 'connecting', message: 'Connecting' } });

    expect(mocks.reduxDispatch.mock.calls.map(([action]) => action.type)).toEqual([
      'chatState/streamStatusReceived',
      'chatState/streamStatusReceived',
      'chatState/streamStatusReceived',
    ]);
    expect(
      mocks.reduxDispatch.mock.calls
        .map(([action]) => action)
        .filter((action) => action.type === 'chatState/streamStatusReceived')
        .map((action) => action.payload[2]),
    ).toEqual([true, true, false]);
    expect(
      mocks.reduxDispatch.mock.calls
        .map(([action]) => action)
        .filter((action) => action.type === 'chatState/streamStatusReceived')
        .map((action) => action.payload[3]),
    ).toEqual([
      { sessionId: 'agent-status' },
      { sessionId: 'agent-status' },
      { sessionId: 'agent-status' },
    ]);
  });

  it('restored completion dispatches only the canonical agent stream update', () => {
    ensureStreamHandler('agent-2', {
      workspaceId: 'ws-1',
      assistantAppMessageId: 'app-msg-2',
    });
    const streamHandler = mocks.ipcHandlers.find(
      (entry) => entry.channel === 'agent:stream:agent-2',
    )?.handler;

    streamHandler?.({
      type: 'complete',
      streamId: 'stream-2',
      finishReason: 'end_turn',
      message: { id: 'msg-2', appMessageId: 'app-msg-2', metadata: { modelUnavailable: false } },
    });

    expect(window.dispatchEvent).not.toHaveBeenCalled();
    expect(mocks.reduxDispatch.mock.calls.map(([action]) => action.type)).toEqual([
      'workspaceAgents/agentStreamUpdateReceived',
    ]);
    expect(mocks.reduxDispatch.mock.calls[0][0].payload[0]).toMatchObject({
      eventType: 'complete',
      workspaceId: 'ws-1',
      agentId: 'agent-2',
      handlerSessionId: 'agent-2',
      source: 'restored',
      streamId: 'stream-2',
      finishReason: 'end_turn',
      completeMessage: {
        id: 'msg-2',
        appMessageId: 'app-msg-2',
        metadata: { modelUnavailable: false },
      },
    });
  });

  it('REGRESSION: backend-initiated streams register an IPC heartbeat ping handler', () => {
    // Zombie-session incident: delegated/backend-initiated agents registered
    // their stream handler via ensureStreamHandler but never a ping handler,
    // so the main process logged "missed pong" for their entire turn. The
    // heartbeat handler must be registered alongside EVERY stream handler.
    ensureStreamHandler('agent-ping', {
      workspaceId: 'ws-1',
      assistantAppMessageId: 'app-msg-ping',
    });

    const pingHandler = mocks.ipcHandlers.find(
      (entry) => entry.channel === 'agent:stream:ping:agent-ping',
    )?.handler;
    expect(pingHandler).toBeDefined();

    // Ping from main must produce a pong back over IPC
    pingHandler?.({ agentId: 'agent-ping', timestamp: Date.now() });
    expect(window.electronAPI.send).toHaveBeenCalledWith('agent:stream:pong', {
      agentId: 'agent-ping',
    });

    // Re-registration is idempotent: no duplicate ping listener (would leak
    // the old IPC listener when the registry entry is overwritten)
    ensureStreamHandler('agent-ping', {
      workspaceId: 'ws-1',
      assistantAppMessageId: 'app-msg-ping',
    });
    const pingRegistrations = mocks.ipcHandlers.filter(
      (entry) => entry.channel === 'agent:stream:ping:agent-ping',
    );
    expect(pingRegistrations).toHaveLength(1);
  });

  it('HMR cleanup disposes previous registry state through the persisted disposer', () => {
    const previousDispose = vi.fn();
    (window as any).__streamRegistry_hmr = { disposeAllStreamState: previousDispose };

    cleanupPreviousHmrState();

    expect(previousDispose).toHaveBeenCalledTimes(1);

    persistForHmr();
    expect((window as any).__streamRegistry_hmr.disposeAllStreamState).toBe(disposeAllStreamState);
  });

  it('sendMessage treats duplicate in-flight prompt responses as a benign no-op', async () => {
    const session = {
      id: 'agent-dedup',
      name: 'Agent Dedup',
      status: 'active',
      activationState: 'active',
      model: 'default',
      messages: [],
      metadata: {},
    };
    vi.mocked(restoreAgentSessionRequested).mockImplementation((...payload: any[]) => ({
      type: 'workspaceAgents/restoreAgentSessionRequested',
      payload,
      promise: Promise.resolve(session),
    }));
    mocks.backendRequest.mockResolvedValue({
      success: false,
      error: 'Agent already has an in-flight prompt. Message was not delivered.',
    });

    await expect(
      sendMessage('agent-dedup', 'Hello', { id: 'ws-1', path: '/tmp/ws' } as any),
    ).resolves.toBeUndefined();
    expect(mocks.backendRequest).toHaveBeenCalledTimes(1);
    expect(errorRecovery.executeWithRecovery).toHaveBeenCalledTimes(1);
    expect(
      mocks.reduxDispatch.mock.calls.some(
        ([action]) =>
          action.type === 'workspaceAgents/agentStreamUpdateReceived' &&
          action.payload?.[0]?.eventType === 'error',
      ),
    ).toBe(false);
  });
});
