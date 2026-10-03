import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const wire = vi.hoisted(() => ({ request: vi.fn(), warning: vi.fn() }));
vi.mock('$lib/components/patterns/notify', () => ({
  notify: { warning: wire.warning, info: vi.fn(), error: vi.fn() },
}));
vi.mock('$lib/client/live/backend-transport', () => ({
  backendRequest: wire.request,
  backendSubscribe: vi.fn(async () => ({})),
  backendUnsubscribe: vi.fn(async () => {}),
  onBackendNotification: () => () => {},
  onBackendReconnected: () => () => {},
  detectLiveStateCapability: async () => false,
  isBackendAvailable: () => true,
  BackendError: class BackendError extends Error {},
}));
vi.mock('svelte', async (original) => ({
  ...(await original<typeof import('svelte')>()),
  getContext: () => undefined,
}));
import { store } from '$store/renderer/store';
import { appClient } from '$lib/client';
import { chatSubscribeSaga } from '$store/renderer/slices/chat-state/sagas/chat-subscribe-saga';
import {
  acquireChatInterestLease,
  releaseChatInterestLease,
} from '$features/agent/utils/chat-interest-leases';
import { createAdmittedLegacyPrincipal } from '../../test/fixtures/admitted-legacy-principal';
import { setWorkspaceEntity } from '$store/renderer/slices/workspace/workspace-slice';
import {
  bulkUpsertSessions,
  updateSession as updateAgentSessionFields,
  agentSessionRetryLastMessageRequested,
} from '$store/renderer/slices/agent-session/agent-session-slice';
import { agentMutationSaga } from '$store/renderer/slices/agent-session/sagas/agent-mutation-saga';
import { chatReadSaga } from '$store/renderer/slices/chat-state/sagas/chat-read-saga';
import { chatSendSaga } from '$store/renderer/slices/chat-state/sagas/chat-send-saga';
import { requestChatMessageRetry } from './chat-submission-retry';
import { removeQueuedMessageRequested } from '$store/renderer/slices/agent-queue/agent-queue-slice';
import {
  initializeChatRequested,
  sendQueuedMessageNowRequested,
  sendQueuedMessagesNowRequested,
  clearQueuedMessagesRequested,
  chatLastAttemptedMessageSet,
} from '$store/renderer/slices/chat-state/chat-state-slice';
import { pendingScopeReleased } from '$store/renderer/slices/pending-submissions/pending-submissions-slice';
import { submitChatMessage } from '$features/agent/chat-submission';
import { admitAgentSubmission } from '$store/renderer/slices/pending-submissions/pending-submissions-admission';
import { pendingSubmissionSettled } from '$store/renderer/slices/pending-submissions/pending-submissions-slice';
import { selectAgentSubmissionDisplay } from '$store/renderer/slices/pending-submissions/pending-submissions-selectors';
import {
  beginSubmissionRead,
  announceSubmissionDelivery,
} from '$features/agent/submission-evidence';
import { loadChatTranscript } from '$features/agent/chat-read-service';
import { __resetAgentQueueReadServiceForTests } from '$features/agent/agent-queue-read-service';
import { routeDaemonEventsNotification } from '$features/events/daemon-events-bridge.client';
import { setChatDraft } from '$store/renderer/slices/transient-ui/transient-ui-slice';
import { selectChatDraft } from '$store/renderer/slices/transient-ui/transient-ui-selectors';
const ws = 'independent-workspace';
let agent: string;
let cleanups: (() => void)[];
const previous = {
  id: 'previous',
  role: 'user',
  timestamp: '2026-10-03T00:00:00Z',
  contentBlocks: [{ type: 'text', text: 'previous' }],
};
const shell = () => ({
  id: agent,
  workspaceId: ws,
  name: 'Agent',
  status: 'runtime_idle',
  provider: 'auggie',
  model: 'opus4.7',
  isActive: true,
  isProcessing: false,
  isResponding: false,
  isStreaming: false,
  messageCount: 1,
  metadata: {},
  createdAt: '2026-10-03T00:00:00Z',
  updatedAt: '2026-10-03T00:00:00Z',
});
const baseReply = async (method: string, params: any) => {
  if (method === 'agent.get') return { agent: shell() };
  if (method === 'agent.getConversation')
    return { messages: [previous], totalMessages: 1, truncated: false };
  if (method === 'agent.getQueue') return { queue: [] };
  if (method === 'agent.sendMessage')
    return { success: true, queued: false, messageId: params.messageId ?? 'retry-canonical' };
  return {};
};
beforeEach(() => {
  agent = 'independent-' + crypto.randomUUID();
  const initial = createAdmittedLegacyPrincipal();
  initial.principal.snapshot!.capabilities.submissionCorrelation = 1;
  cleanups = [store.init(initial)];
  store.dispatch(setWorkspaceEntity({ id: ws, myRole: 'owner', path: '/repo' } as any));
  store.dispatch(
    bulkUpsertSessions([{ ...shell(), backendSessionId: agent, messages: [previous] } as any]),
  );
  wire.request.mockReset().mockImplementation(baseReply);
  wire.warning.mockReset();
});
afterEach(() => {
  cleanups.reverse().forEach((f) => f());
  __resetAgentQueueReadServiceForTests();
});
const display = () => selectAgentSubmissionDisplay.select(store.state, agent, ws);
const admit = (text = 'contribution') =>
  admitAgentSubmission(store, agent, ws, 1, { content: text, destination: 'conversation' })!;
