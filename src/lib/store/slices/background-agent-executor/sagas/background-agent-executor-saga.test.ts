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

const { stateRef, listeners, appStoreMock } = vi.hoisted(() => {
  const stateRef = { current: { agentSessions: { byAgentId: {} } } as any };
  const listeners = new Set<() => void>();
  const appStoreMock = {
    dispatch: vi.fn(),
    get state() {
      return stateRef.current;
    },
    getReadableState: vi.fn(() => ({
      subscribe: vi.fn((listener: () => void) => {
        listeners.add(listener);
        listener();
        return () => listeners.delete(listener);
      }),
    })),
  };

  return { stateRef, listeners, appStoreMock };
});

vi.mock('$lib/store/store', () => ({
  appStore: appStoreMock,
  store: appStoreMock,
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

vi.mock('svelte-sonner', () => ({
  toast: {
    error: vi.fn(),
    warning: vi.fn(),
  },
}));

import { EXECUTOR_CONFIGS } from '../background-agent-executor-types';
import { createAgentStateChannel } from './background-agent-executor-saga';

const wsId = 'ws-1';
const agentId = 'agent-1';

function makeMessageSimple(text: string): AgentMessage {
  return {
    id: 'msg-1',
    role: 'assistant',
    contentBlocks: [{ type: 'text', text }],
    timestamp: '2026-05-13T00:00:00.000Z',
  } as AgentMessage;
}

function setAgentState(status: AgentStatus, messages: AgentMessage[] = []): void {
  stateRef.current = {
    agentSessions: {
      byAgentId: {
        [agentId]: {
          id: agentId,
          workspaceId: wsId,
          status,
          messages,
        },
      },
    },
  };
}

// --- Main branch helpers (channel tests) ---

type AgentStateEvent = {
  messages: AgentMessage[];
  isComplete: boolean;
  isError: boolean;
  isStreaming: boolean;
};

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
    workspaceId: wsId as AgentSession['workspaceId'],
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
      agentIdsByWorkspace: { [wsId]: [agentId] },
    },
  } as unknown as StoreState;
}

