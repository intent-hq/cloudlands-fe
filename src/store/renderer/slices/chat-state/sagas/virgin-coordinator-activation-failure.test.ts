/**
 * Regression test — lost first message on a virgin initial coordinator.
 *
 * Scenario: a workspace agent is created WITHOUT a kick-off prompt. Its initial
 * activation fails/times out, leaving the session in AgentActivationState.ERROR
 * (see agent-creation-saga.test.ts "records an actionable error session when
 * initial activation times out", which confirms Phase A part 1).
 *
 * The user then types a message and hits Enter. On current HEAD the
 * send-message saga walks the normal send path and dispatches the doomed
 * agentSessionSendMessageRequested — the backend has no session, so the text is
 * silently dropped and never queued, reproducing the bug.
 *
 * After the fix the saga detects the ERROR activation state for the initial
 * workspace agent and instead queues the message (durable preservation),
 * re-fires activation, and surfaces a toast — never silently dropping the text.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as sagaEffects from 'redux-saga/effects';
import { runSaga, stdChannel } from 'redux-saga';
import { AgentActivationState } from '$shared/types/agent-session';

vi.mock('typed-redux-saga', () => ({
  call: function* (fnOrDescriptor: any, ...args: any[]) {
    return yield Array.isArray(fnOrDescriptor)
      ? sagaEffects.call(fnOrDescriptor as [any, any], ...args)
      : sagaEffects.call(fnOrDescriptor, ...args);
  },
  put: function* (action: any) {
    return yield sagaEffects.put(action);
  },
  take: function* (pattern: any) {
    return yield sagaEffects.take(pattern);
  },
  takeEvery: function* (pattern: any, worker: any) {
    return yield sagaEffects.takeEvery(pattern, worker);
  },
  delay: function* (ms: any) {
    return yield sagaEffects.delay(ms);
  },
  race: function* (effects: any) {
    return yield sagaEffects.race(effects);
  },
}));

vi.mock('$lib/utils/client-logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

const mockToastError = vi.fn();
vi.mock('svelte-sonner', () => ({ toast: { error: mockToastError } }));

const mockActivateInitialAgentRequested = vi.fn((wsId: string, agentId: string, config: unknown) => ({
  type: 'workspaceAgents/activateInitialAgentRequested',
  payload: [wsId, agentId, config],
}));
vi.mock('$store/renderer/slices/workspace-agents/workspace-agents-slice', () => ({
  activateInitialAgentRequested: Object.assign(mockActivateInitialAgentRequested, {
    type: 'workspaceAgents/activateInitialAgentRequested',
    toString: () => 'workspaceAgents/activateInitialAgentRequested',
  }),
}));

const mockSendMessage = vi.fn().mockResolvedValue(undefined);
vi.mock('$store/renderer/slices/agent-session/agent-session-slice', () => {
  const agentSessionSendMessageRequested = Object.assign(
    (agentId: string, wsId: string, text: string, options: unknown) => ({
      type: 'agentSessions/sendMessageRequested',
      payload: [agentId, wsId, text, options],
      promise: Promise.resolve().then(() => mockSendMessage(agentId, wsId, text, options)),
    }),
    { type: 'agentSessions/sendMessageRequested', toString: () => 'agentSessions/sendMessageRequested' },
  );
  const agentSessionStopChatRequested = vi.fn((agentId: string) => ({
    type: 'agentSessions/stopChatRequested',
    payload: [agentId],
    promise: Promise.resolve(),
  }));
  const addMessage = Object.assign(
    (agentId: string, message: unknown) => ({ type: 'agentSessions/addMessage', payload: [agentId, message] }),
    { type: 'agentSessions/addMessage', toString: () => 'agentSessions/addMessage' },
  );
  return { agentSessionSendMessageRequested, agentSessionStopChatRequested, addMessage };
});

const mockQueueMessage = vi.fn().mockResolvedValue({ success: true });
const mockRemoveQueuedMessage = vi.fn().mockResolvedValue({ success: true });
vi.mock('$features/agent/services/consolidated-backend.service', () => ({
  unifiedOrchestrator: { queueMessage: mockQueueMessage, removeQueuedMessage: mockRemoveQueuedMessage },
}));

vi.mock('ag-redux-toolkit/saga', () => ({ waitFor: function* () { return true; } }));
vi.mock('ag-redux-toolkit/utils/sagas/selector-channel-effects', () => ({
  createChannelFromSelector: vi.fn(),
}));

const { hoistedSagaEffects } = vi.hoisted(() => ({
  hoistedSagaEffects: require('redux-saga/effects') as typeof sagaEffects,
}));

const mockSelectAgentById = vi.fn();
const mockSelectAgentIsResponding = vi.fn().mockReturnValue(false);
const mockSelectPendingCount = vi.fn().mockReturnValue(0);

vi.mock('../../workspace-agents/workspace-agents-selectors', () => ({
  selectAgentSession: {
    select: (...args: any[]) => mockSelectAgentById(...args),
    effect: function* (...args: any[]) { return yield hoistedSagaEffects.select(mockSelectAgentById, ...args); },
  },
}));
vi.mock('../../agent-session/agent-session-selectors', () => ({
  selectAgentSession: {
    select: (...args: any[]) => mockSelectAgentById(...args),
    effect: function* (...args: any[]) { return yield hoistedSagaEffects.select(mockSelectAgentById, ...args); },
  },
  selectAgentIsResponding: {
    select: (_s: unknown, id: string) => mockSelectAgentIsResponding(id),
    effect: function* (id: string) {
      return yield hoistedSagaEffects.select((_s: unknown, i: string) => mockSelectAgentIsResponding(i), id);
    },
  },
}));
vi.mock('../chat-state-selectors', () => ({
  selectChatIsRebinding: { effect: function* () { return false; } },
  selectChatLastMessageTime: { effect: function* () { return 0; } },
  selectChatTrackedWorkspaceId: { effect: function* () { return null; } },
}));
vi.mock('../../permission/permission-selectors', () => ({
  selectPendingCount: {
    select: (...args: any[]) => mockSelectPendingCount(...args),
    effect: function* (...args: any[]) { return yield hoistedSagaEffects.select(mockSelectPendingCount, ...args); },
  },
}));
vi.mock('../../transient-ui/transient-ui-slice', () => ({
  clearChatDraft: (...args: any[]) => ({ type: 'transientUi/clearChatDraft', payload: args }),
}));
vi.mock('../../multi-panel-context/multi-panel-context-slice', () => ({
  uncheckAllSelections: () => ({ type: 'multiPanelContext/uncheckAllSelections' }),
}));

import { sendMessage } from '../chat-state-slice';

const AGENT_ID = 'agent-virgin-1';
const WS_ID = 'ws-virgin-1';

function makeErrorAgent(overrides: Record<string, any> = {}) {
  return {
    id: AGENT_ID,
    workspaceId: WS_ID,
    name: 'Coordinator',
    model: 'sonnet4.5',
    provider: 'auggie',
    status: 'pending',
    messages: [],
    activationState: AgentActivationState.ERROR,
    lastActivationError: 'Timed out activating initial agent from Redux request',
    ...overrides,
  };
}

function makeActivatingAgent(overrides: Record<string, any> = {}) {
  return makeErrorAgent({
    activationState: AgentActivationState.ACTIVATING,
    lastActivationError: undefined,
    ...overrides,
  });
}

async function runSend(actionOverrides: Record<string, any> = {}) {
  const { watchSendMessage, _resetActiveSendsForTest } = await import('./send-message-saga');
  _resetActiveSendsForTest();

  const dispatched: any[] = [];
  const channel = stdChannel();
  runSaga(
    {
      channel,
      dispatch: (action: any) => {
        dispatched.push(action);
        channel.put(action);
      },
      getState: () => ({}),
    },
    watchSendMessage,
  );

  channel.put(
    sendMessage(AGENT_ID, {
      wsId: WS_ID,
      text: 'Please scaffold the project',
      serializedContextItems: [],
      isInitialWorkspaceAgent: true,
      ...actionOverrides,
    } as any),
  );
  await vi.advanceTimersByTimeAsync(0);
  return { dispatched };
}

async function runSends(texts: string[]) {
  const { watchSendMessage, _resetActiveSendsForTest } = await import('./send-message-saga');
  _resetActiveSendsForTest();

  const dispatched: any[] = [];
  const channel = stdChannel();
  runSaga(
    {
      channel,
      dispatch: (action: any) => {
        dispatched.push(action);
        channel.put(action);
      },
      getState: () => ({}),
    },
    watchSendMessage,
  );

  for (const text of texts) {
    channel.put(
      sendMessage(AGENT_ID, {
        wsId: WS_ID,
        text,
        serializedContextItems: [],
        isInitialWorkspaceAgent: true,
      } as any),
    );
    await vi.advanceTimersByTimeAsync(0);
  }
  return { dispatched };
}

describe('virgin coordinator — failed initial activation send guard', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mockSelectAgentIsResponding.mockReturnValue(false);
    mockSelectPendingCount.mockReturnValue(0);
    mockQueueMessage.mockResolvedValue({ success: true });
    mockRemoveQueuedMessage.mockResolvedValue({ success: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('preserves the text in the queue, retries activation, and toasts instead of dropping it', async () => {
    mockSelectAgentById.mockReturnValue(makeErrorAgent());

    const { dispatched } = await runSend();

    // 1. Text preserved durably in the backend queue (never silently dropped).
    expect(mockQueueMessage).toHaveBeenCalledTimes(1);
    expect(mockQueueMessage).toHaveBeenCalledWith(
      AGENT_ID,
      'Please scaffold the project',
      expect.anything(),
      undefined,
      WS_ID,
    );

    // 2. Activation is re-fired so the agent retries transparently.
    expect(mockActivateInitialAgentRequested).toHaveBeenCalledTimes(1);
    expect(mockActivateInitialAgentRequested).toHaveBeenCalledWith(
      WS_ID,
      AGENT_ID,
      expect.objectContaining({ id: AGENT_ID, metadata: expect.objectContaining({ isInitialAgent: true }) }),
    );

    // 3. A visible toast surfaces the failure — success branch confirms the message is queued.
    expect(mockToastError).toHaveBeenCalledTimes(1);
    expect(mockToastError).toHaveBeenCalledWith(expect.stringContaining('your message is queued'));

    // 4. The doomed direct send is NOT attempted (that is the silent-loss path).
    expect(mockSendMessage).not.toHaveBeenCalled();
    expect(dispatched.some((a) => a.type === 'agentSessions/sendMessageRequested')).toBe(false);
    expect(dispatched.some((a) => a.type === 'chatState/sendStarted')).toBe(false);
  });

  it('keeps the draft recoverable when queueing also fails (no silent loss)', async () => {
    mockSelectAgentById.mockReturnValue(makeErrorAgent());
    mockQueueMessage.mockResolvedValue({ success: false, error: 'backend offline' });

    const { dispatched } = await runSend();

    // Draft must NOT be cleared on a hard failure — the text stays recoverable.
    expect(dispatched.some((a) => a.type === 'transientUi/clearChatDraft')).toBe(false);
    // The failure is recorded and surfaced; activation still retried.
    expect(dispatched.some((a) => a.type === 'agentQueue/setError')).toBe(true);
    expect(mockActivateInitialAgentRequested).toHaveBeenCalledTimes(1);
    // The toast must NOT falsely claim the message was queued on a hard failure.
    expect(mockToastError).toHaveBeenCalledTimes(1);
    expect(mockToastError).toHaveBeenCalledWith(expect.stringContaining('could not be queued'));
    expect(mockToastError).not.toHaveBeenCalledWith(expect.stringContaining('your message is queued'));
    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it('does not engage the guard for a healthy active initial agent (no happy-path regression)', async () => {
    mockSelectAgentById.mockReturnValue(
      makeErrorAgent({ activationState: AgentActivationState.ACTIVE, status: 'idle', backendSessionId: 'backend-1' }),
    );

    await runSend();

    // Healthy agent → normal send path runs, guard side effects do not fire.
    expect(mockQueueMessage).not.toHaveBeenCalled();
    expect(mockActivateInitialAgentRequested).not.toHaveBeenCalled();
    expect(mockSendMessage).toHaveBeenCalledTimes(1);
  });

  it('does not engage the guard when the send is not for the initial workspace agent', async () => {
    mockSelectAgentById.mockReturnValue(makeErrorAgent());

    await runSend({ isInitialWorkspaceAgent: false });

    expect(mockQueueMessage).not.toHaveBeenCalled();
    expect(mockActivateInitialAgentRequested).not.toHaveBeenCalled();
    // Without the guard the saga proceeds to the normal send path.
    expect(mockSendMessage).toHaveBeenCalledTimes(1);
  });

  // ==========================================================================
  // Wave 8 — send DURING activation (ACTIVATING), not after it fails (ERROR).
  // On HEAD f066b4278/0dc91bc9d the guard only engaged for ERROR, so a send
  // while activation was still in flight walked the normal send path and was
  // silently dropped. These cases pin the generalized guard.
  // ==========================================================================

  it('queues the text without re-firing activation when the initial agent is still ACTIVATING', async () => {
    mockSelectAgentById.mockReturnValue(makeActivatingAgent());

    const { dispatched } = await runSend({ text: 'hello' });

    // 1. Text preserved durably in the backend queue (never silently dropped).
    expect(mockQueueMessage).toHaveBeenCalledTimes(1);
    expect(mockQueueMessage).toHaveBeenCalledWith(AGENT_ID, 'hello', expect.anything(), undefined, WS_ID);

    // 2. The doomed direct send is NOT attempted (that is the silent-loss path).
    expect(mockSendMessage).not.toHaveBeenCalled();
    expect(dispatched.some((a) => a.type === 'agentSessions/sendMessageRequested')).toBe(false);
    expect(dispatched.some((a) => a.type === 'chatState/sendStarted')).toBe(false);

    // 3. Activation is already in flight — do NOT re-fire it (avoid dispatch noise).
    expect(mockActivateInitialAgentRequested).not.toHaveBeenCalled();

    // 4. The draft is preserved as the visible acknowledgement during startup
    //    (no toast is shown for a successful queue while ACTIVATING).
    expect(dispatched.some((a) => a.type === 'transientUi/clearChatDraft')).toBe(false);
    expect(mockToastError).not.toHaveBeenCalled();
  });

  it('preserves the draft and surfaces a toast when queueing fails while ACTIVATING', async () => {
    mockSelectAgentById.mockReturnValue(makeActivatingAgent());
    mockQueueMessage.mockResolvedValue({ success: false, error: 'backend offline' });

    const { dispatched } = await runSend({ text: 'hello' });

    expect(mockQueueMessage).toHaveBeenCalledTimes(1);
    // Hard failure: draft stays recoverable, error recorded, and a toast warns.
    expect(dispatched.some((a) => a.type === 'transientUi/clearChatDraft')).toBe(false);
    expect(dispatched.some((a) => a.type === 'agentQueue/setError')).toBe(true);
    expect(mockToastError).toHaveBeenCalledTimes(1);
    expect(mockToastError).toHaveBeenCalledWith(expect.stringContaining('could not be queued'));
    // No re-fire and no doomed direct send.
    expect(mockActivateInitialAgentRequested).not.toHaveBeenCalled();
    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it('queues multiple ACTIVATING sends in order without duplicating or sending directly', async () => {
    mockSelectAgentById.mockReturnValue(makeActivatingAgent());

    await runSends(['first', 'second', 'third']);

    expect(mockQueueMessage).toHaveBeenCalledTimes(3);
    const queuedTexts = mockQueueMessage.mock.calls.map((call) => call[1]);
    expect(queuedTexts).toEqual(['first', 'second', 'third']);
    expect(mockSendMessage).not.toHaveBeenCalled();
    expect(mockActivateInitialAgentRequested).not.toHaveBeenCalled();
  });

  it('keeps the Wave 7 ERROR path unchanged (queue + re-fire + toast)', async () => {
    mockSelectAgentById.mockReturnValue(makeErrorAgent());

    await runSend({ text: 'hello' });

    expect(mockQueueMessage).toHaveBeenCalledTimes(1);
    expect(mockActivateInitialAgentRequested).toHaveBeenCalledTimes(1);
    expect(mockToastError).toHaveBeenCalledWith(expect.stringContaining('your message is queued'));
    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  // ==========================================================================
  // Wave 9 — the Wave 8 guard over-fired in two ways:
  //   A) A persisted coordinator loaded from disk never had activationState set
  //      to ACTIVE (it is undefined). The "anything that isn't ACTIVE" guard
  //      treated undefined as pre-active and queued ordinary sends to an idle,
  //      fully-functional coordinator. Fix: only the explicit pre-active states
  //      (PENDING/ACTIVATING/ERROR) engage the guard; undefined falls through.
  //   B) Force-send-from-queue dispatches skipQueueCheck:true to bypass queueing,
  //      but the guard ran before the skipQueueCheck block and re-queued the
  //      message — an N+1 duplicate. Fix: honor skipQueueCheck in the guard.
  // ==========================================================================

  it('sends through the normal path for a persisted coordinator (activationState undefined)', async () => {
    mockSelectAgentById.mockReturnValue(
      makeErrorAgent({
        activationState: undefined,
        lastActivationError: undefined,
        status: 'idle',
        backendSessionId: 'backend-persisted-1',
      }),
    );

    const { dispatched } = await runSend({ text: 'hello again' });

    // Guard must NOT engage: no re-queue, no activation re-fire.
    expect(mockQueueMessage).not.toHaveBeenCalled();
    expect(mockActivateInitialAgentRequested).not.toHaveBeenCalled();
    // The message goes through the normal send path.
    expect(mockSendMessage).toHaveBeenCalledTimes(1);
    expect(dispatched.some((a) => a.type === 'agentSessions/sendMessageRequested')).toBe(true);
  });

  it('sends through the normal path for a force-send-from-queue (skipQueueCheck) without re-queueing', async () => {
    mockSelectAgentById.mockReturnValue(makeActivatingAgent());

    const { dispatched } = await runSend({
      text: 'force me',
      skipQueueCheck: true,
      forceSubmit: true,
      queuedMessageId: 'q1',
    });

    // No re-queue — the explicit bypass must reach the send path, not the guard.
    expect(mockQueueMessage).not.toHaveBeenCalled();
    // The original queue entry is removed (consumed), never duplicated.
    expect(mockRemoveQueuedMessage).toHaveBeenCalledTimes(1);
    expect(mockSendMessage).toHaveBeenCalledTimes(1);
    expect(dispatched.some((a) => a.type === 'agentSessions/sendMessageRequested')).toBe(true);
  });
});