const row = (a: any, extras: any = {}) => ({
  id: a.submission.id,
  content: a.submission.content,
  queuedAt: '2026-10-03T00:00:00Z',
  position: 0,
  turnId: 'turn-' + a.submission.id,
  submissionIds: [a.submission.id],
  author: { principalId: a.scope.principalId, login: null, displayName: null, avatarUrl: null },
  mergeEligible: false,
  ...extras,
});
const emit = (type: string, data: any) =>
  routeDaemonEventsNotification('events.event', {
    id: crypto.randomUUID(),
    type,
    workspaceId: ws,
    timestamp: '2026-10-03T00:00:00Z',
    data: { agentId: agent, ...data },
  });
const startSending = () =>
  cleanups.push(store.runSaga(agentMutationSaga), store.runSaga(chatSendSaga));
describe('conversation retry and evidence integration', () => {
  it('does not accept foreign or unscoped recovery aliases as delivery', () => {
    const a = admit();
    emit('agent:message', { ...row(a), role: 'user', author: { principalId: 'foreign' } });
    expect(display().conversation[0].status).toBe('preparing');
    emit('agent:message', {
      ...row(a),
      role: 'user',
      recoverySources: [{ author: { principalId: 'foreign' }, submissionIds: [a.submission.id] }],
    });
    expect(display().conversation[0].status).toBe('preparing');
    emit('agent:message', { ...row(a), role: 'user' });
    expect(display().conversation[0].status).toBe('accepted');
  });
  it('preserves separate B after a merged ACK and lean persistence of A', () => {
    const a = admit('A'),
      b = admit('B');
    const merged = row(a, { content: 'A\n\nB', submissionIds: [a.submission.id, b.submission.id] });
    store.dispatch(
      pendingSubmissionSettled(a.scope, b.submission.id, 'accepted', Date.now(), merged, true),
    );
    emit('agent:message', { ...row(a), role: 'user' });
    expect(display().conversation.map((s) => s.content)).toEqual(['A']);
    expect(display().queue.map((s) => s.content)).toEqual(['B']);
    store.dispatch(
      pendingSubmissionSettled(a.scope, a.submission.id, 'accepted', Date.now(), merged, true),
    );
    expect(display().conversation.map((s) => s.content)).toEqual(['A']);
    expect(display().queue.map((s) => s.content)).toEqual(['B']);
  });
  it('fences a real history read and coalesces a fresh read after lean delivery', async () => {
    const a = admit();
    let oldReply: any, currentReply: any;
    let reads = 0;
    wire.request.mockImplementation((method, params) => {
      if (method === 'agent.getConversation')
        return new Promise((resolve) => {
          if (++reads === 1) oldReply = resolve;
          else currentReply = resolve;
        });
      return baseReply(method, params);
    });
    const reading = loadChatTranscript(agent, ws);
    await vi.waitFor(() => expect(oldReply).toBeTypeOf('function'));
    announceSubmissionDelivery(agent, ws, [row(a)]);
    oldReply({ messages: [], totalMessages: 0, truncated: false });
    await vi.waitFor(() => expect(currentReply).toBeTypeOf('function'));
    expect(store.state.agentSessions.byAgentId[agent].messages.map((m) => m.id)).toEqual([
      'previous',
    ]);
    expect(display().conversation).toHaveLength(1);
    currentReply({
      messages: [
        previous,
        {
          id: a.submission.id,
          role: 'user',
          author: row(a).author,
          metadata: { submissionIds: [a.submission.id] },
          contentBlocks: [{ type: 'text', text: 'contribution' }],
          timestamp: '2026-10-03T00:00:00Z',
        },
      ],
      totalMessages: 2,
      truncated: false,
    });
    await reading;
    await vi.waitFor(() => expect(display().conversation).toEqual([]));
    expect(reads).toBe(2);
  });
  it('reconciles uncertain delivery before the retry path resends', async () => {
    startSending();
    let attempts = 0;
    wire.request.mockImplementation(async (method, params) => {
      if (method === 'agent.sendMessage' && ++attempts === 1)
        throw new Error('connection lost after write');
      return baseReply(method, params);
    });
    submitChatMessage(store, agent, { wsId: ws, text: 'recoverable' });
    await vi.waitFor(() => expect(store.state.chatState.byAgentId[agent]?.error).toBeTruthy());
    expect(display().conversation[0].status).toBe('uncertain');
    const beforeRetry = wire.request.mock.calls.length;
    await store.dispatch(agentSessionRetryLastMessageRequested(agent, ws));
    const retryCalls = wire.request.mock.calls.slice(beforeRetry);
    expect(retryCalls.some(([method]) => method === 'agent.getQueue')).toBe(true);
    expect(retryCalls.some(([method]) => method === 'agent.getConversation')).toBe(true);
  });
  it('starts a fresh correlated submission after a proven rejection', async () => {
    startSending();
    let attempts = 0;
    wire.request.mockImplementation(async (method, params) => {
      if (method === 'agent.sendMessage' && ++attempts === 1)
        return { success: false, error: 'request rejected' };
      return baseReply(method, params);
    });
    submitChatMessage(store, agent, { wsId: ws, text: 'rejected first' });
    await vi.waitFor(() => expect(store.state.chatState.byAgentId[agent]?.error).toBeTruthy());
    const original = wire.request.mock.calls.find(([m]) => m === 'agent.sendMessage')![1];
    await store.dispatch(agentSessionRetryLastMessageRequested(agent, ws));
    const calls = wire.request.mock.calls.filter(([m]) => m === 'agent.sendMessage');
    expect(calls).toHaveLength(2);
    expect(calls[1][1].messageId).toEqual(expect.any(String));
    expect(calls[1][1].messageId).not.toBe(original.messageId);
  });
  it('preserves a newer draft when the user retries a rejected submission', async () => {
    startSending();
    let attempts = 0;
    wire.request.mockImplementation(async (method, params) => {
      if (method === 'agent.sendMessage' && ++attempts === 1)
        return { success: false, error: 'request rejected' };
      return baseReply(method, params);
    });
    submitChatMessage(store, agent, { wsId: ws, text: 'rejected first' });
    await vi.waitFor(() => expect(store.state.chatState.byAgentId[agent]?.error).toBeTruthy());
    store.dispatch(setChatDraft(ws, agent, 'keep this newer draft'));
    await store.dispatch(agentSessionRetryLastMessageRequested(agent, ws));
    expect(selectChatDraft.select(store.state, ws, agent)).toBe('keep this newer draft');
  });
});

