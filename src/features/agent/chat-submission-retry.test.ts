import { QUESTION_RESOURCE_MIME_TYPE } from '$shared/types/question-resource';
import { buildAnswerMessageMetadata } from '$lib/components/chat/questions/answer-message';
import { deriveWizardPendingQuestions } from '$lib/components/chat/questions/wizard-gate';
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
import { queuedMessageMutationRequested } from '$store/renderer/slices/agent-queue/agent-queue-slice';
import type { QueuedMessageMutationOperation } from '$store/renderer/slices/agent-queue/agent-queue-types';
import {
  initializeChatRequested,
  sendQueuedMessagesNowRequested,
  clearQueuedMessagesRequested,
  chatLastAttemptedMessageSet,
} from '$store/renderer/slices/chat-state/chat-state-slice';
import { pendingScopeReleased } from '$store/renderer/slices/pending-submissions/pending-submissions-slice';
import { submitChatMessage } from '$features/agent/chat-submission';
import { admitAgentSubmission } from '$store/renderer/slices/pending-submissions/pending-submissions-admission';
import { pendingSubmissionSettled } from '$store/renderer/slices/pending-submissions/pending-submissions-slice';
import {
  selectAgentSubmissionDisplay,
  selectSubmissionObserved,
} from '$store/renderer/slices/pending-submissions/pending-submissions-selectors';
import {
  beginSubmissionRead,
  announceSubmissionDelivery,
} from '$features/agent/submission-evidence';
import { loadChatTranscript } from '$features/agent/chat-read-service';
import {
  hydrateAgentQueue,
  __resetAgentQueueReadServiceForTests,
} from '$features/agent/agent-queue-read-service';
import { getItem, getItems } from '@themislib/themis/utils/collections/collection-utils';
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
const requestQueueMutation = (messageId: string, operation: QueuedMessageMutationOperation) => {
  const requestId = crypto.randomUUID();
  store.dispatch(
    queuedMessageMutationRequested({
      requestId,
      consumerId: 'chat-submission-retry-test',
      workspaceId: ws,
      agentId: agent,
      messageId,
      operation,
    }),
  );
  return requestId;
};
const expectQueueMutationStatus = async (
  requestId: string,
  status: 'succeeded' | 'failed' | 'cancelled',
) =>
  vi.waitFor(() =>
    expect(getItem(store.state.agentQueue.mutations, requestId)?.status).toBe(status),
  );
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
      if (kind === 'send' || kind === 'remove') {
        const requestId = requestQueueMutation(a.submission.id, {
          kind: kind === 'send' ? 'sendNow' : 'remove',
        });
        await expectQueueMutationStatus(requestId, 'failed');
      } else {
        const result = store.dispatch(
          kind === 'send-all'
            ? sendQueuedMessagesNowRequested(agent, ws, [a.submission.id])
            : clearQueuedMessagesRequested(agent, ws, [a.submission.id]),
        );
        await expect(result).rejects.toThrow();
      }
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

