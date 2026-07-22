/**
 * Agent Stream Lifecycle Integration Tests
 *
 * Covers the sendMessage pipeline. Streaming arrives via the daemon events
 * bridge (events.subscribe → Redux) — sendMessage must not register any
 * per-agent `agent:stream:${id}` Electron listener.
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
vi.mock('$shared/types/agent-session', () => ({
  AgentActivationState: { ACTIVE: 'active', ACTIVATING: 'activating' },
}));
vi.mock('$features/agent/services/performance-optimizer', () => ({
  performanceOptimizer: { track: vi.fn((_k: string, fn: () => any) => fn()) },
}));
vi.mock('../browser', () => ({
  errorBoundary: { wrap: vi.fn((fn: any) => fn()) },
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

import { errorBoundary } from '../browser';
import { errorRecovery } from '../browser/services/error-recovery.service';
import {
  restoreAgentSessionRequested,
  saveAgentSessionRequested,
} from '$store/renderer/slices/workspace-agents/workspace-agents-slice';
import { sendMessage } from '../agent-stream-lifecycle';

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
    vi.clearAllMocks();
    mocks.reduxDispatch.mockClear();
    setupWindow();
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
    vi.useRealTimers();
    delete (global as any).window;
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
