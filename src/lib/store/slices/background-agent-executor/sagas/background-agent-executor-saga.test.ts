import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import {
  END,
  type EventChannel,
} from 'redux-saga';
import type { StoreState } from '$lib/store/types';
import {
  AgentStatus,
  type AgentMessage,
  type AgentSession,
} from '$shared/types';

const { getReduxStoreMock } = vi.hoisted(() => ({
  getReduxStoreMock: vi.fn(),
}));

vi.mock('$lib/store/redux-dispatch-bridge', () => ({
  getReduxStore: getReduxStoreMock,
}));

vi.mock('$features/agent/services/agent-factory', () => ({
  agentFactory: { createAgent: vi.fn() },
}));

vi.mock('$features/agent/agent-stream-lifecycle', () => ({
  sendMessage: vi.fn(),
}));

vi.mock('$lib/services/analytics', () => ({
  track: vi.fn(),
}));

vi.mock('$lib/utils/client-logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  }),
}));

import { createAgentStateChannel } from './background-agent-executor-saga';

type AgentStateEvent = {
  messages: AgentMessage[];
  isComplete: boolean;
  isError: boolean;
  isStreaming: boolean;
};

const agentId = 'agent-1';
const workspaceId = 'ws-1';

function makeMessage(id: string, role: AgentMessage['role'] = 'assistant'): AgentMessage {
  return {
    id,
    role,
    timestamp: '2026-05-13T00:00:00.000Z',
    contentBlocks: [{ type: 'text', text: `content-${id}` }],
  };
}

function makeSession(overrides: Partial<AgentSession> = {}) {
  const { messages = [], ...rest } = overrides;

  return {
    id: agentId as AgentSession['id'],
    backendSessionId: null,
    workspaceId: workspaceId as AgentSession['workspaceId'],
    name: 'Background Agent',
    status: AgentStatus.Active,
    createdAt: '2026-05-13T00:00:00.000Z',
    updatedAt: '2026-05-13T00:00:00.000Z',
    ...rest,
    messages,
  };
}

function makeStoreState(session: ReturnType<typeof makeSession>): StoreState {
  return {
    agentSessions: {
      byAgentId: { [agentId]: session },
      agentIdsByWorkspace: { [workspaceId]: [agentId] },
    },
  } as unknown as StoreState;
}

function createStoreHarness(initialSession: ReturnType<typeof makeSession>) {
  let state = makeStoreState(initialSession);
  const listeners = new Set<() => void>();
  const store = {
    getState: vi.fn(() => state),
    subscribe: vi.fn((listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }),
  };

  getReduxStoreMock.mockReturnValue(store);

  return {
    listeners,
    setSession(session: ReturnType<typeof makeSession>) {
      state = makeStoreState(session);
      for (const listener of [...listeners]) listener();
    },
  };
}

function collectChannelEvents(channel: EventChannel<AgentStateEvent>) {
  const events: AgentStateEvent[] = [];
  let ended = false;

  const takeNext = () => {
    channel.take((event) => {
      if (event === END) {
        ended = true;
        return;
      }
      events.push(event);
      takeNext();
    });
  };

  takeNext();

  return { events, get ended() { return ended; } };
}

describe('createAgentStateChannel', () => {
  beforeEach(() => {
    getReduxStoreMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('emits active progress while selectAgentIsResponding is true', () => {
    const harness = createStoreHarness(makeSession({ isStreaming: true }));
    const channel = createAgentStateChannel(agentId, workspaceId);
    const collected = collectChannelEvents(channel);

    harness.setSession(makeSession({ isStreaming: true, messages: [makeMessage('m1', 'user')] }));

    expect(collected.events).toHaveLength(1);
    expect(collected.events[0]).toMatchObject({
      isComplete: false,
      isError: false,
      isStreaming: true,
    });
    expect(collected.ended).toBe(false);

    channel.close();
  });

  it('completes when responding stops and messages are available', () => {
    const harness = createStoreHarness(makeSession({ isStreaming: true }));
    const channel = createAgentStateChannel(agentId, workspaceId);
    const collected = collectChannelEvents(channel);

    harness.setSession(makeSession({
      status: AgentStatus.Idle,
      isStreaming: false,
      isProcessing: false,
      isResponding: false,
      messages: [makeMessage('m1')],
    }));

    expect(collected.events).toHaveLength(1);
    expect(collected.events[0]).toMatchObject({
      isComplete: true,
      isError: false,
      isStreaming: false,
    });
    expect(collected.events[0].messages.map((message) => message.id)).toEqual(['m1']);
    expect(collected.ended).toBe(true);
  });

  it('emits explicit agent errors as terminal errors before completion', () => {
    const harness = createStoreHarness(makeSession({ isStreaming: true }));
    const channel = createAgentStateChannel(agentId, workspaceId);
    const collected = collectChannelEvents(channel);

    harness.setSession(makeSession({
      status: AgentStatus.Error,
      isStreaming: false,
      isProcessing: false,
      isResponding: false,
      messages: [makeMessage('m1')],
    }));

    expect(collected.events).toHaveLength(1);
    expect(collected.events[0]).toMatchObject({
      isComplete: false,
      isError: true,
      isStreaming: false,
    });
    expect(collected.ended).toBe(true);
  });

  it('cleans up after one terminal event and does not leave timers behind', () => {
    vi.useFakeTimers();
    const harness = createStoreHarness(makeSession({ isStreaming: true }));
    const channel = createAgentStateChannel(agentId, workspaceId);
    const collected = collectChannelEvents(channel);

    harness.setSession(makeSession({ status: AgentStatus.Idle, messages: [makeMessage('m1')] }));
    harness.setSession(makeSession({ status: AgentStatus.Idle, messages: [makeMessage('m2')] }));

    expect(collected.events).toHaveLength(1);
    expect(collected.events[0]).toMatchObject({ isComplete: true, isError: false });
    expect(collected.ended).toBe(true);
    expect(harness.listeners.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});