it('observes the first deferred snapshot and still restores its in-flight transcript after a read', async () => {
  agent = 'deferred-' + crypto.randomUUID();
  const a = admit('Deferred user');
  let onTranscript: Parameters<typeof appClient.chat.subscribe>[1] | undefined;
  let resolveShell: ((reply: unknown) => void) | undefined;
  const shellReply = new Promise((resolve) => {
    resolveShell = resolve;
  });
  wire.request.mockImplementation((method, params) =>
    method === 'agent.get' ? shellReply : baseReply(method, params),
  );
  const subscription = vi.spyOn(appClient.chat, 'subscribe').mockImplementation((_id, handler) => {
    onTranscript = handler;
    return () => {};
  });
  acquireChatInterestLease(agent, 'queue-deferred-regression');
  cleanups.push(
    () => {
      subscription.mockRestore();
      releaseChatInterestLease(agent, 'queue-deferred-regression');
    },
    store.runSaga(chatSubscribeSaga),
    store.runSaga(chatReadSaga),
  );
  store.dispatch(initializeChatRequested(agent, { wsId: ws }));
  await vi.waitFor(() => expect(onTranscript).toBeTypeOf('function'));
  const live = {
    id: 'live-assistant',
    role: 'assistant',
    timestamp: '2026-10-03T00:00:00Z',
    contentBlocks: [{ type: 'text', text: 'Still working' }],
    isStreaming: true,
    streamingComplete: false,
  };
  onTranscript!({
    messages: [
      {
        ...previous,
        ...row(a),
        role: 'user',
        metadata: { submissionIds: [a.submission.id] },
        contentBlocks: [{ type: 'text', text: 'Deferred user' }],
      },
      live,
    ],
    truncated: false,
    totalMessages: 2,
    isStreaming: true,
    fromSnapshot: true,
  } as Parameters<NonNullable<typeof onTranscript>>[0]);
  const reference = { scope: a.scope, id: a.submission.id };
  expect(selectSubmissionObserved.select(store.state, reference)).toBe(false);
  expect(store.state.agentSessions.byAgentId[agent]).toBeUndefined();
  resolveShell!({ agent: shell() });
  await vi.waitFor(() =>
    expect(selectSubmissionObserved.select(store.state, reference)).toBe(true),
  );
  await loadChatTranscript(agent, ws);
  await vi.waitFor(() =>
    expect(store.state.agentSessions.byAgentId[agent].messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'live-assistant', isStreaming: true }),
      ]),
    ),
  );
  expect(sends()).toEqual([]);
  expect(queues()).toEqual([]);
});

// Both production sagas are required: a reducer-only fixture cannot detect read feedback.
const count = (method: string) =>
  wire.request.mock.calls.filter(([name]) => name === method).length;
const turn = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const noMutations = () =>
  expect(
    wire.request.mock.calls.filter(([name]) =>
      [
        'agent.sendMessage',
        'agent.queueMessage',
        'agent.sendQueuedMessageNow',
        'agent.sendQueuedMessagesNow',
        'agent.removeQueuedMessage',
        'agent.editQueuedMessage',
      ].includes(name),
    ),
  ).toEqual([]);
const history = (text: string) => ({
  messages: [{ ...previous, id: text, contentBlocks: [{ type: 'text', text }] }],
  totalMessages: 1,
  truncated: false,
});
const quiet = async () => {
  for (let n = 0; n < 20; n++) await turn();
};
async function standing() {
  const a = admitAgentSubmission(store, agent, ws, 1, { content: 'A', destination: 'queue' })!;
  const original = row(a, { mergeEligible: true });
  emit('agent:queue:updated', { queue: [original] });
  let handler: any;
  const subscription = vi
    .spyOn(appClient.chat, 'subscribe')
    .mockImplementation((_id: any, callback: any) => {
      handler = callback;
      return () => {};
    });
  acquireChatInterestLease(agent, 'optimistic-subscription-races');
  const stop = store.runSaga(chatSubscribeSaga);
  cleanups.push(() => {
    stop();
    subscription.mockRestore();
    releaseChatInterestLease(agent, 'optimistic-subscription-races');
  });
  store.dispatch(initializeChatRequested(agent, { wsId: ws }));
  await vi.waitFor(() => expect(handler).toBeTypeOf('function'));
  const snapshot = {
    messages: [previous],
    truncated: false,
    totalMessages: 1,
    isStreaming: false,
    fromSnapshot: true,
  };
  handler(snapshot);
  await turn();
  await turn();
  beginSubmissionRead(agent, ws, 'queue').complete([original]);
  beginSubmissionRead(agent, ws, 'history').complete([]);
  expect(display().queue[0].blocksMutations).toBe(false);
  wire.request.mockClear();
  return { a, original, handler, snapshot };
}