const sends = () => wire.request.mock.calls.filter(([method]) => method === 'agent.sendMessage');
async function failFirstSend(outcome: 'rejected' | 'uncertain') {
  startSending();
  let count = 0;
  wire.request.mockImplementation(async (method, params) => {
    if (method === 'agent.sendMessage' && ++count === 1) {
      if (outcome === 'uncertain') throw new Error('connection lost after write');
      return { success: false, error: 'request rejected' };
    }
    return baseReply(method, params);
  });
  submitChatMessage(store, agent, {
    wsId: ws,
    text: 'retry payload',
    fileBlocks: [{ type: 'file', attachmentId: 'original-file', fileName: 'original.txt' }],
  });
  await vi.waitFor(() => expect(store.state.chatState.byAgentId[agent]?.error).toBeTruthy());
  return store.state.chatState.byAgentId[agent].lastAttemptedMessage!;
}
function warningChoice() {
  expect(wire.warning).toHaveBeenCalledOnce();
  expect(wire.warning.mock.calls[0][0]).toContain('twice');
  return wire.warning.mock.calls[0][1] as {
    action: { onClick(): void };
    cancel: { onClick(): void };
    onDismiss(): void;
  };
}

describe('explicit retry choices', () => {
  it('stages a fresh UI retry synchronously before a deferred send and preserves a newer draft', async () => {
    const attempt = await failFirstSend('rejected');
    const originalId = sends()[0][1].messageId;
    store.dispatch(setChatDraft(ws, agent, 'new draft'));
    let reply!: (value: unknown) => void;
    wire.request.mockImplementation((method, params) => {
      if (method === 'agent.sendMessage')
        return new Promise((resolve) => {
          reply = resolve;
        });
      return baseReply(method, params);
    });
    const retry = requestChatMessageRetry(agent, ws, 'retry-model');
    expect(display().conversation).toHaveLength(1);
    expect(display().conversation[0].id).not.toBe(originalId);
    expect(display().conversation[0].fileBlocks).toEqual(attempt.options?.fileBlocks);
    expect(store.state.agentSessions.byAgentId[agent].messages.map((m) => m.id)).toEqual([
      'previous',
    ]);
    expect(selectChatDraft.select(store.state, ws, agent)).toBe('new draft');
    await vi.waitFor(() => expect(reply).toBeTypeOf('function'));
    expect(sends()[1][1]).toMatchObject({
      messageId: display().conversation[0].id,
      model: 'retry-model',
    });
    wire.request.mockImplementation(baseReply);
    reply({ success: true, queued: false });
    await retry;
    await vi.waitFor(() => expect(display().conversation[0].status).toBe('accepted'));
    expect(selectChatDraft.select(store.state, ws, agent)).toBe('new draft');
    expect(store.state.agentSessions.byAgentId[agent].messages.map((m) => m.id)).toEqual([
      'previous',
    ]);
  });

  it('cancels an unconfirmed resend without dropping its content or changing the newer draft', async () => {
    await failFirstSend('uncertain');
    store.dispatch(setChatDraft(ws, agent, 'keep draft'));
    await store.dispatch(agentSessionRetryLastMessageRequested(agent, ws));
    const choice = warningChoice();
    expect(sends()).toHaveLength(1);
    choice.cancel.onClick();
    choice.action.onClick();
    expect(sends()).toHaveLength(1);
    expect(display().conversation[0].status).toBe('uncertain');
    expect(selectChatDraft.select(store.state, ws, agent)).toBe('keep draft');
  });

  it('uses a fresh ID only after the warned choice and never automatically retries that new send', async () => {
    await failFirstSend('uncertain');
    const originalId = sends()[0][1].messageId;
    await store.dispatch(agentSessionRetryLastMessageRequested(agent, ws));
    const choice = warningChoice();
    wire.request.mockImplementation(async (method, params) => {
      if (method === 'agent.sendMessage') throw new Error('another lost acknowledgement');
      return baseReply(method, params);
    });
    choice.action.onClick();
    choice.action.onClick();
    expect(display().conversation).toHaveLength(2);
    await vi.waitFor(() => expect(sends()).toHaveLength(2));
    await vi.waitFor(() =>
      expect(display().conversation.every((s) => s.status === 'uncertain')).toBe(true),
    );
    expect(sends()[1][1].messageId).toEqual(expect.any(String));
    expect(sends()[1][1].messageId).not.toBe(originalId);
    expect(store.state.agentSessions.byAgentId[agent].messages.map((m) => m.id)).toEqual([
      'previous',
    ]);
  });

  it.each([
    'delivery',
    'queue',
    'release',
    'access-regrant',
    'new-attempt',
    'new-admission',
    'dismiss',
  ] as const)('rejects a late warning action after %s', async (change) => {
    const attempt = await failFirstSend('uncertain');
    const reference = attempt.submission!.reference;
    await store.dispatch(agentSessionRetryLastMessageRequested(agent, ws));
    const choice = warningChoice();
    const evidence = {
      id: reference.id,
      content: attempt.text,
      position: 0,
      queuedAt: '2026-10-03T00:00:00Z',
      submissionIds: [reference.id],
      author: { principalId: reference.scope.principalId },
    };
    if (change === 'delivery') emit('agent:message', { ...evidence, role: 'user' });
    if (change === 'queue') emit('agent:queue:updated', { queue: [evidence] });
    if (change === 'release') store.dispatch(pendingScopeReleased(reference.scope));
    if (change === 'access-regrant') {
      store.dispatch(setWorkspaceEntity({ id: ws, myRole: 'viewer', canManage: false } as any));
      store.dispatch(setWorkspaceEntity({ id: ws, myRole: 'owner' } as any));
    }
    if (change === 'new-attempt')
      store.dispatch(chatLastAttemptedMessageSet(agent, { text: 'newer attempt' }));
    if (change === 'new-admission') admit('newer staged message');
    if (change === 'dismiss') choice.onDismiss();
    choice.action.onClick();
    await Promise.resolve();
    expect(sends()).toHaveLength(1);
  });

  it('does not let a rejection reply override earlier authoritative delivery', async () => {
    startSending();
    let reject!: (value: unknown) => void;
    wire.request.mockImplementation((method, params) =>
      method === 'agent.sendMessage'
        ? new Promise((resolve) => {
            reject = resolve;
          })
        : baseReply(method, params),
    );
    submitChatMessage(store, agent, { wsId: ws, text: 'already delivered' });
    await vi.waitFor(() => expect(reject).toBeTypeOf('function'));
    const id = sends()[0][1].messageId;
    const scope = store.state.pendingSubmissions.byAgentId[agent].scope;
    emit('agent:message', {
      id,
      role: 'user',
      content: 'already delivered',
      submissionIds: [id],
      author: { principalId: scope.principalId },
    });
    reject({ success: false, error: 'late rejection' });
    await vi.waitFor(() => expect(store.state.chatState.byAgentId[agent]?.error).toBeTruthy());
    await requestChatMessageRetry(agent, ws);
    expect(sends()).toHaveLength(1);
    expect(wire.warning).not.toHaveBeenCalled();
  });

  it('does not offer another send when reconciliation confirms the original in the queue', async () => {
    const attempt = await failFirstSend('uncertain');
    const ref = attempt.submission!.reference;
    wire.request.mockImplementation((method, params) =>
      method === 'agent.getQueue'
        ? Promise.resolve({
            queue: [
              {
                id: ref.id,
                content: attempt.text,
                position: 0,
                queuedAt: '2026-10-03T00:00:00Z',
                submissionIds: [ref.id],
                author: { principalId: ref.scope.principalId },
              },
            ],
          })
        : baseReply(method, params),
    );
    await store.dispatch(agentSessionRetryLastMessageRequested(agent, ws));
    expect(wire.warning).not.toHaveBeenCalled();
    expect(sends()).toHaveLength(1);
    expect(display().queue).toHaveLength(1);
  });
});

