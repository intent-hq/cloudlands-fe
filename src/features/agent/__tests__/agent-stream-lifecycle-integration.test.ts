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
  ipcHandlers: [] as Array<{ channel: string; handler: (data: any) => void }>,
}));

vi.mock(
  '$lib/electron-bridge',
  async () => await import('$store/renderer/utils/test-helpers/electron-bridge-mock'),
);
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
  agentIpcProxy: { activateAgent: vi.fn() },
  errorBoundary: { wrap: vi.fn((fn: any) => fn()) },
  persistenceService: { saveSession: vi.fn() },
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
vi.mock('$shared/constants/agent-streaming', () => ({ AGENT_STREAMING_CONFIG: {} }));
vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } = await import('$store/renderer/utils/test-helpers/store-mock');

  return createAppStoreMockModule({
    state: () => vi.fn(),
    dispatch: mocks.reduxDispatch,
  });
});
vi.mock('$lib/services/analytics', () => ({ track: vi.fn() }));
vi.mock('$features/agent/services/error-handler', () => ({
  errorHandler: { handleError: vi.fn(), track: vi.fn() },
  AgentError: class extends Error {},
  ErrorCode: { MESSAGE_SEND_FAILED: 'MESSAGE_SEND_FAILED' },
  ErrorCategory: { COMMUNICATION: 'COMMUNICATION' },
  ErrorSeverity: { HIGH: 'HIGH' },
}));
vi.mock('../../observability/event-collector-client', () => ({
  eventCollector: { track: vi.fn() },
  AgentEventType: { MESSAGE_SENT: 'MESSAGE_SENT' },
}));
vi.mock('$store/renderer/slices/workspace/utils/workspace-metrics', () => ({
  workspaceMetrics: { incrementMessageSent: vi.fn() },
}));
vi.mock('../utils/streaming-invariants', () => ({
  assertStreamingInvariant: vi.fn(),
}));

import { ensureStreamHandler } from '../agent-stream-lifecycle';
import {
  cleanupPreviousHmrState,
  disposeAllStreamState,
  persistForHmr,
} from '../utils/stream-handler-registry';

function setupWindow() {
  mocks.ipcHandlers = [];
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
  };
}

describe('Agent Stream Lifecycle Integration', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.reduxDispatch.mockClear();
    setupWindow();
  });

  afterEach(() => {
    disposeAllStreamState();
    vi.useRealTimers();
    delete (global as any).window;
  });

  it('restored chunk handling dispatches only the canonical agent stream update', () => {
    ensureStreamHandler('agent-1', {
      workspaceId: 'ws-1',
      assistantAppMessageId: 'app-msg-1',
    });
    const streamHandler = mocks.ipcHandlers.find(
      (entry) => entry.channel === 'agent:stream:agent-1',
    )?.handler;

    streamHandler?.({ type: 'chunk', data: 'Hello', streamId: 'stream-1' });

    expect(window.dispatchEvent).not.toHaveBeenCalled();
    expect(mocks.reduxDispatch.mock.calls.map(([action]) => action.type)).toEqual([
      'workspaceAgents/agentStreamUpdateReceived',
    ]);
    expect(mocks.reduxDispatch.mock.calls[0][0].payload[0]).toMatchObject({
      eventType: 'chunk',
      workspaceId: 'ws-1',
      agentId: 'agent-1',
      handlerSessionId: 'agent-1',
      chunk: 'Hello',
      source: 'restored',
      streamId: 'stream-1',
    });
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

  it('HMR cleanup disposes previous registry state through the persisted disposer', () => {
    const previousDispose = vi.fn();
    (window as any).__streamRegistry_hmr = { disposeAllStreamState: previousDispose };

    cleanupPreviousHmrState();

    expect(previousDispose).toHaveBeenCalledTimes(1);

    persistForHmr();
    expect((window as any).__streamRegistry_hmr.disposeAllStreamState).toBe(disposeAllStreamState);
  });
});
