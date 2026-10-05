import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StreamingStore } from '@themislib/themis/streaming-store';
import type { Workspace } from '$shared/types';
import { createAdmittedLegacyPrincipal } from '../../test/fixtures/admitted-legacy-principal';
import { reducers } from '$store/renderer/reducer';
import { setWorkspaceEntity } from '$store/renderer/slices/workspace/workspace-slice';
import { selectPendingSubmissionDisplay } from '$store/renderer/slices/pending-submissions/pending-submissions-selectors';
import { pendingSubmissionSettled } from '$store/renderer/slices/pending-submissions/pending-submissions-slice';
import { QUESTION_RESOURCE_MIME_TYPE } from '$shared/types/question-resource';
import { buildAnswerMessageMetadata } from '$lib/components/chat/questions/answer-message';
import { deriveWizardPendingQuestions } from '$lib/components/chat/questions/wizard-gate';
import { updateSession } from '$store/renderer/slices/agent-session/agent-session-slice';
import { submitChatMessage } from './chat-submission';

import { chatSendSaga } from '$store/renderer/slices/chat-state/sagas/chat-send-saga';
import { bulkUpsertSessions } from '$store/renderer/slices/agent-session/agent-session-slice';
import { setChatDraft } from '$store/renderer/slices/transient-ui/transient-ui-slice';
import { selectChatDraft } from '$store/renderer/slices/transient-ui/transient-ui-selectors';
import { createMessageId } from '$shared/types/branded-ids';
import type { AgentSession } from '$shared/types';
const pipeline = vi.hoisted(() => ({ send: vi.fn(), place: vi.fn(), queue: vi.fn() }));
vi.mock('./agent-send', () => ({ sendMessage: pipeline.send }));
vi.mock('$lib/components/chat/input/image-attachment-placement', () => ({
  toImageReferenceBlocks: pipeline.place,
  imageRetryBlocks: (_error: unknown, blocks: unknown) => blocks,
}));
vi.mock('$lib/client', () => ({ appClient: { agents: { queue: pipeline.queue } } }));
vi.mock('./agent-queue-read-service', () => ({
  hydrateAgentQueue: async () => {},
  getAgentQueueEventSnapshotSeq: () => 0,
}));
vi.mock('./chat-read-service', () => ({ loadChatTranscript: async () => {} }));
let store: StreamingStore<typeof reducers>;
let dispose: () => void;
beforeEach(() => {
  pipeline.send.mockReset();
  pipeline.queue.mockReset().mockResolvedValue({ success: true });
  pipeline.place.mockReset();
  store = new StreamingStore(reducers, []);
  const initial = createAdmittedLegacyPrincipal();
  initial.principal.snapshot!.capabilities.submissionCorrelation = 1;
  dispose = store.init(initial);
  store.dispatch(setWorkspaceEntity({ id: 'workspace', myRole: 'owner' } as Workspace));
});
afterEach(() => dispose());
vi.mock('$lib/client/live/backend-transport', () => ({ onBackendReconnected: () => () => {} }));

function display(agentId = 'agent') {
  const scope = store.state.pendingSubmissions.byAgentId[agentId].scope;
  return selectPendingSubmissionDisplay.select(store.state, scope);
}