it('coalesces live subscription bursts during reads, rejects stale publication and restores live rows after partial history', async () => {
  const { original, handler } = await standing();
  const qs: ((v: any) => void)[] = [],
    hs: ((v: any) => void)[] = [];
  wire.request.mockImplementation((m, p) =>
    m === 'agent.getQueue'
      ? new Promise((r) => qs.push(r))
      : m === 'agent.getConversation'
        ? new Promise((r) => hs.push(r))
        : baseReply(m, p),
  );
  cleanups.push(store.runSaga(chatReadSaga));
  emit('agent:queue:updated', { queue: [original] });
  await vi.waitFor(() => {
    expect(qs).toHaveLength(1);
    expect(hs).toHaveLength(1);
  });
  const live = {
    id: 'live-race',
    role: 'assistant',
    timestamp: '2026-10-03T00:00:00Z',
    contentBlocks: [{ type: 'text', text: 'newest live text' }],
    isStreaming: true,
    streamingComplete: false,
  };
  const transcript = {
    messages: [previous, live],
    truncated: false,
    totalMessages: 2,
    isStreaming: true,
    fromSnapshot: false,
  };
  for (let n = 0; n < 10; n++) handler(transcript);
  await vi.waitFor(() =>
    expect(store.state.agentSessions.byAgentId[agent].messages).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'live-race' })]),
    ),
  );
  expect(display().queue[0].blocksMutations).toBe(true);
  qs[0]({ queue: [{ ...original, content: 'obsolete queue' }] });
  hs[0](history('obsolete history'));
  await vi.waitFor(() => {
    expect(qs).toHaveLength(2);
    expect(hs).toHaveLength(2);
  });
  expect(display().queue.map((r) => r.content)).toEqual(['A']);
  expect(store.state.agentSessions.byAgentId[agent].messages.map((m) => m.id)).toEqual([
    'previous',
    'live-race',
  ]);
  qs[1]({ queue: [{ ...original, content: 'fresh confirmed queue' }] });
  await turn();
  expect(display().queue[0].blocksMutations).toBe(true);
  hs[1]({ messages: [previous], totalMessages: 1, truncated: false });
  await vi.waitFor(() => expect(display().queue[0].blocksMutations).toBe(false));
  await quiet();
  expect(qs).toHaveLength(2);
  expect(hs).toHaveLength(2);
  expect(display().queue.map((r) => r.content)).toEqual(['fresh confirmed queue']);
  expect(store.state.agentSessions.byAgentId[agent].messages).toEqual(
    expect.arrayContaining([expect.objectContaining(live)]),
  );
  noMutations();
});

