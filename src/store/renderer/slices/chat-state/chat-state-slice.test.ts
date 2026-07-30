import {
  describe,
  expect,
  it,
} from 'vitest';
import type { StoreState } from '../../types';
import {
  chatStateReducer,
  initialState,
  emptyChatAgentState,
  chatInitialized,
  chatInitFailed,
  chatSendStarted,
  chatSendFailed,
  chatInterrupted,
  chatStopInitiated,
  chatStopCompleted,
  chatReset,
  chatStreamingReconciled,
  streamChunkReceived,
  streamEnded,
  streamFailed,
  chatModelUnavailableCleared,
  chatRebindStarted,
  chatRebindEnded,
  chatTrackedWorkspaceSet,
  streamStatusReceived,
  transcriptHydrationStarted,
  transcriptHydrationSettled,
  chatLastAttemptedMessageSet,
  chatQueueProcessingReceived,
  chatQueuedRetryRecordSet,
  chatQueuedRetryRecordParked,
  chatQueuedRetryRecordUpdated,
  chatQueuedRetryRecordsCleared,
} from './chat-state-slice';
import {
  removeQueuedMessageFromAgentQueue,
  replaceAgentQueue,
} from '../agent-queue/agent-queue-slice';
import type { QueuedMessage } from '$shared/types';
import {
  selectChatAgentState,
  selectChatError,
  selectChatLastMessageTime,
  selectTranscriptHydration,
} from './chat-state-selectors';
import { workspaceDeleted } from '../workspace-lifecycle/workspace-lifecycle-slice';
import { eventReceived } from '../workspace-events/workspace-events-slice';
import type {
  AgentIdleEvent,
  AgentStatusChangedEvent,
} from '$features/events/types';

const AGENT = 'agent-1';

function asStoreState(chatState: ReturnType<typeof chatStateReducer>): StoreState {
  return { chatState } as unknown as StoreState;
}

function stateWithModelUnavailable() {
  // No reducer action populates modelUnavailable anymore (the firehose
  // complete-message derivation is gone); construct the state directly to
  // exercise the clear paths.
  return {
    byAgentId: {
      [AGENT]: {
        ...emptyChatAgentState,
        agentId: AGENT,
        modelUnavailable: { failedModel: 'slow-model', nextAvailableModel: 'fast-model' },
      },
    },
  };
}