describe('daemon-owned and legacy retries', () => {
  it('retains compatibility for previously recorded legacy retries', async () => {
    startSending();
    store.dispatch(chatLastAttemptedMessageSet(agent, { text: 'legacy retry' }));
    await requestChatMessageRetry(agent, ws);
    expect(sends()).toHaveLength(1);
    expect(sends()[0][1].messageId).toBeUndefined();
    expect(wire.warning).not.toHaveBeenCalled();
  });

  it.each(['queued', 'processed'] as const)(
    'retries actual %s daemon work without local delivery provenance',
    async (kind) => {
      const { buildQueuedRecordedAttempt, buildProcessedRecordedAttempt } =
        await import('./utils/build-recorded-attempt');
      const attempt = await failFirstSend('uncertain');
      const message = {
        id: 'daemon-owned',
        content: 'daemon payload',
        queuedAt: '2026-10-03T00:00:00Z',
        position: 0,
      };
      const recorded =
        kind === 'queued'
          ? buildQueuedRecordedAttempt(message, attempt)
          : buildProcessedRecordedAttempt([message], attempt);
      expect(recorded.submission).toBeUndefined();
      store.dispatch(chatLastAttemptedMessageSet(agent, recorded));
      await requestChatMessageRetry(agent, ws);
      expect(sends()).toHaveLength(2);
      expect(sends()[1][1].messageId).toBeUndefined();
      expect(wire.warning).not.toHaveBeenCalled();
    },
  );
});