it.each(['send', 'send-all', 'clear', 'remove'] as const)(
  'bounds queue-read errors and recovers the actual %s handler after a genuine delivery',
  async (kind) => {
    const { a, original, handler, snapshot } = await standing();
    let failQueue = true;
    wire.request.mockImplementation((m, p) => {
      if (m === 'agent.getQueue')
        return failQueue
          ? Promise.reject(new Error('independent queue failure'))
          : Promise.resolve({ queue: [original] });
      if (
        [
          'agent.sendQueuedMessageNow',
          'agent.sendQueuedMessagesNow',
          'agent.removeQueuedMessage',
        ].includes(m)
      )
        return Promise.resolve({ success: true, queued: true, messageIds: [a.submission.id] });
      return baseReply(m, p);
    });
    cleanups.push(store.runSaga(chatReadSaga));
    startSending();
    store.dispatch(setChatDraft(ws, agent, 'keep newer draft'));
    const dispatch = () => {
      if (kind === 'send' || kind === 'remove')
        return requestQueueMutation(a.submission.id, {
          kind: kind === 'send' ? 'sendNow' : 'remove',
        });
      return store.dispatch(
        kind === 'send-all'
          ? sendQueuedMessagesNowRequested(agent, ws, [a.submission.id])
          : clearQueuedMessagesRequested(agent, ws, [a.submission.id]),
      );
    };
    emit('agent:queue:updated', { queue: [original] });
    await quiet();
    expect(count('agent.getQueue')).toBe(1);
    expect(count('agent.getConversation')).toBe(1);
    expect(display().queue[0].blocksMutations).toBe(true);
    const blocked = dispatch();
    if (typeof blocked === 'string') await expectQueueMutationStatus(blocked, 'failed');
    else await expect(blocked).rejects.toThrow();
    await turn();
    noMutations();
    expect(display().queue[0].confirmedId).toBe(a.submission.id);
    failQueue = false;
    handler(snapshot);
    await vi.waitFor(() => expect(display().queue[0].blocksMutations).toBe(false));
    await quiet();
    expect(count('agent.getQueue')).toBe(2);
    expect(count('agent.getConversation')).toBe(2);
    noMutations();
    const allowed = dispatch();
    if (typeof allowed === 'string') await expectQueueMutationStatus(allowed, 'succeeded');
    else await allowed;
    const method =
      kind === 'send'
        ? 'agent.sendQueuedMessageNow'
        : kind === 'send-all'
          ? 'agent.sendQueuedMessagesNow'
          : 'agent.removeQueuedMessage';
    await vi.waitFor(() => expect(count(method)).toBe(1));
    expect(wire.request.mock.calls.find(([m]) => m === method)?.[1]).toEqual({
      agentId: agent,
      workspaceId: ws,
      ...(kind === 'send-all' ? { messageIds: [a.submission.id] } : { messageId: a.submission.id }),
    });
    expect(selectChatDraft.select(store.state, ws, agent)).toBe('keep newer draft');
    expect(count('agent.sendMessage')).toBe(0);
    expect(count('agent.queueMessage')).toBe(0);
  },
);

// Exercise stream:start after admission: mounting after the event misses the lifecycle guard.
it.each([
  { startAfterAdmission: false, automaticRefresh: false },
  { startAfterAdmission: true, automaticRefresh: false },
  { startAfterAdmission: true, automaticRefresh: true },
])(
  'allows confirmed remove during normal streaming (%j)',
  async ({ startAfterAdmission, automaticRefresh }) => {
    const streamStart = () =>
      emit('agent:stream:start', { messageId: 'msg_provider', turnId: 'provider-turn' });
    if (!startAfterAdmission) streamStart();
    const sent = admit('already delivered first prompt');
    const delivered = {
      ...previous,
      id: sent.submission.id,
      author: row(sent).author,
      metadata: { submissionIds: [sent.submission.id] },
    };
    beginSubmissionRead(agent, ws, 'history').complete([row(sent)]);
    store.dispatch(
      pendingSubmissionSettled(sent.scope, sent.submission.id, 'accepted', Date.now()),
    );
    if (startAfterAdmission) streamStart();
    const queued = admitAgentSubmission(store, agent, ws, 1, {
      content: 'confirmed next prompt',
      destination: 'queue',
    })!;
    const confirmed = row(queued, { mergeEligible: true });
    emit('agent:queue:updated', { queue: [confirmed] });
    store.dispatch(
      pendingSubmissionSettled(
        queued.scope,
        queued.submission.id,
        'accepted',
        Date.now(),
        confirmed,
        true,
      ),
    );
    wire.request.mockImplementation(async (method, params) => {
      if (method === 'agent.getQueue') return { queue: [confirmed] };
      if (method === 'agent.getConversation')
        return { messages: [delivered], totalMessages: 1, truncated: false };
      if (method === 'agent.get')
        return { agent: { ...shell(), isResponding: true, isStreaming: true } };
      if (method === 'agent.removeQueuedMessage') return { success: true };
      return baseReply(method, params);
    });
    cleanups.push(store.runSaga(chatReadSaga));
    startSending();
    if (automaticRefresh) {
      emit('agent:queue:updated', { queue: [confirmed] });
      await vi.waitFor(() => {
        expect(count('agent.getQueue')).toBe(1);
        expect(count('agent.getConversation')).toBe(1);
      });
    } else await Promise.all([hydrateAgentQueue(agent, ws), loadChatTranscript(agent, ws)]);
    await vi.waitFor(() => expect(display().queue[0].blocksMutations).toBe(false));
    const entry = store.state.pendingSubmissions.byAgentId[agent];
    expect(getItems(entry.submissions)).toEqual([]);
    expect(getItems(entry.operations)).toEqual([]);
    expect(getItems(entry.processing)).toEqual([]);
    expect(entry.queueFresh && entry.historyFresh).toBe(true);
    expect(entry.refreshNeeded).toBe(false);
    const requestId = requestQueueMutation(confirmed.id, { kind: 'remove' });
    await expectQueueMutationStatus(requestId, 'succeeded');
    await vi.waitFor(() => expect(count('agent.removeQueuedMessage')).toBe(1));
    expect(
      wire.request.mock.calls.find(([method]) => method === 'agent.removeQueuedMessage')?.[1],
    ).toEqual({
      agentId: agent,
      workspaceId: ws,
      messageId: confirmed.id,
    });
  },
);