function createStoreHarness(initialSession: ReturnType<typeof makeSession>) {
  let state = makeStoreState(initialSession);
  stateRef.current = state;
  listeners.clear();

  return {
    listeners,
    setSession(session: ReturnType<typeof makeSession>) {
      state = makeStoreState(session);
      stateRef.current = state;
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

// --- Tests ---

beforeEach(() => {
  vi.clearAllMocks();
  listeners.clear();
  stateRef.current = { agentSessions: { byAgentId: {} } };
});

describe('EXECUTOR_CONFIGS', () => {
  it('uses the extended 300s timeout for commit-message executors', () => {
    expect(EXECUTOR_CONFIGS.commit.timeout).toBe(300_000);
    expect(EXECUTOR_CONFIGS['commit-merge'].timeout).toBe(300_000);
  });
});

describe('createAgentStateChannel (initial snapshot)', () => {
  it('delivers an already-complete agent snapshot emitted during initial subscription', async () => {
    setAgentState(AgentStatus.Idle, [
      makeMessageSimple('<<<COMMIT_MESSAGE>>>fix: commit<<<\/COMMIT_MESSAGE>>>'),
    ]);

    const channel = createAgentStateChannel(agentId, wsId, 'COMMIT_MESSAGE');
    const event = await new Promise<any>((resolve) => channel.take(resolve));

    expect(event.isComplete).toBe(true);
    expect(event.messages).toHaveLength(1);
    expect(event.messages[0].id).toBe('msg-1');

    channel.close();
  });
});



describe('createAgentStateChannel', () => {
  beforeEach(() => {
    listeners.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('emits active progress while selectAgentIsResponding is true', () => {
    const harness = createStoreHarness(makeSession({ isStreaming: true }));
    const channel = createAgentStateChannel(agentId, wsId, 'COMMIT_MESSAGE');
    const collected = collectChannelEvents(channel);

    harness.setSession(makeSession({ isStreaming: true, messages: [makeMessage('m1', 'user')] }));

    // Initial processUpdate emits one event, then setSession triggers another
    expect(collected.events).toHaveLength(2);
    expect(collected.events[1]).toMatchObject({
      isComplete: false,
      isError: false,
      isStreaming: true,
    });
    expect(collected.ended).toBe(false);

    channel.close();
  });

  it('completes when responding stops and messages are available', () => {
    const harness = createStoreHarness(makeSession({ isStreaming: true }));
    const channel = createAgentStateChannel(agentId, wsId);
    const collected = collectChannelEvents(channel);

    harness.setSession(makeSession({
      status: AgentStatus.Idle,
      isStreaming: false,
      isProcessing: false,
      isResponding: false,
      messages: [makeMessage('m1')],
    }));

    // Initial processUpdate emits one event, then setSession triggers a terminal event
    expect(collected.events).toHaveLength(2);
    expect(collected.events[1]).toMatchObject({
      isComplete: true,
      isError: false,
      isStreaming: false,
    });
    expect(collected.events[1].messages.map((message) => message.id)).toEqual(['m1']);
    expect(collected.ended).toBe(true);
  });

  it('uses the idle summary as an assistant fallback when stream messages are missing', () => {
    const harness = createStoreHarness(makeSession({
      isStreaming: true,
      messages: [makeMessage('user-1', 'user')],
    }));
    const channel = createAgentStateChannel(agentId, wsId, 'COMMIT_MESSAGE');
    const collected = collectChannelEvents(channel);

    harness.setSession(makeSession({
      status: AgentStatus.Idle,
      isStreaming: false,
      isProcessing: false,
      isResponding: false,
      messages: [makeMessage('user-1', 'user')],
      lastAgentResponse: '<<<COMMIT_MESSAGE>>>fix: generated<<<\/COMMIT_MESSAGE>>>',
    }));

    expect(collected.events).toHaveLength(2);
    expect(collected.events[1]).toMatchObject({ isComplete: true, isError: false });
    expect(collected.events[1].messages.map((message) => message.role)).toEqual(['user', 'assistant']);
    expect(collected.events[1].messages[1].contentBlocks).toEqual([
      { type: 'text', text: '<<<COMMIT_MESSAGE>>>fix: generated<<<\/COMMIT_MESSAGE>>>' },
    ]);
    expect(collected.ended).toBe(true);
  });

  it('does not synthesize an assistant fallback when the expected result tag is missing', () => {
    const harness = createStoreHarness(makeSession({
      isStreaming: true,
      messages: [makeMessage('user-1', 'user')],
    }));
    const channel = createAgentStateChannel(agentId, wsId, 'COMMIT_MESSAGE');
    const collected = collectChannelEvents(channel);

    harness.setSession(makeSession({
      status: AgentStatus.Idle,
      isStreaming: false,
      isProcessing: false,
      isResponding: false,
      messages: [makeMessage('user-1', 'user')],
      lastAgentResponse: 'Generated a normal summary without the requested tag.',
    }));

    expect(collected.events).toHaveLength(2);
    expect(collected.events[1]).toMatchObject({ isComplete: true, isError: false });
    expect(collected.events[1].messages.map((message) => message.role)).toEqual(['user']);
    expect(collected.ended).toBe(true);
  });

  it('emits explicit agent errors as terminal errors before completion', () => {
    const harness = createStoreHarness(makeSession({ isStreaming: true }));
    const channel = createAgentStateChannel(agentId, wsId);
    const collected = collectChannelEvents(channel);

    harness.setSession(makeSession({
      status: AgentStatus.Error,
      isStreaming: false,
      isProcessing: false,
      isResponding: false,
      messages: [makeMessage('m1')],
    }));

    // Initial processUpdate emits one event, then setSession triggers a terminal error event
    expect(collected.events).toHaveLength(2);
    expect(collected.events[1]).toMatchObject({
      isComplete: false,
      isError: true,
      isStreaming: false,
    });
    expect(collected.ended).toBe(true);
  });

  it('cleans up after one terminal event and does not leave timers behind', () => {
    vi.useFakeTimers();
    const harness = createStoreHarness(makeSession({ isStreaming: true }));
    const channel = createAgentStateChannel(agentId, wsId);
    const collected = collectChannelEvents(channel);

    harness.setSession(makeSession({ status: AgentStatus.Idle, messages: [makeMessage('m1')] }));
    harness.setSession(makeSession({ status: AgentStatus.Idle, messages: [makeMessage('m2')] }));

    // Initial processUpdate emits one event, then first setSession triggers terminal, second is ignored
    expect(collected.events).toHaveLength(2);
    expect(collected.events[1]).toMatchObject({ isComplete: true, isError: false });
    expect(collected.ended).toBe(true);
    expect(harness.listeners.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});