const queues = () => wire.request.mock.calls.filter(([method]) => method === 'agent.queueMessage');
describe('live queue transport uncertainty', () => {
  async function loseQueuedAcknowledgement() {
    startSending();
    store.dispatch(updateAgentSessionFields(agent, { isResponding: true }));
    const serverRows: any[] = [];
    wire.request.mockImplementation(async (method, params) => {
      if (method === 'agent.queueMessage') {
        const confirmed = {
          id: params.messageId,
          content: params.content,
          position: serverRows.length,
          queuedAt: '2026-10-03T00:00:00Z',
          submissionIds: [params.messageId],
          author: {
            principalId: store.state.pendingSubmissions.byAgentId[agent].scope.principalId,
          },
        };
        serverRows.push(confirmed);
        if (serverRows.length === 1) throw new Error('connection lost after enqueue');
        return { success: true, turnId: 'retry-turn', queuedMessage: confirmed };
      }
      if (method === 'agent.getQueue') return { queue: serverRows };
      return baseReply(method, params);
    });
    submitChatMessage(store, agent, {
      wsId: ws,
      text: 'queue retry',
      fileBlocks: [{ type: 'file', attachmentId: 'queue-file', fileName: 'queue.txt' }],
    });
    await vi.waitFor(() => expect(store.state.chatState.byAgentId[agent]?.error).toBeTruthy());
    expect(queues()).toHaveLength(1);
    return { attempt: store.state.chatState.byAgentId[agent].lastAttemptedMessage!, serverRows };
  }
  it('retains an uncertain contribution after the actual live queue client loses an acknowledgement', async () => {
    const { attempt, serverRows } = await loseQueuedAcknowledgement();
    expect(serverRows).toHaveLength(1);
    expect.soft(attempt.submission!.outcome).toBe('uncertain');
    expect.soft(display().queue).toHaveLength(1);
    expect.soft(display().queue[0]?.contributions[0]?.status).toBe('uncertain');
  });
  it('reconciles a real lost queue acknowledgement before retry can send duplicate work', async () => {
    const { serverRows } = await loseQueuedAcknowledgement();
    store.dispatch(setChatDraft(ws, agent, 'keep queue-time draft'));
    await requestChatMessageRetry(agent, ws);
    await vi.waitFor(() =>
      expect(wire.request.mock.calls.some(([method]) => method === 'agent.getQueue')).toBe(true),
    );
    expect(serverRows).toHaveLength(1);
    expect([...queues(), ...sends()]).toHaveLength(1);
    expect(wire.warning).not.toHaveBeenCalled();
    expect(selectChatDraft.select(store.state, ws, agent)).toBe('keep queue-time draft');
    expect(store.state.agentSessions.byAgentId[agent].messages.map((m) => m.id)).toEqual([
      'previous',
    ]);
  });
  it('requires the warned fresh-ID choice when queue and history cannot confirm delivery', async () => {
    const { attempt, serverRows } = await loseQueuedAcknowledgement();
    serverRows.length = 0;
    store.dispatch(setChatDraft(ws, agent, 'new draft after queue loss'));
    await requestChatMessageRetry(agent, ws);
    const choice = warningChoice();
    expect([...queues(), ...sends()]).toHaveLength(1);
    expect(wire.request.mock.calls.some(([method]) => method === 'agent.getConversation')).toBe(
      true,
    );
    choice.action.onClick();
    await vi.waitFor(() => expect([...queues(), ...sends()]).toHaveLength(2));
    const retried = [...queues(), ...sends()].at(-1)![1];
    expect(retried.messageId).not.toBe(attempt.submission!.reference.id);
    expect(retried.fileBlocks).toEqual(attempt.options?.fileBlocks);
    expect(selectChatDraft.select(store.state, ws, agent)).toBe('new draft after queue loss');
  });

  it('retains proven live queue rejection and retries it with a fresh ID without discarding the newer draft', async () => {
    startSending();
    store.dispatch(updateAgentSessionFields(agent, { isResponding: true }));
    wire.request.mockImplementation((method, params) =>
      method === 'agent.queueMessage'
        ? Promise.resolve({ success: false, error: 'queue rejected' })
        : baseReply(method, params),
    );
    submitChatMessage(store, agent, { wsId: ws, text: 'proven rejection' });
    await vi.waitFor(() => expect(store.state.chatState.byAgentId[agent]?.error).toBeTruthy());
    const attempt = store.state.chatState.byAgentId[agent].lastAttemptedMessage!;
    expect(attempt.submission!.outcome).toBe('rejected');
    expect(display().queue).toHaveLength(0);
    store.dispatch(setChatDraft(ws, agent, 'newer draft'));
    await requestChatMessageRetry(agent, ws);
    await vi.waitFor(() => expect([...queues(), ...sends()]).toHaveLength(2));
    expect([...queues(), ...sends()].at(-1)![1].messageId).not.toBe(
      attempt.submission!.reference.id,
    );
    expect(wire.warning).not.toHaveBeenCalled();
    expect(selectChatDraft.select(store.state, ws, agent)).toBe('newer draft');
  });
});