it('keeps confirmed controls blocked while a drained contribution lacks delivery evidence', async () => {
  const processing = admit('draining prompt');
  const consumed = row(processing);
  emit('agent:queue:processing', {
    messageId: consumed.id,
    turnId: consumed.turnId,
    queuedMessages: [consumed],
  });
  store.dispatch(
    pendingSubmissionSettled(processing.scope, processing.submission.id, 'accepted', Date.now()),
  );
  emit('agent:stream:start', { messageId: 'msg_provider', turnId: consumed.turnId });
  const next = admitAgentSubmission(store, agent, ws, 1, {
    content: 'next prompt',
    destination: 'queue',
  })!;
  const confirmed = row(next, { mergeEligible: true });
  emit('agent:queue:updated', { queue: [confirmed] });
  store.dispatch(
    pendingSubmissionSettled(
      next.scope,
      next.submission.id,
      'accepted',
      Date.now(),
      confirmed,
      true,
    ),
  );
  beginSubmissionRead(agent, ws, 'queue').complete([confirmed]);
  beginSubmissionRead(agent, ws, 'history').complete([]);
  const entry = store.state.pendingSubmissions.byAgentId[agent];
  expect(entry.refreshNeeded).toBe(false);
  expect(getItems(entry.processing).map((message) => message.id)).toEqual([consumed.id]);
  expect(display().queue[0].blocksMutations).toBe(true);
  startSending();
  const requestId = requestQueueMutation(confirmed.id, { kind: 'remove' });
  await expectQueueMutationStatus(requestId, 'failed');
  await quiet();
  expect(count('agent.removeQueuedMessage')).toBe(0);
});

