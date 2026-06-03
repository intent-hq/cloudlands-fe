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
  runSaga,
  type EventChannel,
} from 'redux-saga';
import type { SelectorChannelPayload } from 'ag-redux-toolkit/saga';
import type { StoreState } from '$store/renderer/types';
import {
  AgentStatus,
  type AgentMessage,
  type AgentSession,
} from '$shared/types';

const { stateRef, listeners, appStoreMock } = vi.hoisted(() => {
  const stateRef = { current: { agentSessions: { byAgentId: {} } } as any };
  const listeners = new Set<(state: any) => void>();
  const appStoreMock = {
    dispatch: vi.fn(),
    get state() {
      return stateRef.current;
    },
    getReadableState: vi.fn(() => ({
      subscribe: vi.fn((listener: (state: any) => void) => {
        listeners.add(listener);
        listener(stateRef.current);
        return () => listeners.delete(listener);
      }),
    })),
    createSelector: vi.fn((selectorFunc: (state: any, ...args: any[]) => any) => {
      const selector = Object.assign(
        (...args: any[]) => ({
          subscribe: (listener: (value: any) => void) => {
            const emit = (state: any) => listener(selectorFunc(state, ...args));
            listeners.add(emit);
            emit(stateRef.current);
            return () => listeners.delete(emit);
          },
        }),
        {
          select: selectorFunc,
          effect: (...args: any[]) => selectorFunc(stateRef.current, ...args),
          withStore: () => selector,
        },
      );

      return selector;
    }),
  };

  return { stateRef, listeners, appStoreMock };
});

vi.mock('$store/renderer/store', async () => {
  const { createStoreMockModule } = await import('$store/renderer/utils/test-helpers/store-mock');

  return createStoreMockModule(appStoreMock);
});

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

// --- Main branch helpers (channel tests) ---

type AgentStateEvent = {
  payload: AgentSession | undefined;
  prevPayload: AgentSession | undefined | null;
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
      for (const listener of [...listeners]) listener(state);
    },
  };
}

function collectChannelEvents(
  channel: EventChannel<SelectorChannelPayload<AgentSession | undefined>>,
) {
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

async function createTestAgentStateChannel() {
  return await runSaga(
    { context: { readableStoreState: appStoreMock.getReadableState() } },
    createAgentStateChannel,
    agentId,
    wsId,
  ).toPromise() as EventChannel<SelectorChannelPayload<AgentSession | undefined>>;
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

describe('createAgentStateChannel', () => {
  beforeEach(() => {
    listeners.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('emits agent session selector updates without reading the configured Store directly', async () => {
    const harness = createStoreHarness(makeSession({ isStreaming: true }));
    const channel = await createTestAgentStateChannel();
    const collected = collectChannelEvents(channel);

    harness.setSession(makeSession({ isStreaming: true, messages: [makeMessage('m1', 'user')] }));

    expect(collected.events).toHaveLength(1);
    expect(collected.events[0].payload?.messages.map((message) => message.id)).toEqual(['m1']);
    expect(collected.ended).toBe(false);

    channel.close();
  });

  it('emits completion session changes and leaves terminal handling to the monitor saga', async () => {
    const harness = createStoreHarness(makeSession({ isStreaming: true }));
    const channel = await createTestAgentStateChannel();
    const collected = collectChannelEvents(channel);

    harness.setSession(makeSession({
      status: AgentStatus.Idle,
      isStreaming: false,
      isProcessing: false,
      isResponding: false,
      messages: [makeMessage('m1')],
    }));

    expect(collected.events).toHaveLength(1);
    expect(collected.events[0].payload?.messages.map((message) => message.id)).toEqual(['m1']);
    expect(collected.events[0].payload?.status).toBe(AgentStatus.Idle);
    expect(collected.ended).toBe(false);

    channel.close();
  });

  it('emits explicit agent error session changes', async () => {
    const harness = createStoreHarness(makeSession({ isStreaming: true }));
    const channel = await createTestAgentStateChannel();
    const collected = collectChannelEvents(channel);

    harness.setSession(makeSession({
      status: AgentStatus.Error,
      isStreaming: false,
      isProcessing: false,
      isResponding: false,
      messages: [makeMessage('m1')],
    }));

    expect(collected.events).toHaveLength(1);
    expect(collected.events[0].payload?.status).toBe(AgentStatus.Error);
    expect(collected.ended).toBe(false);

    channel.close();
  });

  it('closes the selector channel subscription and does not leave timers behind', async () => {
    vi.useFakeTimers();
    const harness = createStoreHarness(makeSession({ isStreaming: true }));
    const channel = await createTestAgentStateChannel();
    const collected = collectChannelEvents(channel);

    harness.setSession(makeSession({ status: AgentStatus.Idle, messages: [makeMessage('m1')] }));
    channel.close();
    harness.setSession(makeSession({ status: AgentStatus.Idle, messages: [makeMessage('m2')] }));

    expect(collected.events).toHaveLength(1);
    expect(collected.events[0].payload?.messages.map((message) => message.id)).toEqual(['m1']);
    expect(collected.ended).toBe(true);
    expect(harness.listeners.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});