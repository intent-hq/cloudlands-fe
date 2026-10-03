import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const wire = vi.hoisted(() => ({ request: vi.fn() }));
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
vi.mock('svelte', async (original) => ({ ...(await original()), getContext: () => undefined }));
import { store } from '$store/renderer/store';
import { createAdmittedLegacyPrincipal } from '../../test/fixtures/admitted-legacy-principal';
import { setWorkspaceEntity } from '$store/renderer/slices/workspace/workspace-slice';
import {
  bulkUpsertSessions,
  agentSessionRetryLastMessageRequested,
} from '$store/renderer/slices/agent-session/agent-session-slice';
import { agentMutationSaga } from '$store/renderer/slices/agent-session/sagas/agent-mutation-saga';
import { chatSendSaga } from '$store/renderer/slices/chat-state/sagas/chat-send-saga';
import { submitChatMessage } from '$features/agent/chat-submission';
import { admitAgentSubmission } from '$store/renderer/slices/pending-submissions/pending-submissions-admission';
import { pendingSubmissionSettled } from '$store/renderer/slices/pending-submissions/pending-submissions-slice';
import { selectAgentSubmissionDisplay } from '$store/renderer/slices/pending-submissions/pending-submissions-selectors';
import { announceSubmissionDelivery } from '$features/agent/submission-evidence';
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