describe('Q&A admission through the real send and recovery pipeline', () => {
  const question = {
    id: 'question-before-send',
    role: 'assistant',
    timestamp: '2026-10-04T00:00:00Z',
    contentBlocks: [
      {
        type: 'resource',
        resource: {
          uri: 'intent-question://qa',
          name: 'Approach',
          mimeType: QUESTION_RESOURCE_MIME_TYPE,
          text: JSON.stringify({
            attachmentId: 'qa',
            header: 'Approach',
            question: 'Which approach?',
            options: [{ label: 'Small' }, { label: 'Large' }],
          }),
        },
      },
    ],
  };
  const text = 'Q: Which approach?\nA: Small';
  const messageMetadata = buildAnswerMessageMetadata(question.id);
  const wizard = () =>
    deriveWizardPendingQuestions(
      store.state,
      agent,
      store.state.agentSessions.byAgentId[agent].messages,
    );
  const qaReply = (method: string, params: any) => {
    if (method === 'agent.get')
      return Promise.resolve({
        agent: { ...shell(), metadata: { pendingQuestionsMessageId: question.id } },
      });
    if (method === 'agent.getConversation')
      return Promise.resolve({
        messages: [previous, question],
        totalMessages: 2,
        truncated: false,
      });
    return baseReply(method, params);
  };
  beforeEach(() => {
    store.dispatch(
      updateAgentSessionFields(agent, {
        messages: [previous, question] as any,
        metadata: { pendingQuestionsMessageId: question.id },
      }),
    );
    wire.request.mockImplementation(qaReply);
  });

  it.each(['rejected', 'uncertain'] as const)(
    'retains answer metadata for %s recovery and only explicitly resends',
    async (outcome) => {
      startSending();
      let count = 0;
      wire.request.mockImplementation(async (method, params) => {
        if (method === 'agent.sendMessage' && ++count === 1) {
          if (outcome === 'uncertain') throw new Error('ACK lost after write');
          return { success: false, error: 'request rejected' };
        }
        return qaReply(method, params);
      });
      expect(wizard()?.messageId).toBe(question.id);
      expect(submitChatMessage(store, agent, { wsId: ws, text, messageMetadata })).toBe(true);
      expect(wizard()).toBeNull();
      store.dispatch(setChatDraft(ws, agent, 'newer draft'));
      await vi.waitFor(() => expect(store.state.chatState.byAgentId[agent]?.error).toBeTruthy());
      const attempt = store.state.chatState.byAgentId[agent].lastAttemptedMessage!;
      expect(attempt).toMatchObject({
        text,
        options: { messageMetadata },
        submission: { outcome },
      });
      expect(wizard()?.messageId ?? null).toBe(outcome === 'rejected' ? question.id : null);
      expect(sends()).toHaveLength(1);
      expect(sends()[0][1]).toMatchObject({
        agentId: agent,
        workspaceId: ws,
        content: text,
        messageMetadata,
        messageId: attempt.submission!.reference.id,
      });
      await requestChatMessageRetry(agent, ws);
      if (outcome === 'uncertain') {
        expect(sends()).toHaveLength(1);
        warningChoice().action.onClick();
      } else expect(wire.warning).not.toHaveBeenCalled();
      await vi.waitFor(() => expect(sends()).toHaveLength(2));
      await vi.waitFor(() => expect(display().conversation.at(-1)?.status).toBe('accepted'));
      await Promise.all([loadChatTranscript(agent, ws), hydrateAgentQueue(agent, ws)]);
      expect(sends()[1][1]).toMatchObject({ content: text, messageMetadata });
      expect(sends()[1][1].messageId).not.toBe(sends()[0][1].messageId);
      expect(selectChatDraft.select(store.state, ws, agent)).toBe('newer draft');
      expect(wizard()).toBeNull();
      expect(wire.request.mock.calls.some(([method]) => method === 'agent.dismissQuestions')).toBe(
        false,
      );
    },
  );

  it('keeps an answer hidden through correlated stream evidence before a delayed rejection ACK', async () => {
    startSending();
    let reply!: (value: unknown) => void;
    wire.request.mockImplementation((method, params) =>
      method === 'agent.sendMessage'
        ? new Promise((resolve) => {
            reply = resolve;
          })
        : qaReply(method, params),
    );
    submitChatMessage(store, agent, { wsId: ws, text, messageMetadata });
    expect(wizard()).toBeNull();
    await vi.waitFor(() => expect(reply).toBeTypeOf('function'));
    const entry = store.state.pendingSubmissions.byAgentId[agent];
    const id = sends()[0][1].messageId;
    emit('agent:message', {
      id,
      role: 'user',
      content: text,
      submissionIds: [id],
      author: { principalId: entry.scope.principalId },
    });
    expect(display().conversation[0]).toMatchObject({ id, status: 'accepted' });
    expect(wizard()).toBeNull();
    reply({ success: false, error: 'late rejected response' });
    await vi.waitFor(() => expect(store.state.chatState.byAgentId[agent]?.error).toBeTruthy());
    await requestChatMessageRetry(agent, ws);
    expect(sends()).toHaveLength(1);
    expect(wizard()).toBeNull();
  });
});