describe('queue mutation boundary with pending contributions', () => {
  it.each(['send', 'send-all', 'clear', 'remove'] as const)(
    'defers %s until the projected append is confirmed',
    async (kind) => {
      const a = admitAgentSubmission(store, agent, ws, 1, { content: 'A', destination: 'queue' })!;
      emit('agent:queue:updated', { queue: [row(a, { mergeEligible: true })] });
      beginSubmissionRead(agent, ws, 'queue').complete([row(a, { mergeEligible: true })]);
      beginSubmissionRead(agent, ws, 'history').complete([]);
      admitAgentSubmission(store, agent, ws, 1, { content: 'B', destination: 'queue' });
      startSending();
      const result =
        kind === 'send'
          ? store.dispatch(sendQueuedMessageNowRequested(agent, ws, a.submission.id))
          : kind === 'send-all'
            ? store.dispatch(sendQueuedMessagesNowRequested(agent, ws, [a.submission.id]))
            : kind === 'clear'
              ? store.dispatch(clearQueuedMessagesRequested(agent, ws, [a.submission.id]))
              : store.dispatch(removeQueuedMessageRequested(agent, a.submission.id));
      if (kind !== 'remove') await expect(result).rejects.toThrow();
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(
        wire.request.mock.calls.filter(([method]) =>
          [
            'agent.sendQueuedMessageNow',
            'agent.sendQueuedMessagesNow',
            'agent.removeQueuedMessage',
          ].includes(method),
        ),
      ).toEqual([]);
      expect(display().queue.map((r) => r.content)).toEqual(['A\n\nB']);
    },
  );
});