describe('conversation admission before serialized preparation', () => {
  it('stages two identical sends synchronously with independent canonical IDs and attachment previews', () => {
    const payload = {
      wsId: 'workspace',
      text: 'hello',
      userAppMessageId: 'app-one',
      imageBlocks: [{ type: 'image' as const, data: 'aGVsbG8=', mimeType: 'image/png' }],
    };
    expect(submitChatMessage(store, 'agent', payload)).toBe(true);
    expect(submitChatMessage(store, 'agent', { ...payload, userAppMessageId: 'app-two' })).toBe(
      true,
    );
    const rows = display().conversation;
    expect(rows.map((row) => row.content)).toEqual(['hello', 'hello']);
    expect(new Set(rows.map((row) => row.id)).size).toBe(2);
    expect(rows[0].id).not.toBe('app-one');
    expect(rows[0].imageBlocks).toEqual(payload.imageBlocks);
    expect(store.state.agentSessions.byAgentId.agent).toBeUndefined();
    expect(store.state.agentQueue.byAgentId.agent).toBeUndefined();
  });

  it('rejects empty or inaccessible submissions without consuming a draft', () => {
    expect(submitChatMessage(store, 'agent', { wsId: 'workspace', text: ' ' })).toBe(false);
    store.dispatch(
      setWorkspaceEntity({ id: 'workspace', myRole: 'viewer', canManage: false } as Workspace),
    );
    expect(submitChatMessage(store, 'agent', { wsId: 'workspace', text: 'keep my draft' })).toBe(
      false,
    );
    expect(store.state.pendingSubmissions.byAgentId.agent).toBeUndefined();
  });

  it('moves an acknowledged direct send to the queue without mutating authoritative queue state', () => {
    submitChatMessage(store, 'agent', { wsId: 'workspace', text: 'hello' });
    const row = display().conversation[0];
    const scope = store.state.pendingSubmissions.byAgentId.agent.scope;
    store.dispatch(
      pendingSubmissionSettled(scope, row.id, 'accepted', Date.now(), undefined, true),
    );
    expect(display().conversation).toEqual([]);
    expect(display().queue.map((row) => row.content)).toEqual(['hello']);
    expect(store.state.agentQueue.byAgentId.agent).toBeUndefined();
  });
  it('stages the second send while the first is blocked in image preparation and preserves a newer draft', async () => {
    store.dispatch(
      bulkUpsertSessions([
        {
          id: 'agent',
          workspaceId: 'workspace',
          status: 'runtime_idle',
          messages: [
            {
              id: createMessageId('msg_earlier'),
              role: 'user',
              contentBlocks: [{ type: 'text', text: 'earlier' }],
              timestamp: new Date().toISOString(),
            },
          ],
        } as AgentSession,
      ]),
    );
    let resolvePlacement!: (images: unknown[]) => void;
    pipeline.place.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvePlacement = resolve;
        }),
    );
    pipeline.send.mockResolvedValue(undefined);
    const stop = store.runSaga(chatSendSaga);
    try {
      submitChatMessage(store, 'agent', {
        wsId: 'workspace',
        text: 'first',
        imageBlocks: [{ type: 'image', data: 'aGVsbG8=', mimeType: 'image/png' }],
      });
      submitChatMessage(store, 'agent', { wsId: 'workspace', text: 'second' });
      expect(display().conversation.map((row) => row.content)).toEqual(['first', 'second']);
      expect(pipeline.send).not.toHaveBeenCalled();
      store.dispatch(setChatDraft('workspace', 'agent', 'new unsent draft'));
      await vi.waitFor(() => expect(resolvePlacement).toBeTypeOf('function'));
      resolvePlacement([{ type: 'image', attachmentId: 'placed-image' }]);
      await vi.waitFor(() => expect(pipeline.queue).toHaveBeenCalledOnce());
      expect(pipeline.send).toHaveBeenCalledOnce();
      expect(pipeline.send.mock.calls[0][1]).toBe('first');
      expect(pipeline.queue.mock.calls[0][1]).toBe('second');
      expect(pipeline.queue.mock.calls[0][2].messageId).toBe(display().queue[0].key);
      expect(pipeline.send.mock.calls[0][3]).toMatchObject({
        imageBlocks: [{ type: 'image', attachmentId: 'placed-image' }],
        submission: { id: display().conversation[0].id },
      });
      expect(selectChatDraft.select(store.state, 'workspace', 'agent')).toBe('new unsent draft');
    } finally {
      stop();
    }
  });

  it('keeps recovery payload separate from a newer draft when attachment preparation rejects', async () => {
    pipeline.place.mockRejectedValue(new Error('upload refused'));
    const stop = store.runSaga(chatSendSaga);
    try {
      submitChatMessage(store, 'agent', {
        wsId: 'workspace',
        text: 'recover me',
        imageBlocks: [{ type: 'image', data: 'aGVsbG8=', mimeType: 'image/png' }],
      });
      store.dispatch(setChatDraft('workspace', 'agent', 'newer draft'));
      await vi.waitFor(() => expect(store.state.chatState.byAgentId.agent?.error).toBeTruthy());
      expect(display().conversation).toEqual([]);
      expect(store.state.chatState.byAgentId.agent.lastAttemptedMessage?.text).toBe('recover me');
      expect(selectChatDraft.select(store.state, 'workspace', 'agent')).toBe('newer draft');
    } finally {
      stop();
    }
  });
});


describe('Q&A local admission', () => {
  const question = {
    id: 'question-one', role: 'assistant' as const, timestamp: '2026-10-05T00:00:00Z',
    contentBlocks: [{ type: 'resource' as const, resource: {
      uri: 'intent-question://one', name: 'Approach', mimeType: QUESTION_RESOURCE_MIME_TYPE,
      text: JSON.stringify({ attachmentId: 'one', header: 'Approach', question: 'Which approach?',
        multiSelect: false, options: [{ label: 'Small change' }, { label: 'Discuss first' }] }),
    } }],
  };
  const metadata = buildAnswerMessageMetadata(question.id);
  const payload = { wsId: 'workspace', text: 'Q: Which approach?\nA: Small change', messageMetadata: metadata };
  const wizard = () => deriveWizardPendingQuestions(store.state, 'agent', store.state.agentSessions.byAgentId.agent.messages);
  beforeEach(() => store.dispatch(bulkUpsertSessions([{
    id: 'agent', workspaceId: 'workspace', status: 'runtime_idle', messages: [question],
    metadata: { pendingQuestionsMessageId: question.id },
  } as AgentSession])));

  it('hides only the admitted answer set synchronously before preparation or ACK', () => {
    expect(wizard()?.messageId).toBe(question.id);
    expect(submitChatMessage(store, 'agent', payload)).toBe(true);
    expect(wizard()).toBeNull();
    expect(display().conversation[0]).toMatchObject({ content: payload.text, messageMetadata: metadata, status: 'preparing' });
    expect(store.state.agentSessions.byAgentId.agent.metadata?.pendingQuestionsMessageId).toBe(question.id);
    expect(store.state.agentQueue.byAgentId.agent).toBeUndefined();
    expect(pipeline.send).not.toHaveBeenCalled();
  });

  it('keeps unrelated and newer question sets available during an old answer flight', () => {
    submitChatMessage(store, 'agent', { ...payload, messageMetadata: undefined });
    expect(wizard()?.messageId).toBe(question.id);
    submitChatMessage(store, 'agent', payload);
    const next = { ...question, id: 'question-two' };
    store.dispatch(updateSession('agent', { messages: [question, next], metadata: { pendingQuestionsMessageId: next.id } }));
    expect(wizard()?.messageId).toBe(next.id);
  });

  it.each(['rejected', 'uncertain', 'accepted'] as const)('uses existing %s recovery without resolving the marker', (outcome) => {
    submitChatMessage(store, 'agent', payload);
    const entry = store.state.pendingSubmissions.byAgentId.agent;
    store.dispatch(pendingSubmissionSettled(entry.scope, display().conversation[0].id, outcome, Date.now()));
    expect(wizard()?.messageId ?? null).toBe(outcome === 'rejected' ? question.id : null);
    expect(store.state.agentSessions.byAgentId.agent.metadata?.pendingQuestionsMessageId).toBe(question.id);
  });
});