describe('chatStateReducer', () => {
  it('returns initial state', () => {
    expect(chatStateReducer(undefined, { type: '@@INIT' })).toEqual(initialState);
  });

  it('chatInitialized sets agent state (isStreaming/isProcessing now on agent-session)', () => {
    const state = chatStateReducer(
      initialState,
      chatInitialized(AGENT, {
        isStreaming: false,
        lastAttemptedMessage: null,
      }),
    );
    const agent = state.byAgentId[AGENT];
    expect(agent.agentId).toBe(AGENT);
    expect(agent.error).toBeNull();
    // isStreaming/isProcessing are no longer on chat-state
    expect(agent).not.toHaveProperty('isStreaming');
    expect(agent).not.toHaveProperty('isProcessing');
  });

  it('chatInitFailed sets error', () => {
    const state = chatStateReducer(initialState, chatInitFailed(AGENT, 'oops'));
    const agent = state.byAgentId[AGENT];
    expect(agent.error).toBe('oops');
  });

  it('chatInitFailed clears stale model-unavailable state so init errors are visible', () => {
    const state = chatStateReducer(stateWithModelUnavailable(), chatInitFailed(AGENT, 'oops'));
    const agent = state.byAgentId[AGENT];
    expect(agent.error).toBe('oops');
    expect(agent.modelUnavailable).toBeNull();
  });

  it('chatSendStarted sets UI flags (isStreaming/isProcessing now on agent-session)', () => {
    const action = chatSendStarted(AGENT);
    const state = chatStateReducer(initialState, action);
    const agent = state.byAgentId[AGENT];
    expect(agent.error).toBeNull();
    expect(agent.receivedFirstChunk).toBe(false);
    expect(agent.lastMessageTime).toBe(action.payload.timestamp);
    expect(selectChatLastMessageTime.select(asStoreState(state), AGENT)).toBe(action.payload.timestamp);
  });

  it('chatSendStarted clears stale model-unavailable recovery state', () => {
    const state = chatStateReducer(stateWithModelUnavailable(), chatSendStarted(AGENT));
    expect(state.byAgentId[AGENT].modelUnavailable).toBeNull();
  });

  it('chatSendFailed sets error', () => {
    const s1 = chatStateReducer(initialState, chatSendStarted(AGENT));
    const s2 = chatStateReducer(s1, chatSendFailed(AGENT, 'network error'));
    const agent = s2.byAgentId[AGENT];
    expect(agent.error).toBe('network error');
  });

  it('chatSendFailed clears stale model-unavailable state so send errors are visible', () => {
    const state = chatStateReducer(stateWithModelUnavailable(), chatSendFailed(AGENT, 'network error'));
    const agent = state.byAgentId[AGENT];
    expect(agent.error).toBe('network error');
    expect(agent.modelUnavailable).toBeNull();
  });

  it('chatSendFailed preserves lastAttemptedMessage so the banner retries the failed message (#969)', () => {
    // The send paths record the attempt (chatLastAttemptedMessageSet) BEFORE
    // the wire call; a failure must not wipe it — "Try again" pairs the error
    // banner with exactly the recorded payload.
    const attempted = { text: 'queued and failed', options: { model: 'fast-model' } };
    const s1 = chatStateReducer(initialState, chatLastAttemptedMessageSet(AGENT, attempted));
    const s2 = chatStateReducer(s1, chatSendFailed(AGENT, 'queueMessage rejected'));
    const agent = s2.byAgentId[AGENT];
    expect(agent.error).toBe('queueMessage rejected');
    expect(agent.lastAttemptedMessage).toEqual(attempted);
  });

  it('chatInterrupted clears streaming start time', () => {
    const s1 = chatStateReducer(initialState, chatSendStarted(AGENT));
    const s2 = chatStateReducer(s1, chatInterrupted(AGENT));
    const agent = s2.byAgentId[AGENT];
    expect(agent.streamingStartTime).toBeNull();
    expect(agent.error).toBeNull();
  });

  it('chatStopInitiated sets isInterrupting', () => {
    const state = chatStateReducer(initialState, chatStopInitiated(AGENT));
    expect(state.byAgentId[AGENT].isInterrupting).toBe(true);
  });

  it('chatStopCompleted clears interrupting and streaming start time', () => {
    const s1 = chatStateReducer(initialState, chatSendStarted(AGENT));
    const s2 = chatStateReducer(s1, chatStopInitiated(AGENT));
    const s3 = chatStateReducer(s2, chatStopCompleted(AGENT));
    const agent = s3.byAgentId[AGENT];
    expect(agent.isInterrupting).toBe(false);
    expect(agent.streamingStartTime).toBeNull();
  });

  it('chatReset returns to empty state', () => {
    const s1 = chatStateReducer(initialState, chatSendStarted(AGENT));
    const s2 = chatStateReducer(s1, chatReset(AGENT));
    expect(s2.byAgentId[AGENT]).toEqual(emptyChatAgentState);
  });

  it('streamEnded clears streaming metadata', () => {
    const s1 = chatStateReducer(initialState, chatSendStarted(AGENT));
    const s2 = chatStateReducer(s1, streamEnded(AGENT));
    const agent = s2.byAgentId[AGENT];
    expect(agent.streamingStartTime).toBeNull();
    expect(agent.receivedFirstChunk).toBe(false);
  });

  it('chatLastAttemptedMessageSet records the retry payload (#941)', () => {
    const attempted = {
      text: 'send this',
      options: {
        noteIds: ['note-1'],
        // #965: image attachments ride the recorded payload so Try again resends them.
        imageBlocks: [{ type: 'image' as const, data: 'aGVsbG8=', mimeType: 'image/png' }],
      },
    };
    const s1 = chatStateReducer(initialState, chatLastAttemptedMessageSet(AGENT, attempted));
    expect(s1.byAgentId[AGENT].lastAttemptedMessage).toEqual(attempted);
    const s2 = chatStateReducer(s1, chatLastAttemptedMessageSet(AGENT, null));
    expect(s2.byAgentId[AGENT].lastAttemptedMessage).toBeNull();
  });

  it('chatSendStarted preserves a previously recorded lastAttemptedMessage', () => {
    const attempted = { text: 'edited text' };
    let s = chatStateReducer(initialState, chatLastAttemptedMessageSet(AGENT, attempted));
    s = chatStateReducer(s, chatSendStarted(AGENT));
    expect(s.byAgentId[AGENT].lastAttemptedMessage).toEqual(attempted);
  });

  describe('turn-scoped queued retry records (#999)', () => {
    const queuedEntry = (id: string, turnId = id, position = 0): QueuedMessage => ({
      id,
      content: `content of ${id}`,
      queuedAt: '2026-01-01T00:00:00.000Z',
      position,
      turnId,
    });

    it('chatQueuedRetryRecordSet parks the record without touching lastAttemptedMessage', () => {
      let s = chatStateReducer(initialState, chatLastAttemptedMessageSet(AGENT, { text: 'A' }));
      s = chatStateReducer(s, chatQueuedRetryRecordSet(AGENT, 'qm-1', { text: 'B' }, 'qm-1'));
      expect(s.byAgentId[AGENT].lastAttemptedMessage).toEqual({ text: 'A' });
      expect(s.byAgentId[AGENT].queuedRetryRecords).toEqual({
        'qm-1': { seq: 1, record: { text: 'B' }, turnId: 'qm-1' },
      });
    });

    it('parking a record does not clear the error; the drain-start promotion does (stale-banner regression)', () => {
      // Pre-fix staleness mechanism: a failed turn's banner survived a
      // successful queued retry because nothing on the promotion path cleared
      // it — the drained turn started with the previous turn's error still up
      // (which also suppressed the streaming indicator).
      let s = chatStateReducer(initialState, chatSendFailed(AGENT, 'boom'));
      s = chatStateReducer(s, chatQueuedRetryRecordSet(AGENT, 'qm-1', { text: 'retry' }, 'qm-1'));
      expect(s.byAgentId[AGENT].error).toBe('boom');
      // Drain start: the promoted record's turn is now active — clean slate.
      s = chatStateReducer(s, chatQueueProcessingReceived(AGENT, 'qm-1'));
      expect(s.byAgentId[AGENT].error).toBeNull();
      expect(s.byAgentId[AGENT].modelUnavailable).toBeNull();
      expect(s.byAgentId[AGENT].lastAttemptedMessage).toEqual({ text: 'retry' });
    });

    it('drain-start promotion clears stale modelUnavailable state', () => {
      let s = chatStateReducer(stateWithModelUnavailable(), chatQueuedRetryRecordSet(AGENT, 'qm-1', { text: 'retry' }, 'qm-1'));
      expect(s.byAgentId[AGENT].modelUnavailable).not.toBeNull();
      s = chatStateReducer(s, chatQueueProcessingReceived(AGENT, 'qm-1'));
      expect(s.byAgentId[AGENT].modelUnavailable).toBeNull();
    });

    it('the text-sync path does NOT clear the error (no drain happened)', () => {
      let s = chatStateReducer(initialState, chatSendFailed(AGENT, 'boom'));
      s = chatStateReducer(s, chatQueuedRetryRecordSet(AGENT, 'qm-1', { text: 'before' }, 'qm-1'));
      s = chatStateReducer(s, replaceAgentQueue(AGENT, [{ ...queuedEntry('qm-1'), content: 'after' }]));
      expect(s.byAgentId[AGENT].error).toBe('boom');
      expect(s.byAgentId[AGENT].queuedRetryRecords['qm-1'].record.text).toBe('after');
    });

    it('replaceAgentQueue with no parked records is a no-op (state identity preserved)', () => {
      const s1 = chatStateReducer(initialState, chatSendStarted(AGENT));
      const s2 = chatStateReducer(s1, replaceAgentQueue(AGENT, [queuedEntry('qm-1')]));
      expect(s2).toBe(s1);
    });

    it('replaceAgentQueue never materializes a chat-state entry for an unopened chat', () => {
      const s = chatStateReducer(initialState, replaceAgentQueue(AGENT, []));
      expect(s.byAgentId[AGENT]).toBeUndefined();
    });

    it('removeQueuedMessageFromAgentQueue drops the record WITHOUT promotion (user delete)', () => {
      let s = chatStateReducer(initialState, chatLastAttemptedMessageSet(AGENT, { text: 'A' }));
      s = chatStateReducer(s, chatQueuedRetryRecordSet(AGENT, 'qm-1', { text: 'B' }, 'qm-1'));
      s = chatStateReducer(s, removeQueuedMessageFromAgentQueue(AGENT, 'qm-1'));
      expect(s.byAgentId[AGENT].lastAttemptedMessage).toEqual({ text: 'A' });
      expect(s.byAgentId[AGENT].queuedRetryRecords).toEqual({});
      // The follow-up snapshot without qm-1 must not resurrect/promote it.
      s = chatStateReducer(s, replaceAgentQueue(AGENT, []));
      expect(s.byAgentId[AGENT].lastAttemptedMessage).toEqual({ text: 'A' });
    });

    it('chatQueuedRetryRecordParked parks the record and clears a matching lastAttemptedMessage (#1011)', () => {
      const attempt = { text: 'B', options: { noteIds: ['n-1'] } };
      // Simulate the direct-send path: the caller overwrote the slot with the
      // attempt payload, then the daemon auto-queued the send.
      let s = chatStateReducer(initialState, chatLastAttemptedMessageSet(AGENT, attempt));
      s = chatStateReducer(s, chatQueuedRetryRecordParked(AGENT, 'qm-1', { ...attempt, options: { noteIds: ['n-1'] } }, 'qm-1'));
      expect(s.byAgentId[AGENT].lastAttemptedMessage).toBeNull();
      expect(s.byAgentId[AGENT].queuedRetryRecords).toEqual({
        'qm-1': { seq: 1, record: attempt, turnId: 'qm-1' },
      });
    });

    it('chatQueuedRetryRecordParked preserves a DIFFERENT lastAttemptedMessage (concurrent attempt)', () => {
      let s = chatStateReducer(initialState, chatLastAttemptedMessageSet(AGENT, { text: 'other turn' }));
      s = chatStateReducer(s, chatQueuedRetryRecordParked(AGENT, 'qm-1', { text: 'auto-queued' }, 'qm-1'));
      expect(s.byAgentId[AGENT].lastAttemptedMessage).toEqual({ text: 'other turn' });
      expect(s.byAgentId[AGENT].queuedRetryRecords).toEqual({
        'qm-1': { seq: 1, record: { text: 'auto-queued' }, turnId: 'qm-1' },
      });
    });

    it('a record parked via chatQueuedRetryRecordParked promotes on drain start like a queue-on-send park', () => {
      let s = chatStateReducer(initialState, chatQueuedRetryRecordParked(AGENT, 'qm-1', { text: 'B' }, 'qm-1'));
      s = chatStateReducer(s, chatQueueProcessingReceived(AGENT, 'qm-1'));
      expect(s.byAgentId[AGENT].lastAttemptedMessage).toEqual({ text: 'B' });
      expect(s.byAgentId[AGENT].queuedRetryRecords).toEqual({});
    });

    it('chatQueuedRetryRecordUpdated rewrites the parked text, preserving seq, turnId, and options (#1011)', () => {
      let s = chatStateReducer(
        initialState,
        chatQueuedRetryRecordSet(AGENT, 'qm-1', { text: 'before', options: { noteIds: ['n-1'] } }, 'qm-1'),
      );
      s = chatStateReducer(s, chatQueuedRetryRecordSet(AGENT, 'qm-2', { text: 'C' }, 'qm-2'));
      s = chatStateReducer(s, chatQueuedRetryRecordUpdated(AGENT, 'qm-1', 'after'));
      expect(s.byAgentId[AGENT].queuedRetryRecords).toEqual({
        'qm-1': { seq: 1, record: { text: 'after', options: { noteIds: ['n-1'] } }, turnId: 'qm-1' },
        'qm-2': { seq: 2, record: { text: 'C' }, turnId: 'qm-2' },
      });
      // Post-drain-start "Try again" now resends the edited text.
      s = chatStateReducer(s, chatQueueProcessingReceived(AGENT, 'qm-1'));
      expect(s.byAgentId[AGENT].lastAttemptedMessage).toEqual({
        text: 'after',
        options: { noteIds: ['n-1'] },
      });
    });

    it('a snapshot syncs a present entry\u2019s edited content into its parked record (#1011 save-while-idle race)', () => {
      // STAB-27 save with the agent idle: the daemon awaits the self-drain
      // BEFORE returning the edit RPC response, so the post-edit snapshot and
      // the drain-start event both arrive before ChatPanel can dispatch
      // chatQueuedRetryRecordUpdated. The content sync must therefore pick up
      // the daemon-authoritative content for still-present ids.
      let s = chatStateReducer(initialState, chatQueuedRetryRecordSet(AGENT, 'qm-1', { text: 'before', options: { noteIds: ['n-1'] } }, 'qm-1'));
      // Post-edit snapshot: qm-1 still queued, content edited daemon-side.
      s = chatStateReducer(s, replaceAgentQueue(AGENT, [{ ...queuedEntry('qm-1'), content: 'after' }]));
      expect(s.byAgentId[AGENT].queuedRetryRecords).toEqual({
        'qm-1': { seq: 1, record: { text: 'after', options: { noteIds: ['n-1'] } }, turnId: 'qm-1' },
      });
      // Drain start: the promotion carries the edited text.
      s = chatStateReducer(s, chatQueueProcessingReceived(AGENT, 'qm-1'));
      expect(s.byAgentId[AGENT].lastAttemptedMessage).toEqual({
        text: 'after',
        options: { noteIds: ['n-1'] },
      });
    });

    it('a snapshot with unchanged content leaves parked records untouched (state identity preserved)', () => {
      const s = chatStateReducer(initialState, chatQueuedRetryRecordSet(AGENT, 'qm-1', { text: 'content of qm-1' }, 'qm-1'));
      const s2 = chatStateReducer(s, replaceAgentQueue(AGENT, [queuedEntry('qm-1')]));
      expect(s2).toBe(s);
    });

    it('chatQueuedRetryRecordUpdated is a no-op when nothing is parked under the id', () => {
      const s1 = chatStateReducer(initialState, chatQueuedRetryRecordSet(AGENT, 'qm-1', { text: 'B' }, 'qm-1'));
      const s2 = chatStateReducer(s1, chatQueuedRetryRecordUpdated(AGENT, 'qm-other', 'edited'));
      expect(s2).toBe(s1);
      // Nor does it materialize state for an unopened chat.
      const s3 = chatStateReducer(initialState, chatQueuedRetryRecordUpdated(AGENT, 'qm-1', 'edited'));
      expect(s3.byAgentId[AGENT]).toBeUndefined();
    });

    it('chatQueuedRetryRecordsCleared drops ALL parked records without promotion (#999 discard)', () => {
      let s = chatStateReducer(initialState, chatLastAttemptedMessageSet(AGENT, { text: 'edited' }));
      s = chatStateReducer(s, chatQueuedRetryRecordSet(AGENT, 'qm-1', { text: 'discarded' }, 'qm-1'));
      s = chatStateReducer(s, chatQueuedRetryRecordsCleared(AGENT));
      expect(s.byAgentId[AGENT].queuedRetryRecords).toEqual({});
      expect(s.byAgentId[AGENT].lastAttemptedMessage).toEqual({ text: 'edited' });
      // The daemon's late empty clear_queue snapshot finds nothing to promote.
      s = chatStateReducer(s, replaceAgentQueue(AGENT, []));
      expect(s.byAgentId[AGENT].lastAttemptedMessage).toEqual({ text: 'edited' });
    });

    it('chatQueuedRetryRecordsCleared with no parked records is a state-identity no-op', () => {
      const s1 = chatStateReducer(initialState, chatSendStarted(AGENT));
      const s2 = chatStateReducer(s1, chatQueuedRetryRecordsCleared(AGENT));
      expect(s2).toBe(s1);
      // Nor does it materialize state for an unopened chat.
      const s3 = chatStateReducer(initialState, chatQueuedRetryRecordsCleared('agent-unopened'));
      expect(s3.byAgentId['agent-unopened']).toBeUndefined();
    });

    it('parking beyond the cap evicts the oldest-seq records first (#973-family memory bound)', () => {
      // Records whose entries never promote cleanly (missed events, agent
      // deletion) must not accumulate unboundedly — each can carry MB-scale
      // base64 imageBlocks. The park reducer caps the map at 20, evicting
      // the oldest (lowest-seq) parked records first.
      let s = chatStateReducer(initialState, chatSendStarted(AGENT));
      for (let i = 1; i <= 25; i += 1) {
        s = chatStateReducer(s, chatQueuedRetryRecordSet(AGENT, `qm-${i}`, { text: `message ${i}` }, `qm-${i}`));
      }
      const records = s.byAgentId[AGENT].queuedRetryRecords;
      expect(Object.keys(records)).toHaveLength(20);
      expect(records['qm-5']).toBeUndefined();
      expect(records['qm-6']).toEqual({ seq: 6, record: { text: 'message 6' }, turnId: 'qm-6' });
      expect(records['qm-25']).toEqual({ seq: 25, record: { text: 'message 25' }, turnId: 'qm-25' });
    });

    it('agent:idle success-clear does not disturb parked records', () => {
      let s = chatStateReducer(initialState, chatLastAttemptedMessageSet(AGENT, { text: 'A' }));
      s = chatStateReducer(s, chatQueuedRetryRecordSet(AGENT, 'qm-1', { text: 'B' }, 'qm-1'));
      const idleEvent: AgentIdleEvent = {
        id: 'evt-idle-1',
        type: 'agent:idle',
        timestamp: '2026-01-01T00:00:00.000Z',
        workspaceId: 'ws-1',
        actor: { type: 'agent', id: AGENT },
        data: {
          agentId: AGENT,
          agentName: 'Test Agent',
          reason: 'stream_complete',
          finishReason: 'end_turn',
          status: 'idle',
          activationState: null,
          isActive: false,
          isStreaming: false,
          isProcessing: false,
          isResponding: false,
          stopReason: null,
        },
      };
      s = chatStateReducer(s, eventReceived('ws-1', idleEvent));
      expect(s.byAgentId[AGENT].lastAttemptedMessage).toBeNull();
      expect(s.byAgentId[AGENT].queuedRetryRecords).toEqual({
        'qm-1': { seq: 1, record: { text: 'B' }, turnId: 'qm-1' },
      });
    });
  });

  describe('turnId-keyed retry records (monorepo#1057)', () => {
    const queuedEntry = (id: string, turnId?: string, position = 0): QueuedMessage => ({
      id,
      content: `content of ${id}`,
      queuedAt: '2026-01-01T00:00:00.000Z',
      position,
      ...(turnId !== undefined ? { turnId } : {}),
    });

    it('chatQueuedRetryRecordSet stores the turnId on the parked record', () => {
      const s = chatStateReducer(
        initialState,
        chatQueuedRetryRecordSet(AGENT, 'qm-1', { text: 'B' }, 'turn-1'),
      );
      expect(s.byAgentId[AGENT].queuedRetryRecords).toEqual({
        'qm-1': { seq: 1, record: { text: 'B' }, turnId: 'turn-1' },
      });
    });

    it('chatQueuedRetryRecordParked stores the turnId and clears the matching slot (#1011)', () => {
      let s = chatStateReducer(initialState, chatLastAttemptedMessageSet(AGENT, { text: 'B' }));
      s = chatStateReducer(s, chatQueuedRetryRecordParked(AGENT, 'qm-1', { text: 'B' }, 'turn-1'));
      expect(s.byAgentId[AGENT].queuedRetryRecords).toEqual({
        'qm-1': { seq: 1, record: { text: 'B' }, turnId: 'turn-1' },
      });
      expect(s.byAgentId[AGENT].lastAttemptedMessage).toBeNull();
    });

    it('chatQueueProcessingReceived promotes the exact record by turnId', () => {
      let s = chatStateReducer(initialState, chatSendFailed(AGENT, 'boom'));
      s = chatStateReducer(s, chatQueuedRetryRecordSet(AGENT, 'qm-1', { text: 'B' }, 'turn-1'));
      s = chatStateReducer(s, chatQueuedRetryRecordSet(AGENT, 'qm-2', { text: 'C' }, 'turn-2'));
      s = chatStateReducer(s, chatQueueProcessingReceived(AGENT, 'turn-1'));
      expect(s.byAgentId[AGENT].lastAttemptedMessage).toEqual({ text: 'B' });
      expect(s.byAgentId[AGENT].queuedRetryRecords).toEqual({
        'qm-2': { seq: 2, record: { text: 'C' }, turnId: 'turn-2' },
      });
      // Drain-start means the promoted turn is now active — clean slate.
      expect(s.byAgentId[AGENT].error).toBeNull();
    });

    it('redrive: agent:queue:processing with the original turnId promotes the exact record', () => {
      // agent.retry redrive (§5.5): the terminal-failure requeue minted a new
      // entry id (qm-requeued) but preserved the failed turn's turnId. The
      // record parked under the ORIGINAL entry id must still promote.
      let s = chatStateReducer(
        initialState,
        chatQueuedRetryRecordSet(AGENT, 'qm-orig', { text: 'failed turn' }, 'turn-1'),
      );
      s = chatStateReducer(s, chatQueueProcessingReceived(AGENT, 'turn-1'));
      expect(s.byAgentId[AGENT].lastAttemptedMessage).toEqual({ text: 'failed turn' });
      expect(s.byAgentId[AGENT].queuedRetryRecords).toEqual({});
    });

    it('regression: a recordless redrive must NOT promote another pending record', () => {
      // The #999 misattribution this design fixes: agent.retry redrives a
      // requeued entry this client never parked (or whose record is gone),
      // while ANOTHER pending record is parked. The processing event names a
      // turnId matching no record — nothing may promote, especially not the
      // unrelated parked record.
      let s = chatStateReducer(
        initialState,
        chatQueuedRetryRecordSet(AGENT, 'qm-other', { text: 'unrelated pending' }, 'turn-other'),
      );
      s = chatStateReducer(s, chatQueueProcessingReceived(AGENT, 'turn-redriven'));
      expect(s.byAgentId[AGENT].lastAttemptedMessage).toBeNull();
      expect(s.byAgentId[AGENT].queuedRetryRecords).toEqual({
        'qm-other': { seq: 1, record: { text: 'unrelated pending' }, turnId: 'turn-other' },
      });
    });

    it('chatQueueProcessingReceived without a turnId is a no-op (legacy pre-#1022 entry)', () => {
      const s1 = chatStateReducer(
        initialState,
        chatQueuedRetryRecordSet(AGENT, 'qm-1', { text: 'B' }, 'turn-1'),
      );
      const s2 = chatStateReducer(s1, chatQueueProcessingReceived(AGENT, undefined));
      expect(s2).toBe(s1);
    });

    it('chatQueueProcessingReceived is a no-op when nothing matches (no approximation)', () => {
      const s1 = chatStateReducer(initialState, chatSendStarted(AGENT));
      const s2 = chatStateReducer(s1, chatQueueProcessingReceived(AGENT, 'turn-x'));
      expect(s2).toBe(s1);
      // Never materializes state for an unopened chat either.
      const s3 = chatStateReducer(initialState, chatQueueProcessingReceived('agent-unopened', 'turn-x'));
      expect(s3.byAgentId['agent-unopened']).toBeUndefined();
    });

    it('a queue snapshot does NOT promote a vanished record (processing owns the promotion)', () => {
      // The record's entry id left the snapshot — under the removed inference
      // it would promote. The exact agent:queue:processing signal owns the
      // promotion; the vanished record stays parked (its entry may have been
      // requeued under a new id after a terminal failure).
      let s = chatStateReducer(
        initialState,
        chatQueuedRetryRecordSet(AGENT, 'qm-1', { text: 'B' }, 'turn-1'),
      );
      s = chatStateReducer(s, replaceAgentQueue(AGENT, []));
      expect(s.byAgentId[AGENT].lastAttemptedMessage).toBeNull();
      expect(s.byAgentId[AGENT].queuedRetryRecords).toEqual({
        'qm-1': { seq: 1, record: { text: 'B' }, turnId: 'turn-1' },
      });
      // The follow-up processing event performs the exact promotion.
      s = chatStateReducer(s, chatQueueProcessingReceived(AGENT, 'turn-1'));
      expect(s.byAgentId[AGENT].lastAttemptedMessage).toEqual({ text: 'B' });
      expect(s.byAgentId[AGENT].queuedRetryRecords).toEqual({});
    });

    it('a queue snapshot does not double-promote after a queue:processing promotion', () => {
      // Event order on a real drain: shrunk agent:queue:updated, then
      // agent:queue:processing. If processing already promoted (record left
      // the map), a late/duplicate snapshot must find nothing to promote.
      let s = chatStateReducer(
        initialState,
        chatQueuedRetryRecordSet(AGENT, 'qm-1', { text: 'B' }, 'turn-1'),
      );
      s = chatStateReducer(s, chatQueueProcessingReceived(AGENT, 'turn-1'));
      s = chatStateReducer(s, chatLastAttemptedMessageSet(AGENT, { text: 'newer attempt' }));
      const s2 = chatStateReducer(s, replaceAgentQueue(AGENT, []));
      expect(s2.byAgentId[AGENT].lastAttemptedMessage).toEqual({ text: 'newer attempt' });
    });

    it('a duplicate processing event cannot double-promote (record already left the map)', () => {
      let s = chatStateReducer(
        initialState,
        chatQueuedRetryRecordSet(AGENT, 'qm-1', { text: 'B' }, 'turn-1'),
      );
      s = chatStateReducer(s, chatQueueProcessingReceived(AGENT, 'turn-1'));
      s = chatStateReducer(s, chatLastAttemptedMessageSet(AGENT, { text: 'newer attempt' }));
      const s2 = chatStateReducer(s, chatQueueProcessingReceived(AGENT, 'turn-1'));
      expect(s2.byAgentId[AGENT].lastAttemptedMessage).toEqual({ text: 'newer attempt' });
    });

    it('a requeued entry (new id, same turnId) still counts as present: content sync, no promotion', () => {
      // Terminal-failure requeue: the snapshot shows the entry under a NEW id
      // with the same turnId. The record is neither promoted nor dropped, and
      // the daemon-authoritative content sync still applies.
      let s = chatStateReducer(
        initialState,
        chatQueuedRetryRecordSet(AGENT, 'qm-orig', { text: 'original' }, 'turn-1'),
      );
      s = chatStateReducer(s, replaceAgentQueue(AGENT, [
        { ...queuedEntry('qm-requeued', 'turn-1'), content: 'original' },
      ]));
      expect(s.byAgentId[AGENT].lastAttemptedMessage).toBeNull();
      expect(s.byAgentId[AGENT].queuedRetryRecords).toEqual({
        'qm-orig': { seq: 1, record: { text: 'original' }, turnId: 'turn-1' },
      });
    });

    it('a requeued entry\u2019s edited content syncs into the record via the turnId match', () => {
      let s = chatStateReducer(
        initialState,
        chatQueuedRetryRecordSet(AGENT, 'qm-orig', { text: 'original' }, 'turn-1'),
      );
      s = chatStateReducer(s, replaceAgentQueue(AGENT, [
        { ...queuedEntry('qm-requeued', 'turn-1'), content: 'edited elsewhere' },
      ]));
      expect(s.byAgentId[AGENT].queuedRetryRecords).toEqual({
        'qm-orig': { seq: 1, record: { text: 'edited elsewhere' }, turnId: 'turn-1' },
      });
    });

    it('chatSendFailed pairs the failure with the exact parked record via turnId', () => {
      // agent.retry redrive fails again: agent:failed carries the original
      // turnId, whose record is still parked (its requeued entry id never
      // matched a snapshot key). The banner must pair with that record.
      let s = chatStateReducer(
        initialState,
        chatQueuedRetryRecordSet(AGENT, 'qm-1', { text: 'failed payload' }, 'turn-1'),
      );
      s = chatStateReducer(s, chatSendFailed(AGENT, 'still failing', 'turn-1'));
      expect(s.byAgentId[AGENT].error).toBe('still failing');
      expect(s.byAgentId[AGENT].lastAttemptedMessage).toEqual({ text: 'failed payload' });
      expect(s.byAgentId[AGENT].queuedRetryRecords).toEqual({});
    });

    it('chatSendFailed with an unknown or absent turnId leaves records and the slot untouched', () => {
      let s = chatStateReducer(initialState, chatLastAttemptedMessageSet(AGENT, { text: 'active' }));
      s = chatStateReducer(s, chatQueuedRetryRecordSet(AGENT, 'qm-1', { text: 'B' }, 'turn-1'));
      const withUnknown = chatStateReducer(s, chatSendFailed(AGENT, 'boom', 'turn-unknown'));
      expect(withUnknown.byAgentId[AGENT].error).toBe('boom');
      expect(withUnknown.byAgentId[AGENT].lastAttemptedMessage).toEqual({ text: 'active' });
      expect(withUnknown.byAgentId[AGENT].queuedRetryRecords).toEqual({
        'qm-1': { seq: 1, record: { text: 'B' }, turnId: 'turn-1' },
      });
      const withoutTurnId = chatStateReducer(s, chatSendFailed(AGENT, 'boom'));
      expect(withoutTurnId.byAgentId[AGENT].lastAttemptedMessage).toEqual({ text: 'active' });
      expect(withoutTurnId.byAgentId[AGENT].queuedRetryRecords).toEqual({
        'qm-1': { seq: 1, record: { text: 'B' }, turnId: 'turn-1' },
      });
    });

  });

  it('streamEnded (no interrupt) preserves lastAttemptedMessage until the disposition is known (#984)', () => {
    // `agent:stream:end` is disposition-NEUTRAL (PROTOCOL §7) — a failed turn
    // ends its stream the same way. Success is only confirmed by the
    // follow-up `agent:idle`, which performs the clear (#941 semantics ride
    // the idle finalize, see the #973 describe below).
    let s = chatStateReducer(initialState, chatLastAttemptedMessageSet(AGENT, { text: 'sent' }));
    s = chatStateReducer(s, streamEnded(AGENT));
    expect(s.byAgentId[AGENT].lastAttemptedMessage).toEqual({ text: 'sent' });
  });

  it('mid-turn provider failure: streamEnded then chatSendFailed(agent:failed) keeps the retry payload (#984)', () => {
    // Daemon emission order on a live mid-turn provider failure
    // (agent_session.rs run_prompt_turn): ONE disposition-neutral
    // `agent:stream:end` (streamEnded, no error marker) THEN `agent:failed`,
    // mapped to chatSendFailed. The stream end must not wipe the record, or
    // the failure banner's "Try again" resolves as a no-op.
    const attempted = { text: 'failed mid-turn', options: { model: 'slow-model' } };
    let s = chatStateReducer(initialState, chatLastAttemptedMessageSet(AGENT, attempted));
    s = chatStateReducer(s, streamEnded(AGENT));
    s = chatStateReducer(s, chatSendFailed(AGENT, 'session/prompt failed: provider error'));
    const agent = s.byAgentId[AGENT];
    expect(agent.error).toBe('session/prompt failed: provider error');
    expect(agent.lastAttemptedMessage).toEqual(attempted);
  });

  it('streamEnded(stopReason interrupted) clears lastAttemptedMessage', () => {
    // A user stop's terminal stream:end carries stopReason "interrupted" and
    // no agent:idle or agent:failed follows (PROTOCOL §7.2) — clear here so
    // the abandoned payload does not stay resident (#965).
    let s = chatStateReducer(initialState, chatLastAttemptedMessageSet(AGENT, { text: 'stopped' }));
    s = chatStateReducer(s, streamEnded(AGENT, 'interrupted'));
    expect(s.byAgentId[AGENT].lastAttemptedMessage).toBeNull();
  });

  it('streamFailed preserves lastAttemptedMessage for retry (#941)', () => {
    const attempted = { text: 'edited text' };
    let s = chatStateReducer(initialState, chatLastAttemptedMessageSet(AGENT, attempted));
    s = chatStateReducer(s, streamFailed(AGENT));
    expect(s.byAgentId[AGENT].error).not.toBeNull();
    expect(s.byAgentId[AGENT].lastAttemptedMessage).toEqual(attempted);
  });

  it('streamChunkReceived(text) sets receivedFirstChunk and adds status event', () => {
    const s1 = chatStateReducer(initialState, chatSendStarted(AGENT));
    const action = streamChunkReceived(AGENT, true);
    const s2 = chatStateReducer(s1, action);
    const agent = s2.byAgentId[AGENT];
    expect(agent.receivedFirstChunk).toBe(true);
    expect(agent.lastChunkReceivedAt).toBe(action.payload[2]);
    expect(agent.statusEvents).toHaveLength(1);
    expect(agent.statusEvents[0]).toMatchObject({ phase: 'streaming' });
  });

  it('streamChunkReceived(non-text) records activity without first chunk', () => {
    const s1 = chatStateReducer(initialState, chatSendStarted(AGENT));
    const action = streamChunkReceived(AGENT, false);
    const s2 = chatStateReducer(s1, action);
    const agent = s2.byAgentId[AGENT];
    expect(agent.receivedFirstChunk).toBe(false);
    expect(agent.statusEvents).toHaveLength(0);
    expect(agent.lastChunkReceivedAt).toBe(action.payload[2]);
  });

  it('streamEnded clears streaming metadata and status events', () => {
    let state = chatStateReducer(initialState, chatSendStarted(AGENT));
    state = chatStateReducer(state, streamChunkReceived(AGENT, true));
    const completed = chatStateReducer(state, streamEnded(AGENT));
    const agent = completed.byAgentId[AGENT];
    expect(agent.streamingStartTime).toBeNull();
    expect(agent.receivedFirstChunk).toBe(false);
    expect(agent.statusEvents).toEqual([]);
  });

  it('streamFailed clears streaming metadata and stores a default error', () => {
    const s1 = chatStateReducer(initialState, chatSendStarted(AGENT));
    const s2 = chatStateReducer(s1, streamFailed(AGENT));
    const agent = s2.byAgentId[AGENT];
    expect(agent.streamingStartTime).toBeNull();
    expect(agent.statusEvents).toEqual([]);
    expect(agent.error).not.toBeNull();
  });

  it('streamFailed clears stale model-unavailable state', () => {
    const state = chatStateReducer(stateWithModelUnavailable(), streamFailed(AGENT));
    const agent = state.byAgentId[AGENT];
    expect(agent.error).not.toBeNull();
    expect(agent.modelUnavailable).toBeNull();
  });

  it('chatModelUnavailableCleared clears info', () => {
    let s = stateWithModelUnavailable();
    expect(s.byAgentId[AGENT].modelUnavailable).not.toBeNull();
    s = chatStateReducer(s, chatModelUnavailableCleared(AGENT));
    expect(s.byAgentId[AGENT].modelUnavailable).toBeNull();
  });

  it('chatStreamingReconciled sets streamingStartTime when not already set', () => {
    const s = chatStateReducer(initialState, chatStreamingReconciled(AGENT));
    const agent = s.byAgentId[AGENT];
    expect(agent.streamingStartTime).toBeDefined();
  });

  it('streamStatusReceived appends status event', () => {
    const s1 = chatStateReducer(initialState, chatSendStarted(AGENT));
    const event = { phase: 'connecting', message: 'test', level: 'info' as const, timestamp: 1000 };
    const s2 = chatStateReducer(s1, streamStatusReceived(AGENT, event, false));
    expect(s2.byAgentId[AGENT].statusEvents).toHaveLength(1);
    expect(s2.byAgentId[AGENT].statusEvents[0]).toEqual(event);
  });

  it('streamStatusReceived stores a clone-safe status event from non-cloneable payloads', () => {
    const s1 = chatStateReducer(initialState, chatSendStarted(AGENT));
    const payload: Record<string, unknown> = {
      phase: 'tool-call',
      message: new Error('tool failed'),
      level: 'error',
      timestamp: 3000,
      callback: () => undefined,
      token: Symbol('token'),
    };
    payload.self = payload;

    const s2 = chatStateReducer(s1, streamStatusReceived(AGENT, payload, false));
    const [storedEvent] = s2.byAgentId[AGENT].statusEvents;

    expect(storedEvent).toEqual({
      phase: 'tool-call',
      message: 'tool failed',
      level: 'error',
      timestamp: 3000,
    });
    expect(JSON.parse(JSON.stringify(storedEvent))).toEqual(storedEvent);
    expect(() => structuredClone(storedEvent)).not.toThrow();
  });

  it('streamStatusReceived resets receivedFirstChunk when resetFirstChunk is true', () => {
    let s = chatStateReducer(initialState, chatSendStarted(AGENT));
    s = chatStateReducer(s, streamChunkReceived(AGENT, true));
    expect(s.byAgentId[AGENT].receivedFirstChunk).toBe(true);
    const event = { phase: 'tool_use', message: 'running', level: 'info' as const, timestamp: 2000 };
    s = chatStateReducer(s, streamStatusReceived(AGENT, event, true));
    expect(s.byAgentId[AGENT].receivedFirstChunk).toBe(false);
  });

  it('chatRebindStarted sets isRebinding', () => {
    const s = chatStateReducer(initialState, chatRebindStarted(AGENT));
    expect(s.byAgentId[AGENT].isRebinding).toBe(true);
  });

  it('chatRebindEnded clears isRebinding', () => {
    let s = chatStateReducer(initialState, chatRebindStarted(AGENT));
    s = chatStateReducer(s, chatRebindEnded(AGENT));
    expect(s.byAgentId[AGENT].isRebinding).toBe(false);
  });

  it('chatTrackedWorkspaceSet updates trackedWorkspaceId', () => {
    const s = chatStateReducer(initialState, chatTrackedWorkspaceSet(AGENT, 'ws-1'));
    expect(s.byAgentId[AGENT].trackedWorkspaceId).toBe('ws-1');
  });

  it('chatTrackedWorkspaceSet clears trackedWorkspaceId with null', () => {
    let s = chatStateReducer(initialState, chatTrackedWorkspaceSet(AGENT, 'ws-1'));
    s = chatStateReducer(s, chatTrackedWorkspaceSet(AGENT, null));
    expect(s.byAgentId[AGENT].trackedWorkspaceId).toBeNull();
  });

  it('does not store one-shot UI cleanup request state', () => {
    const rejectedField = ['ui', 'Cleanup', 'Request'].join('');
    expect(emptyChatAgentState).not.toHaveProperty(rejectedField);

    const state = chatStateReducer(initialState, chatSendStarted(AGENT));
    expect(state.byAgentId[AGENT]).not.toHaveProperty(rejectedField);
  });

  describe('workspaceDeleted', () => {
    it('purges byAgentId entries for every agentId in the payload', () => {
      let state = chatStateReducer(initialState, chatSendStarted('agent-a'));
      state = chatStateReducer(state, chatSendStarted('agent-b'));
      state = chatStateReducer(state, chatSendStarted('agent-c'));

      state = chatStateReducer(state, workspaceDeleted('ws-1', ['agent-a', 'agent-b']));

      expect(state.byAgentId['agent-a']).toBeUndefined();
      expect(state.byAgentId['agent-b']).toBeUndefined();
      expect(state.byAgentId['agent-c']).toBeDefined();
    });

    it('is a no-op when the payload is empty', () => {
      const state = chatStateReducer(initialState, chatSendStarted(AGENT));
      const next = chatStateReducer(state, workspaceDeleted('ws-1', []));
      expect(next).toBe(state);
    });

    it('is a no-op when no chat-state entry exists for the doomed agents', () => {
      const state = chatStateReducer(initialState, chatSendStarted(AGENT));
      const next = chatStateReducer(state, workspaceDeleted('ws-1', ['unknown']));
      expect(next).toBe(state);
    });
  });

  describe('idle-reconcile finalize clears lastAttemptedMessage (#973)', () => {
    // PROTOCOL.md-shaped agent:idle event fixture (canonical status fields
    // are required on lifecycle payloads; explicit null when not known).
    function agentIdleEvent(agentId: string, timestamp = '2026-01-01T00:00:00.000Z') {
      const event: AgentIdleEvent = {
        id: 'evt-idle-1',
        type: 'agent:idle',
        timestamp,
        workspaceId: 'ws-1',
        actor: { type: 'agent', id: agentId },
        data: {
          agentId,
          agentName: 'Test Agent',
          reason: 'stream_complete',
          finishReason: 'end_turn',
          status: 'idle',
          activationState: null,
          isActive: false,
          isStreaming: false,
          isProcessing: false,
          isResponding: false,
          stopReason: null,
        },
      };
      return eventReceived('ws-1', event);
    }

    it('successful live turn: streamEnded preserves, the follow-up agent:idle clears (#941/#984)', () => {
      // The live success flow — the disposition-neutral terminal streamEnded
      // defers the clear to `agent:idle`, which always follows a successful
      // turn on the same firehose (ready-to-send suppression aside, in which
      // case the drained final turn's idle clears). The send predates the
      // idle (coherent timeline — the idle belongs to this turn).
      let s = chatStateReducer(
        initialState,
        chatSendStarted(AGENT, 'ws-1', Date.parse('2025-12-31T23:59:00.000Z')),
      );
      s = chatStateReducer(s, chatLastAttemptedMessageSet(AGENT, { text: 'sent ok' }));
      s = chatStateReducer(s, streamEnded(AGENT));
      expect(s.byAgentId[AGENT].lastAttemptedMessage).toEqual({ text: 'sent ok' });
      s = chatStateReducer(s, agentIdleEvent(AGENT));
      expect(s.byAgentId[AGENT].lastAttemptedMessage).toBeNull();
    });

    it('agent:idle reconcile after a missed terminal complete clears the record', () => {
      // Turn started, record set, terminal `complete` never observed (window
      // reload mid-turn / dropped subscription) — the agent:idle reconcile is
      // the finalize and must not leave the MB-scale payload resident.
      let s = chatStateReducer(
        initialState,
        chatSendStarted(AGENT, 'ws-1', Date.parse('2025-12-31T23:59:00.000Z')),
      );
      s = chatStateReducer(s, chatLastAttemptedMessageSet(AGENT, { text: 'sent mid-reload' }));
      s = chatStateReducer(s, agentIdleEvent(AGENT));
      expect(s.byAgentId[AGENT].lastAttemptedMessage).toBeNull();
    });

    it('a STALE agent:idle (emitted before the newest send) does not clear the newer record', () => {
      // Turn N's `agent:idle` can arrive over the event channel AFTER send
      // N+1 already dispatched chatSendStarted + re-set lastAttemptedMessage
      // (transit delay). The idle's daemon-stamped timestamp predates the
      // newer send's lastMessageTime, so the finalize must be skipped — if
      // N+1 then fails, its "Try again" still needs the record.
      let s = chatStateReducer(
        initialState,
        chatSendStarted(AGENT, 'ws-1', Date.parse('2026-01-01T00:00:10.000Z')),
      );
      s = chatStateReducer(s, chatLastAttemptedMessageSet(AGENT, { text: 'send N+1' }));
      // Turn N's idle, emitted 5s BEFORE send N+1 started.
      s = chatStateReducer(s, agentIdleEvent(AGENT, '2026-01-01T00:00:05.000Z'));
      expect(s.byAgentId[AGENT].lastAttemptedMessage).toEqual({ text: 'send N+1' });
    });

    it('a stale agent:idle skip is a state-identity no-op', () => {
      let s = chatStateReducer(
        initialState,
        chatSendStarted(AGENT, 'ws-1', Date.parse('2026-01-01T00:00:10.000Z')),
      );
      s = chatStateReducer(s, chatLastAttemptedMessageSet(AGENT, { text: 'send N+1' }));
      const next = chatStateReducer(s, agentIdleEvent(AGENT, '2026-01-01T00:00:05.000Z'));
      expect(next).toBe(s);
    });

    it('an idle stamped AFTER the last send still clears (legitimate drain finalize)', () => {
      let s = chatStateReducer(
        initialState,
        chatSendStarted(AGENT, 'ws-1', Date.parse('2026-01-01T00:00:05.000Z')),
      );
      s = chatStateReducer(s, chatLastAttemptedMessageSet(AGENT, { text: 'sent' }));
      s = chatStateReducer(s, agentIdleEvent(AGENT, '2026-01-01T00:00:10.000Z'));
      expect(s.byAgentId[AGENT].lastAttemptedMessage).toBeNull();
    });

    it('an idle with an unparseable timestamp falls back to clearing (reconcile safety)', () => {
      // A malformed timestamp must not strand an MB-scale payload — the
      // pre-guard #973 semantics apply.
      let s = chatStateReducer(
        initialState,
        chatSendStarted(AGENT, 'ws-1', Date.parse('2026-01-01T00:00:10.000Z')),
      );
      s = chatStateReducer(s, chatLastAttemptedMessageSet(AGENT, { text: 'sent' }));
      s = chatStateReducer(s, agentIdleEvent(AGENT, 'not-a-timestamp'));
      expect(s.byAgentId[AGENT].lastAttemptedMessage).toBeNull();
    });

    it('reload reconcile (lastMessageTime 0) still clears on any idle (#973)', () => {
      // Fresh state after a window reload has lastMessageTime 0 — every idle
      // timestamp postdates it, so the reconcile finalize is preserved.
      let s = chatStateReducer(
        initialState,
        chatInitialized(AGENT, { isStreaming: false, lastAttemptedMessage: { text: 'pre-reload' } }),
      );
      s = chatStateReducer(s, agentIdleEvent(AGENT));
      expect(s.byAgentId[AGENT].lastAttemptedMessage).toBeNull();
    });

    it('agent:idle preserves the record while a failure banner is visible (error set)', () => {
      const attempted = { text: 'failed send' };
      let s = chatStateReducer(initialState, chatLastAttemptedMessageSet(AGENT, attempted));
      s = chatStateReducer(s, chatSendFailed(AGENT, 'network error'));
      s = chatStateReducer(s, agentIdleEvent(AGENT));
      expect(s.byAgentId[AGENT].error).toBe('network error');
      expect(s.byAgentId[AGENT].lastAttemptedMessage).toEqual(attempted);
    });

    it('agent:idle preserves the record while a retry-with-model banner is pending (#964)', () => {
      const attempted = { text: 'model-unavailable send' };
      let s = stateWithModelUnavailable();
      s = chatStateReducer(s, chatLastAttemptedMessageSet(AGENT, attempted));
      expect(s.byAgentId[AGENT].lastAttemptedMessage).toEqual(attempted);
      s = chatStateReducer(s, agentIdleEvent(AGENT));
      expect(s.byAgentId[AGENT].modelUnavailable).not.toBeNull();
      expect(s.byAgentId[AGENT].lastAttemptedMessage).toEqual(attempted);
    });

    it('agent:idle for an agent with no chat-state entry does not materialize one', () => {
      const state = chatStateReducer(initialState, chatSendStarted(AGENT));
      const next = chatStateReducer(state, agentIdleEvent('agent-never-opened'));
      expect(next).toBe(state);
      expect(next.byAgentId['agent-never-opened']).toBeUndefined();
    });

    it('agent:idle with no record is a state-identity no-op', () => {
      const state = chatStateReducer(initialState, chatSendStarted(AGENT));
      const next = chatStateReducer(state, agentIdleEvent(AGENT));
      expect(next).toBe(state);
    });

    it('non-idle eventReceived does not touch the record', () => {
      const attempted = { text: 'pending' };
      const state = chatStateReducer(initialState, chatLastAttemptedMessageSet(AGENT, attempted));
      const statusChangedEvent: AgentStatusChangedEvent = {
        id: 'evt-2',
        type: 'agent:status-changed',
        timestamp: '2026-01-01T00:00:00.000Z',
        workspaceId: 'ws-1',
        actor: { type: 'agent', id: AGENT },
        data: {
          agentId: AGENT,
          previousStatus: 'idle',
          status: 'responding',
          activationState: null,
          isActive: true,
          isStreaming: true,
          isProcessing: true,
          isResponding: true,
          stopReason: null,
        },
      };
      const next = chatStateReducer(state, eventReceived('ws-1', statusChangedEvent));
      expect(next).toBe(state);
    });
  });

});