describe('queue admission and command ordering through the live boundary', () => {
  it('stages rapid identical sends before the first acknowledgement and reconciles a foreign barrier and rejected append', async () => {
    const a = admitAgentSubmission(store, agent, ws, 1, { content: 'A', destination: 'queue' })!;
    const initial = row(a, { mergeEligible: true });
    emit('agent:queue:updated', { queue: [initial] });
    beginSubmissionRead(agent, ws, 'queue').complete([initial]);
    beginSubmissionRead(agent, ws, 'history').complete([]);
    store.dispatch(
      updateAgentSessionFields(agent, {
        isProcessing: true,
        isResponding: true,
        isStreaming: true,
      }),
    );
    let acknowledge!: (result: unknown) => void;
    let authoritative = [initial];
    wire.request.mockImplementation((method, params) => {
      if (method === 'agent.queueMessage') {
        if (queues().length === 1)
          return new Promise((resolve) => {
            acknowledge = resolve;
          });
        return Promise.resolve({ success: false, error: 'Request refused' });
      }
      if (method === 'agent.getQueue') return Promise.resolve({ queue: authoritative });
      return baseReply(method, params);
    });
    startSending();
    expect(
      submitChatMessage(store, agent, { wsId: ws, text: 'same', userAppMessageId: 'app-b' }),
    ).toBe(true);
    expect(
      submitChatMessage(store, agent, { wsId: ws, text: 'same', userAppMessageId: 'app-c' }),
    ).toBe(true);
    const contributions = display().queue.flatMap((r) => r.contributions);
    expect(contributions.map((s) => s.appMessageId)).toEqual(['app-b', 'app-c']);
    expect(new Set(contributions.map((s) => s.id)).size).toBe(2);
    const [b, c] = contributions;
    expect(display().queue.map((r) => r.content)).toEqual(['A\n\nsame\n\nsame']);
    await vi.waitFor(() => expect(acknowledge).toBeTypeOf('function'));
    expect(queues()).toHaveLength(1);
    expect(queues()[0]).toEqual([
      'agent.queueMessage',
      { agentId: agent, workspaceId: ws, content: 'same', messageId: b.id },
    ]);
    authoritative = [
      { ...initial, mergeEligible: false },
      {
        ...initial,
        id: 'foreign',
        content: 'Other participant',
        submissionIds: ['foreign'],
        author: { ...initial.author, principalId: 'other' },
        mergeEligible: false,
        position: 1,
      },
      { ...initial, id: b.id, content: 'same', submissionIds: [b.id], position: 2 },
    ];
    emit('agent:queue:updated', { queue: authoritative });
    acknowledge({ success: true, queuedMessage: authoritative[2] });
    await vi.waitFor(() => expect(queues()).toHaveLength(2));
    await vi.waitFor(() => expect(display().queue.flatMap((r) => r.contributions)).toEqual([]));
    expect(queues()[1]).toEqual([
      'agent.queueMessage',
      { agentId: agent, workspaceId: ws, content: 'same', messageId: c.id },
    ]);
    expect(display().queue.map((r) => r.content)).toEqual(['A', 'Other participant', 'same']);
    expect(sends()).toHaveLength(0);
  });

  it('rechecks clear between removals when a new submission arrives during its first RPC', async () => {
    const a = admitAgentSubmission(store, agent, ws, 1, { content: 'A', destination: 'queue' })!;
    const initial = [
      row(a, { mergeEligible: false }),
      row(a, { id: 'second', content: 'Second', submissionIds: ['second'], mergeEligible: true }),
    ];
    emit('agent:queue:updated', { queue: initial });
    beginSubmissionRead(agent, ws, 'queue').complete(initial);
    beginSubmissionRead(agent, ws, 'history').complete([]);
    let removed!: (result: unknown) => void;
    wire.request.mockImplementation((method, params) =>
      method === 'agent.removeQueuedMessage'
        ? new Promise((resolve) => {
            removed = resolve;
          })
        : baseReply(method, params),
    );
    startSending();
    const clear = store.dispatch(
      clearQueuedMessagesRequested(agent, ws, [a.submission.id, 'second']),
    );
    const failed = expect(clear).rejects.toThrow();
    await vi.waitFor(() => expect(removed).toBeTypeOf('function'));
    admitAgentSubmission(store, agent, ws, 1, {
      content: 'New contribution',
      destination: 'queue',
    });
    removed({ success: true });
    await failed;
    expect(
      wire.request.mock.calls.filter(([method]) => method === 'agent.removeQueuedMessage'),
    ).toEqual([
      [
        'agent.removeQueuedMessage',
        { agentId: agent, messageId: a.submission.id, workspaceId: ws },
      ],
    ]);
    expect(display().queue.map((r) => r.content)).toEqual(['Second\n\nNew contribution']);
  });
});

describe('queue control freshness after later daemon events', () => {
  it('refreshes both authoritative sources after a later append so confirmed controls become usable again', async () => {
    const a = admitAgentSubmission(store, agent, ws, 1, { content: 'A', destination: 'queue' })!;
    let authoritative = [row(a, { mergeEligible: true })];
    emit('agent:queue:updated', { queue: authoritative });
    beginSubmissionRead(agent, ws, 'queue').complete(authoritative);
    beginSubmissionRead(agent, ws, 'history').complete([]);
    expect(display().queue[0].blocksMutations).toBe(false);
    wire.request.mockImplementation((method, params) =>
      method === 'agent.getQueue'
        ? Promise.resolve({ queue: authoritative })
        : baseReply(method, params),
    );
    cleanups.push(store.runSaga(chatReadSaga));
    authoritative = [
      {
        ...authoritative[0],
        content: 'A plus another client append',
        submissionIds: [a.submission.id, 'another-client'],
      },
    ];
    emit('agent:queue:updated', { queue: authoritative });
    await vi.waitFor(() => expect(display().queue[0].blocksMutations).toBe(false));
    expect(wire.request.mock.calls.some(([method]) => method === 'agent.getQueue')).toBe(true);
    expect(wire.request.mock.calls.some(([method]) => method === 'agent.getConversation')).toBe(
      true,
    );
    expect(display().queue.map((row) => row.content)).toEqual(['A plus another client append']);
    expect(sends()).toEqual([]);
    expect(queues()).toEqual([]);
  });
});

describe('queue freshness with the production standing subscription', () => {
  it.each([false, true])(
    'bounds restoration reads and recovers on new evidence (history failure=%s)',
    async (rejectHistory) => {
      const a = admitAgentSubmission(store, agent, ws, 1, { content: 'A', destination: 'queue' })!;
      const original = row(a, { mergeEligible: true });
      emit('agent:queue:updated', { queue: [original] });
      let onTranscript: Parameters<typeof appClient.chat.subscribe>[1] | undefined;
      const subscription = vi
        .spyOn(appClient.chat, 'subscribe')
        .mockImplementation((_id, handler) => {
          onTranscript = handler;
          return () => {};
        });
      acquireChatInterestLease(agent, 'queue-refresh-regression');
      const stopSubscription = store.runSaga(chatSubscribeSaga);
      cleanups.push(() => {
        stopSubscription();
        subscription.mockRestore();
        releaseChatInterestLease(agent, 'queue-refresh-regression');
      });
      store.dispatch(initializeChatRequested(agent, { wsId: ws }));
      await vi.waitFor(() => expect(onTranscript).toBeTypeOf('function'));
      const transcript = {
        messages: [previous],
        truncated: false,
        totalMessages: 1,
        isStreaming: false,
        fromSnapshot: true,
      } as Parameters<NonNullable<typeof onTranscript>>[0];
      onTranscript!(transcript);
      const settle = async () => {
        // No further backend events: a feedback loop must not keep reading every turn.
        for (let i = 0; i < 20; i++) await new Promise((resolve) => setTimeout(resolve, 0));
      };
      await settle();
      beginSubmissionRead(agent, ws, 'queue').complete([original]);
      beginSubmissionRead(agent, ws, 'history').complete([]);
      expect(display().queue[0].blocksMutations).toBe(false);
      let failHistory = rejectHistory;
      wire.request.mockClear().mockImplementation((method, params) => {
        if (method === 'agent.getQueue') return Promise.resolve({ queue: [original] });
        if (method === 'agent.getConversation' && failHistory)
          return Promise.reject(new Error('queue refresh history failure'));
        return baseReply(method, params);
      });
      cleanups.push(store.runSaga(chatReadSaga));
      emit('agent:queue:updated', { queue: [original] });
      await settle();
      const reads = () =>
        ['agent.getQueue', 'agent.getConversation'].map(
          (method) => wire.request.mock.calls.filter(([name]) => name === method).length,
        );
      expect.soft(reads()).toEqual([1, 1]);
      expect.soft(display().queue[0].blocksMutations).toBe(rejectHistory);
      const settledReads = reads();
      await settle();
      expect.soft(reads()).toEqual(settledReads);
      // A genuinely new subscription delivery remains evidence, even with the
      // same object/content. It must invalidate and recover both read fences.
      failHistory = false;
      onTranscript!(transcript);
      expect(display().queue[0].blocksMutations).toBe(true);
      await settle();
      expect(reads()).toEqual(settledReads.map((count) => count + 1));
      expect(display().queue[0].blocksMutations).toBe(false);
      expect(
        store.state.agentSessions.byAgentId[agent].messages.map((message) => message.id),
      ).toEqual(['previous']);
      expect(sends()).toEqual([]);
      expect(queues()).toEqual([]);
    },
  );
});