describe('chatState selectors', () => {
  it('selectChatError returns null for clean state', () => {
    const storeState = asStoreState(initialState);
    expect(selectChatError.select(storeState, AGENT)).toBeNull();
  });

  it('selectChatError returns error message', () => {
    const state = chatStateReducer(initialState, chatInitFailed(AGENT, 'bad'));
    expect(selectChatError.select(asStoreState(state), AGENT)).toBe('bad');
  });

  it('selectChatAgentState returns empty state for unknown', () => {
    expect(selectChatAgentState.select(asStoreState(initialState), 'x')).toEqual(emptyChatAgentState);
  });

  it('selectChatLastMessageTime returns 0 by default', () => {
    expect(selectChatLastMessageTime.select(asStoreState(initialState), AGENT)).toBe(0);
  });

  // Transcript hydration tests
  it('selectTranscriptHydration returns loading after transcriptHydrationStarted', () => {
    const state = chatStateReducer(initialState, transcriptHydrationStarted(AGENT));
    expect(selectTranscriptHydration.select(asStoreState(state), AGENT)).toBe('loading');
  });

  it('transcriptHydrationStarted creates agent entry with correct agentId', () => {
    const state = chatStateReducer(initialState, transcriptHydrationStarted(AGENT));
    const agentState = selectChatAgentState.select(asStoreState(state), AGENT);
    expect(agentState.agentId).toBe(AGENT);
  });

  it('selectTranscriptHydration returns settled after transcriptHydrationSettled', () => {
    const loadingState = chatStateReducer(initialState, transcriptHydrationStarted(AGENT));
    const settledState = chatStateReducer(loadingState, transcriptHydrationSettled(AGENT));
    expect(selectTranscriptHydration.select(asStoreState(settledState), AGENT)).toBe('settled');
  });

  it('transcriptHydrationSettled works even if never started (error path)', () => {
    const state = chatStateReducer(initialState, transcriptHydrationSettled(AGENT));
    expect(selectTranscriptHydration.select(asStoreState(state), AGENT)).toBe('settled');
  });

  it('transcriptHydrationSettled creates agent entry with correct agentId', () => {
    const state = chatStateReducer(initialState, transcriptHydrationSettled(AGENT));
    const agentState = selectChatAgentState.select(asStoreState(state), AGENT);
    expect(agentState.agentId).toBe(AGENT);
  });

  it('selectTranscriptHydration returns undefined by default', () => {
    expect(selectTranscriptHydration.select(asStoreState(initialState), AGENT)).toBeUndefined();
  });

});

