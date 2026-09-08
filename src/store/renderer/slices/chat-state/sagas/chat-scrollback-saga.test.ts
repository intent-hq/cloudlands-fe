import { afterEach, describe, expect, it, vi } from 'vitest';
import { runSaga, stdChannel } from 'redux-saga';

const mocks = vi.hoisted(() => ({
  getConversation: vi.fn(),
}));
vi.mock('$lib/client', () => ({
  appClient: {
    agents: { getConversation: mocks.getConversation },
    chat: {},
  },
}));

import type { AgentMessage, AgentSession } from '$shared/types';
import { AgentStatus } from '$shared/types';
import { QUESTION_RESOURCE_MIME_TYPE } from '$shared/types/question-resource';
import type { Proposal } from '$shared/types/proposal';
import { createProposalResource } from '$shared/types/proposal-resource';
import type { StoreState } from '$store/renderer/types';
import { composeTranscript } from '$lib/components/chat/chat-scrollback-composition';
import {
  deriveMarkedQuestionRecoveryState,
  deriveWizardPendingQuestions,
} from '$lib/components/chat/questions/wizard-gate';
import { derivePendingProposalRecoveryState } from '$lib/components/chat/proposals/pending-proposal-recovery';
import {
  HISTORY_SEGMENT_MAX,
  agentSessionReducer,
  appendHistoryMessages,
  bulkUpsertSessions,
  clearAllSessions,
  initialState as agentSessionInitialState,
  prependHistoryMessages,
  removeSession,
  removeWorkspaceSessions,
  updateSession,
} from '../../agent-session/agent-session-slice';
import {
  chatStateReducer,
  chatTranscriptSnapshotApplied,
  historyGapFillRequested,
  historySeekRequested,
  initialState as chatStateInitialState,
  olderHistoryPageRequested,
  pendingProposalRecoveryPruned,
  pendingProposalRecoveryRequested,
  pendingQuestionRecoveryRequested,
} from '../chat-state-slice';
import { chatScrollbackSaga } from './chat-scrollback-saga';

const WS = 'ws-scrollback';
const AGENT = 'agent-scrollback';
const BASE_TIME = Date.parse('2026-01-01T00:00:00.000Z');
const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

function ts(index: number): string {
  return new Date(BASE_TIME + index * 1000).toISOString();
}

function session(overrides: Partial<AgentSession> = {}): AgentSession {
  return {
    id: AGENT,
    workspaceId: WS,
    backendSessionId: null,
    name: 'Agent',
    status: AgentStatus.Active,
    messages: [],
    createdAt: ts(0),
    updatedAt: ts(0),
    ...overrides,
  } as AgentSession;
}

function message(id: string, index: number): AgentMessage {
  return {
    id,
    role: 'assistant',
    timestamp: ts(index),
    contentBlocks: [{ type: 'text', text: id }],
  };
}

function questionMessage(id: string, index: number): AgentMessage {
  return {
    ...message(id, index),
    contentBlocks: [
      {
        type: 'resource',
        resource: {
          uri: 'intent-question://tar-abc123def456',
          name: 'Marked question',
          mimeType: QUESTION_RESOURCE_MIME_TYPE,
          text: JSON.stringify({
            attachmentId: 'tar-abc123def456',
            header: 'Marked question',
            question: 'Which option?',
            options: [
              { label: 'First', description: 'Use the first option' },
              { label: 'Second', description: 'Use the second option' },
            ],
            multiSelect: false,
          }),
        },
      },
    ],
  } as AgentMessage;
}

function proposal(applyToolCallId: string): Proposal {
  return {
    kind: 'workspace-create',
    applyToolCallId,
    payload: { params: { title: `Proposal ${applyToolCallId}` } },
    preview: { title: `Proposal ${applyToolCallId}` },
  } as Proposal;
}

function proposalMessage(id: string, index: number, proposals: Proposal[]): AgentMessage {
  return {
    ...message(id, index),
    contentBlocks: proposals.map((proposal) => ({
      type: 'resource',
      resource: createProposalResource(proposal),
    })),
  } as AgentMessage;
}

function page(
  messages: AgentMessage[],
  overrides: Partial<{
    truncated: boolean;
    totalMessages: number;
    nextToken: string | null;
    prevToken: string | null;
  }> = {},
) {
  return {
    messages,
    truncated: false,
    totalMessages: messages.length,
    nextToken: null,
    prevToken: null,
    ...overrides,
  };
}

function harness() {
  const channel = stdChannel();
  let agentSessions = agentSessionInitialState;
  let chatState = chatStateInitialState;
  const dispatch = vi.fn((action) => {
    agentSessions = agentSessionReducer(agentSessions, action);
    chatState = chatStateReducer(chatState, action);
    channel.put(action);
  });
  const task = runSaga(
    { channel, dispatch, getState: () => ({ agentSessions, chatState }) },
    chatScrollbackSaga,
  );
  return {
    channel,
    dispatch,
    task,
    history: () => agentSessions.historySegmentsByAgentId?.[AGENT],
    chat: () => chatState.byAgentId[AGENT],
    state: () => ({ agentSessions, chatState }) as StoreState,
  };
}

describe('chatScrollbackSaga (on-demand history paging)', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('seeks at the tail oldest on the first older request, then continues from the persisted token', async () => {
    const run = harness();
    run.dispatch(bulkUpsertSessions([session({ messages: [message('m-10', 10)] })]));

    mocks.getConversation.mockResolvedValueOnce(
      page([message('m-08', 8), message('m-09', 9), message('m-10', 10)], {
        nextToken: 'older-1',
      }),
    );
    run.channel.put(olderHistoryPageRequested(WS, AGENT));
    await settle();

    expect(run.history()?.messages.map((m) => m.id)).toEqual(['m-08', 'm-09']);
    expect(run.chat()?.scrollbackOlderToken).toBe('older-1');
    expect(run.chat()?.fetchingOlderHistory).toBe(false);
    expect(run.history()?.oldestReached).toBe(false);

    mocks.getConversation.mockResolvedValueOnce(
      page([message('m-06', 6), message('m-07', 7)], { nextToken: null }),
    );
    run.channel.put(olderHistoryPageRequested(WS, AGENT));
    await settle();

    expect(mocks.getConversation.mock.calls).toEqual([
      [AGENT, 200, undefined, 'm-10'],
      [AGENT, 200, 'older-1'],
    ]);
    expect(run.history()?.messages.map((m) => m.id)).toEqual(['m-06', 'm-07', 'm-08', 'm-09']);
    expect(run.history()?.oldestReached).toBe(true);
    expect(run.chat()?.scrollbackOlderToken).toBeNull();

    // Exhausted: further requests are no-ops.
    run.channel.put(olderHistoryPageRequested(WS, AGENT));
    await settle();
    expect(mocks.getConversation).toHaveBeenCalledTimes(2);

    run.task.cancel();
    await run.task.toPromise();
  });

  it('anchors at the history oldest (not the tail) once history rows exist', async () => {
    const run = harness();
    run.dispatch(bulkUpsertSessions([session({ messages: [message('m-10', 10)] })]));
    run.dispatch(prependHistoryMessages(AGENT, [message('m-05', 5)]));

    // No token persisted (e.g. fresh app session): re-seek at history's oldest.
    mocks.getConversation.mockResolvedValueOnce(page([message('m-04', 4), message('m-05', 5)]));
    run.channel.put(olderHistoryPageRequested(WS, AGENT));
    await settle();

    expect(mocks.getConversation).toHaveBeenCalledWith(AGENT, 200, undefined, 'm-05');
    expect(run.history()?.messages.map((m) => m.id)).toEqual(['m-04', 'm-05']);
    expect(run.history()?.oldestReached).toBe(true);
    run.task.cancel();
    await run.task.toPromise();
  });

  it('honors the persisted token when the previous page merged to an empty segment (all rows tail-resident)', async () => {
    const run = harness();
    run.dispatch(
      bulkUpsertSessions([session({ messages: [message('m-10', 10), message('m-11', 11)] })]),
    );

    // Anchored seek at the tail's oldest returns a page whose rows are ALL
    // already tail-resident (e.g. the row above the tail exceeds the slim
    // page budget): the prepend merges to an EMPTY segment, but the daemon
    // minted a backward cursor — the walk's only way to make progress.
    mocks.getConversation.mockResolvedValueOnce(
      page([message('m-10', 10), message('m-11', 11)], { nextToken: 'older-1' }),
    );
    run.channel.put(olderHistoryPageRequested(WS, AGENT));
    await settle();

    // The segment record exists with zero rows; the cursor survives the
    // settle (post-settle hygiene only drops it when the RECORD is gone).
    expect(run.history()?.messages).toEqual([]);
    expect(run.chat()?.scrollbackOlderToken).toBe('older-1');
    expect(run.history()?.oldestReached).toBe(false);

    // The NEXT older request continues from the token — no re-seek at the
    // same anchor (which would refetch the identical page forever).
    mocks.getConversation.mockResolvedValueOnce(
      page([message('m-08', 8)], { nextToken: 'older-2' }),
    );
    run.channel.put(olderHistoryPageRequested(WS, AGENT));
    await settle();
    expect(run.history()?.messages.map((m) => m.id)).toEqual(['m-08']);
    expect(run.chat()?.scrollbackOlderToken).toBe('older-2');

    // The token chain exhausts: oldestReached, no repeated identical requests.
    mocks.getConversation.mockResolvedValueOnce(page([message('m-07', 7)], { nextToken: null }));
    run.channel.put(olderHistoryPageRequested(WS, AGENT));
    await settle();

    expect(mocks.getConversation.mock.calls).toEqual([
      [AGENT, 200, undefined, 'm-10'],
      [AGENT, 200, 'older-1'],
      [AGENT, 200, 'older-2'],
    ]);
    expect(run.history()?.messages.map((m) => m.id)).toEqual(['m-07', 'm-08']);
    expect(run.history()?.oldestReached).toBe(true);
    expect(run.chat()?.scrollbackOlderToken).toBeNull();
    run.task.cancel();
    await run.task.toPromise();
  });

  it('still drops the cursor when the session (and segment record) is removed mid-flight', async () => {
    const run = harness();
    run.dispatch(bulkUpsertSessions([session({ messages: [message('m-10', 10)] })]));
    let resolvePage!: (value: ReturnType<typeof page>) => void;
    mocks.getConversation.mockReturnValueOnce(
      new Promise((done) => {
        resolvePage = done;
      }),
    );
    run.channel.put(olderHistoryPageRequested(WS, AGENT));
    await settle();
    expect(run.chat()?.fetchingOlderHistory).toBe(true);

    // Session removal clears the segment RECORD; the settle re-persists the
    // stale cursor, and post-settle hygiene must still drop it.
    run.dispatch(removeSession(AGENT));
    resolvePage(page([message('m-05', 5)], { nextToken: 'stale-older-1' }));
    await settle();

    expect(run.history()).toBeUndefined();
    expect(run.chat()?.scrollbackOlderToken).toBeNull();
    expect(run.chat()?.fetchingOlderHistory).toBe(false);
    run.task.cancel();
    await run.task.toPromise();
  });

  it('drops the cursor on removeWorkspaceSessions for the removed workspace only', async () => {
    const OTHER_WS = 'ws-other';
    const OTHER_AGENT = 'agent-other';
    const run = harness();
    run.dispatch(
      bulkUpsertSessions([
        session({ messages: [message('m-10', 10)] }),
        session({ id: OTHER_AGENT, workspaceId: OTHER_WS, messages: [message('n-10', 10)] }),
      ]),
    );

    // Persist a backward cursor for each agent.
    mocks.getConversation.mockResolvedValueOnce(
      page([message('m-09', 9), message('m-10', 10)], { nextToken: 'older-1' }),
    );
    run.channel.put(olderHistoryPageRequested(WS, AGENT));
    await settle();
    mocks.getConversation.mockResolvedValueOnce(
      page([message('n-09', 9), message('n-10', 10)], { nextToken: 'other-older-1' }),
    );
    run.channel.put(olderHistoryPageRequested(OTHER_WS, OTHER_AGENT));
    await settle();
    expect(run.chat()?.scrollbackOlderToken).toBe('older-1');
    expect(run.state().chatState.byAgentId[OTHER_AGENT]?.scrollbackOlderToken).toBe(
      'other-older-1',
    );

    // The bulk removal drops the segment RECORD; the cursor must go with it —
    // a re-hydrated agent would otherwise continue from a stale continuation.
    run.dispatch(removeWorkspaceSessions(WS));
    await settle();

    expect(run.history()).toBeUndefined();
    expect(run.chat()?.scrollbackOlderToken).toBeNull();
    // The other workspace's agent keeps its session, segment, and cursor.
    expect(run.state().chatState.byAgentId[OTHER_AGENT]?.scrollbackOlderToken).toBe(
      'other-older-1',
    );
    run.task.cancel();
    await run.task.toPromise();
  });

  it('drops every cursor on clearAllSessions', async () => {
    const run = harness();
    run.dispatch(bulkUpsertSessions([session({ messages: [message('m-10', 10)] })]));
    mocks.getConversation.mockResolvedValueOnce(
      page([message('m-09', 9), message('m-10', 10)], { nextToken: 'older-1' }),
    );
    run.channel.put(olderHistoryPageRequested(WS, AGENT));
    await settle();
    expect(run.chat()?.scrollbackOlderToken).toBe('older-1');

    run.dispatch(clearAllSessions());
    await settle();

    expect(run.history()).toBeUndefined();
    expect(run.chat()?.scrollbackOlderToken).toBeNull();
    run.task.cancel();
    await run.task.toPromise();
  });

  it('dedupes concurrent older requests per agent (takeLeading semantics)', async () => {
    const run = harness();
    run.dispatch(bulkUpsertSessions([session({ messages: [message('m-10', 10)] })]));
    let resolvePage!: (value: unknown) => void;
    mocks.getConversation.mockReturnValueOnce(
      new Promise((done) => {
        resolvePage = done;
      }),
    );
    run.channel.put(olderHistoryPageRequested(WS, AGENT));
    await settle();
    expect(run.chat()?.fetchingOlderHistory).toBe(true);

    // Second request while the first is in flight: dropped, no second call.
    run.channel.put(olderHistoryPageRequested(WS, AGENT));
    await settle();
    expect(mocks.getConversation).toHaveBeenCalledTimes(1);

    resolvePage(page([message('m-09', 9)], { nextToken: null }));
    await settle();
    expect(run.chat()?.fetchingOlderHistory).toBe(false);
    expect(run.history()?.messages.map((m) => m.id)).toEqual(['m-09']);
    run.task.cancel();
    await run.task.toPromise();
  });

  it('retains one recovered marker across existing history and both cap-pruning directions', async () => {
    const run = harness();
    run.dispatch(
      bulkUpsertSessions([
        session({
          status: AgentStatus.Idle,
          messages: [message('m-tail', 2000)],
          metadata: { pendingQuestionsMessageId: 'm-question' },
        }),
      ]),
    );
    run.dispatch(
      prependHistoryMessages(AGENT, [message('m-existing-1', 1100), message('m-existing-2', 1101)]),
    );
    const historyBeforeRecovery = run.history()?.messages;
    mocks.getConversation.mockResolvedValueOnce(
      page([questionMessage('m-question', 1000)], {
        totalMessages: 2001,
        nextToken: 'unused',
      }),
    );

    run.dispatch(pendingQuestionRecoveryRequested(AGENT, 'm-question'));
    await settle();

    expect(mocks.getConversation).toHaveBeenCalledTimes(1);
    expect(mocks.getConversation).toHaveBeenCalledWith(AGENT, 1, undefined, 'm-question');
    expect(run.history()?.messages).toBe(historyBeforeRecovery);
    expect(run.chat()?.pendingQuestionRecovery).toMatchObject({
      messageId: 'm-question',
      status: 'found',
    });
    expect(
      deriveWizardPendingQuestions(run.state(), AGENT, [message('m-tail', 2000)]),
    ).toMatchObject({ messageId: 'm-question' });

    run.dispatch(prependHistoryMessages(AGENT, [questionMessage('m-question', 1000)]));
    const composed = composeTranscript(
      run.history()?.messages ?? [],
      [message('m-tail', 2000)],
      run.history()?.gapToTail === true,
    );
    expect(
      composed.groups.flatMap((group) => group.messages).filter((item) => item.id === 'm-question'),
    ).toHaveLength(1);

    run.dispatch(
      prependHistoryMessages(
        AGENT,
        Array.from({ length: HISTORY_SEGMENT_MAX }, (_, index) =>
          message(`m-older-${index}`, index),
        ),
      ),
    );
    expect(run.history()?.messages.some((item) => item.id === 'm-question')).toBe(false);
    run.dispatch(pendingQuestionRecoveryRequested(AGENT, 'm-question'));
    expect(deriveWizardPendingQuestions(run.state(), AGENT, [])).toMatchObject({
      messageId: 'm-question',
    });

    run.dispatch(
      appendHistoryMessages(
        AGENT,
        Array.from({ length: HISTORY_SEGMENT_MAX }, (_, index) =>
          message(`m-newer-${index}`, 1200 + index),
        ),
      ),
    );
    run.dispatch(pendingQuestionRecoveryRequested(AGENT, 'm-question'));
    await settle();
    expect(deriveWizardPendingQuestions(run.state(), AGENT, [])).toMatchObject({
      messageId: 'm-question',
    });
    expect(mocks.getConversation).toHaveBeenCalledTimes(1);
    run.task.cancel();
    await run.task.toPromise();
  });

  it('does not land a recovered row when the marker clears during the request', async () => {
    const run = harness();
    run.dispatch(
      bulkUpsertSessions([
        session({
          messages: [message('m-tail', 100)],
          metadata: { pendingQuestionsMessageId: 'm-question' },
        }),
      ]),
    );
    let resolvePage!: (value: ReturnType<typeof page>) => void;
    mocks.getConversation.mockReturnValueOnce(
      new Promise((done) => {
        resolvePage = done;
      }),
    );
    run.dispatch(pendingQuestionRecoveryRequested(AGENT, 'm-question'));
    await settle();
    run.dispatch(updateSession(AGENT, { metadata: { pendingQuestionsMessageId: '' } }));
    resolvePage(page([message('m-question', 10)]));
    await settle();

    expect(run.history()).toBeUndefined();
    expect(run.chat()?.pendingQuestionRecovery).toBeUndefined();
    expect(mocks.getConversation).toHaveBeenCalledTimes(1);
    run.task.cancel();
    await run.task.toPromise();
  });

  it('retries one transient recovery failure without allowing duplicate panel requests', async () => {
    vi.useFakeTimers();
    const run = harness();
    run.dispatch(
      bulkUpsertSessions([
        session({
          status: AgentStatus.Idle,
          metadata: { pendingQuestionsMessageId: 'm-question' },
        }),
      ]),
    );
    mocks.getConversation
      .mockRejectedValueOnce(new Error('temporary transport failure'))
      .mockResolvedValueOnce(page([questionMessage('m-question', 10)]));

    run.dispatch(pendingQuestionRecoveryRequested(AGENT, 'm-question'));
    run.dispatch(pendingQuestionRecoveryRequested(AGENT, 'm-question'));
    await settle();

    expect(mocks.getConversation).toHaveBeenCalledTimes(1);
    expect(run.chat()?.pendingQuestionRecovery?.status).toBe('loading');
    await vi.advanceTimersByTimeAsync(250);
    await settle();

    expect(mocks.getConversation).toHaveBeenCalledTimes(2);
    expect(run.chat()?.pendingQuestionRecovery?.status).toBe('found');
    expect(deriveWizardPendingQuestions(run.state(), AGENT, [])).toMatchObject({
      messageId: 'm-question',
    });
    run.task.cancel();
    await run.task.toPromise();
  });

  it('exhausts bounded transport retries and does not restart for the same marker', async () => {
    vi.useFakeTimers();
    const run = harness();
    run.dispatch(
      bulkUpsertSessions([session({ metadata: { pendingQuestionsMessageId: 'm-question' } })]),
    );
    mocks.getConversation.mockRejectedValue(new Error('transport unavailable'));

    run.dispatch(pendingQuestionRecoveryRequested(AGENT, 'm-question'));
    await settle();
    await vi.advanceTimersByTimeAsync(250);
    await settle();
    await vi.advanceTimersByTimeAsync(1_000);
    await settle();

    expect(mocks.getConversation).toHaveBeenCalledTimes(3);
    expect(run.chat()?.pendingQuestionRecovery).toEqual({
      messageId: 'm-question',
      status: 'error',
    });
    expect(deriveMarkedQuestionRecoveryState(run.state(), AGENT)).toEqual({
      messageId: 'm-question',
      shouldRequest: false,
      loading: true,
    });
    run.dispatch(pendingQuestionRecoveryRequested(AGENT, 'm-question'));
    await vi.advanceTimersByTimeAsync(10_000);
    await settle();
    expect(mocks.getConversation).toHaveBeenCalledTimes(3);
    run.task.cancel();
    await run.task.toPromise();
  });

  it('cancels a stale in-flight completion when the marker changes', async () => {
    const run = harness();
    run.dispatch(
      bulkUpsertSessions([session({ metadata: { pendingQuestionsMessageId: 'm-old' } })]),
    );
    let resolveOld!: (value: ReturnType<typeof page>) => void;
    mocks.getConversation
      .mockReturnValueOnce(new Promise((resolve) => (resolveOld = resolve)))
      .mockResolvedValueOnce(page([questionMessage('m-new', 11)]));

    run.dispatch(pendingQuestionRecoveryRequested(AGENT, 'm-old'));
    await settle();
    run.dispatch(updateSession(AGENT, { metadata: { pendingQuestionsMessageId: 'm-new' } }));
    run.dispatch(pendingQuestionRecoveryRequested(AGENT, 'm-new'));
    await settle();
    resolveOld(page([questionMessage('m-old', 10)]));
    await settle();

    expect(mocks.getConversation).toHaveBeenCalledTimes(2);
    expect(run.chat()?.pendingQuestionRecovery).toMatchObject({
      messageId: 'm-new',
      status: 'found',
    });
    run.task.cancel();
    await run.task.toPromise();
  });

  it('stops a scheduled retry when the session is removed', async () => {
    vi.useFakeTimers();
    const run = harness();
    run.dispatch(
      bulkUpsertSessions([session({ metadata: { pendingQuestionsMessageId: 'm-question' } })]),
    );
    mocks.getConversation.mockRejectedValue(new Error('temporary transport failure'));

    run.dispatch(pendingQuestionRecoveryRequested(AGENT, 'm-question'));
    await settle();
    run.dispatch(removeSession(AGENT));
    await settle();
    await vi.advanceTimersByTimeAsync(10_000);
    await settle();

    expect(mocks.getConversation).toHaveBeenCalledTimes(1);
    expect(run.chat()?.pendingQuestionRecovery).toBeUndefined();
    run.task.cancel();
    await run.task.toPromise();
  });

  it('recovers a pending-proposal carrying message with a bounded targeted seek', async () => {
    const run = harness();
    const pendingProposal = proposal('toolu-1');
    run.dispatch(
      bulkUpsertSessions([
        session({
          status: AgentStatus.Idle,
          messages: [message('m-tail', 2000)],
          metadata: {
            pendingProposals: [{ proposalId: 'toolu-1', messageId: 'm-proposal' }],
          },
        }),
      ]),
    );
    // The carrying message is outside the loaded window: recovery names one
    // needed lookup.
    expect(derivePendingProposalRecoveryState(run.state(), AGENT)).toEqual([
      { messageId: 'm-proposal', shouldRequest: true, loading: true },
    ]);
    mocks.getConversation.mockResolvedValueOnce(
      page([proposalMessage('m-proposal', 1000, [pendingProposal])], { totalMessages: 2001 }),
    );
    run.dispatch(pendingProposalRecoveryRequested(AGENT, 'm-proposal'));
    await settle();

    expect(mocks.getConversation).toHaveBeenCalledTimes(1);
    expect(mocks.getConversation).toHaveBeenCalledWith(AGENT, 1, undefined, 'm-proposal');
    expect(run.chat()?.pendingProposalRecovery?.['m-proposal']).toMatchObject({
      status: 'found',
    });
    // Recovered rows never land in transcript state.
    expect(run.history()).toBeUndefined();
    run.task.cancel();
    await run.task.toPromise();
  });

  it('runs independent recoveries per carrying message and settles resident rows without a fetch', async () => {
    const run = harness();
    const p1 = proposal('toolu-1');
    const p2 = proposal('toolu-2');
    run.dispatch(
      bulkUpsertSessions([
        session({
          messages: [proposalMessage('m-resident', 90, [p2])],
          metadata: {
            pendingProposals: [
              { proposalId: 'toolu-1', messageId: 'm-far' },
              { proposalId: 'toolu-2', messageId: 'm-resident' },
            ],
          },
        }),
      ]),
    );
    // Only the non-resident message needs a lookup.
    expect(derivePendingProposalRecoveryState(run.state(), AGENT)).toEqual([
      { messageId: 'm-far', shouldRequest: true, loading: true },
    ]);
    mocks.getConversation.mockResolvedValueOnce(page([proposalMessage('m-far', 10, [p1])]));
    run.dispatch(pendingProposalRecoveryRequested(AGENT, 'm-far'));
    run.dispatch(pendingProposalRecoveryRequested(AGENT, 'm-resident'));
    await settle();

    expect(mocks.getConversation).toHaveBeenCalledTimes(1);
    expect(run.chat()?.pendingProposalRecovery?.['m-far']?.status).toBe('found');
    // Resident carrying message settles synchronously from the loaded row.
    expect(run.chat()?.pendingProposalRecovery?.['m-resident']?.status).toBe('found');
    run.task.cancel();
    await run.task.toPromise();
  });

  it('cancels an in-flight proposal recovery when a prune drops its messageId', async () => {
    const run = harness();
    run.dispatch(
      bulkUpsertSessions([
        session({
          metadata: { pendingProposals: [{ proposalId: 'toolu-1', messageId: 'm-proposal' }] },
        }),
      ]),
    );
    let resolvePage!: (value: ReturnType<typeof page>) => void;
    mocks.getConversation.mockReturnValueOnce(
      new Promise((done) => {
        resolvePage = done;
      }),
    );
    run.dispatch(pendingProposalRecoveryRequested(AGENT, 'm-proposal'));
    await settle();
    run.dispatch(updateSession(AGENT, { metadata: { pendingProposals: [] } }));
    run.dispatch(pendingProposalRecoveryPruned(AGENT, []));
    resolvePage(page([proposalMessage('m-proposal', 10, [proposal('toolu-1')])]));
    await settle();

    expect(run.chat()?.pendingProposalRecovery).toBeUndefined();
    expect(mocks.getConversation).toHaveBeenCalledTimes(1);
    run.task.cancel();
    await run.task.toPromise();
  });

  it('latches a stale marker after one failed seek and ignores repeated derivations', async () => {
    const run = harness();
    run.dispatch(
      bulkUpsertSessions([
        session({
          messages: [message('m-tail', 100)],
          metadata: { pendingQuestionsMessageId: 'm-stale' },
        }),
      ]),
    );
    mocks.getConversation.mockRejectedValueOnce({ code: 'INVALID_PARAMS' });

    run.dispatch(pendingQuestionRecoveryRequested(AGENT, 'm-stale'));
    await settle();
    run.dispatch(pendingQuestionRecoveryRequested(AGENT, 'm-stale'));
    run.dispatch(pendingQuestionRecoveryRequested(AGENT, 'm-stale'));
    await settle();

    expect(mocks.getConversation).toHaveBeenCalledTimes(1);
    expect(run.chat()?.pendingQuestionRecovery).toEqual({
      messageId: 'm-stale',
      status: 'not-found',
    });
    expect(run.history()).toBeUndefined();
    run.task.cancel();
    await run.task.toPromise();
  });

  it('clears the fetching flag and drops the cursor when the older fetch fails', async () => {
    const run = harness();
    run.dispatch(bulkUpsertSessions([session({ messages: [message('m-10', 10)] })]));
    mocks.getConversation.mockRejectedValueOnce(new Error('wire failed'));
    run.channel.put(olderHistoryPageRequested(WS, AGENT));
    await settle();

    expect(run.chat()?.fetchingOlderHistory).toBe(false);
    expect(run.chat()?.scrollbackOlderToken).toBeNull();
    expect(run.history()).toBeUndefined();

    // Next request recovers with a fresh seek.
    mocks.getConversation.mockResolvedValueOnce(page([message('m-09', 9)], { nextToken: null }));
    run.channel.put(olderHistoryPageRequested(WS, AGENT));
    await settle();
    expect(mocks.getConversation.mock.calls).toEqual([
      [AGENT, 200, undefined, 'm-10'],
      [AGENT, 200, undefined, 'm-10'],
    ]);
    expect(run.history()?.messages.map((m) => m.id)).toEqual(['m-09']);
    run.task.cancel();
    await run.task.toPromise();
  });

  it('opens the hole past the segment cap, then a gap refill closes it on tail overlap', async () => {
    const run = harness();
    run.dispatch(bulkUpsertSessions([session({ messages: [message('m-tail', 2000)] })]));
    // Fill history to the cap, then prepend one more page: the reducer prunes
    // from the NEWEST side and flips gapToTail.
    const bulk: AgentMessage[] = [];
    for (let index = 0; index < HISTORY_SEGMENT_MAX; index++) {
      bulk.push(message(`m-${String(index + 1000)}`, index + 1000));
    }
    run.dispatch(prependHistoryMessages(AGENT, bulk));
    expect(run.history()?.gapToTail).toBe(false);
    run.dispatch(prependHistoryMessages(AGENT, [message('m-0999', 999)]));
    expect(run.history()?.gapToTail).toBe(true);
    expect(run.history()?.messages).toHaveLength(HISTORY_SEGMENT_MAX);

    const newest = run.history()!.messages[HISTORY_SEGMENT_MAX - 1].id as string;
    // Gap refill: seek at history's newest; the page overlaps the tail row,
    // so appendHistoryMessages closes the hole.
    mocks.getConversation.mockResolvedValueOnce(
      page([message(newest, 1000), message('m-mid', 1600), message('m-tail', 2000)], {
        prevToken: null,
      }),
    );
    run.channel.put(historyGapFillRequested(WS, AGENT));
    await settle();

    expect(mocks.getConversation).toHaveBeenCalledWith(AGENT, 200, undefined, newest);
    expect(run.history()?.gapToTail).toBe(false);
    expect(run.chat()?.fetchingGapFill).toBe(false);
    expect(run.chat()?.scrollbackGapToken).toBeNull();
    run.task.cancel();
    await run.task.toPromise();
  });

  it('keeps walking prevToken across gap-fill requests while the hole stays open', async () => {
    const run = harness();
    run.dispatch(bulkUpsertSessions([session({ messages: [message('m-tail', 2000)] })]));
    const bulk: AgentMessage[] = [];
    for (let index = 0; index <= HISTORY_SEGMENT_MAX; index++) {
      bulk.push(message(`m-${String(index + 1000)}`, index + 1000));
    }
    run.dispatch(prependHistoryMessages(AGENT, bulk));
    expect(run.history()?.gapToTail).toBe(true);

    // Page of rows the tail has since pruned: no overlap, gap stays open,
    // forward cursor persists for the next request.
    mocks.getConversation.mockResolvedValueOnce(
      page([message('m-pruned-1', 1900)], { prevToken: 'fwd-1' }),
    );
    run.channel.put(historyGapFillRequested(WS, AGENT));
    await settle();
    expect(run.history()?.gapToTail).toBe(true);
    expect(run.chat()?.scrollbackGapToken).toBe('fwd-1');

    mocks.getConversation.mockResolvedValueOnce(
      page([message('m-tail', 2000)], { prevToken: null }),
    );
    run.channel.put(historyGapFillRequested(WS, AGENT));
    await settle();

    expect(mocks.getConversation.mock.calls[1]).toEqual([AGENT, 200, 'fwd-1']);
    expect(run.history()?.gapToTail).toBe(false);
    run.task.cancel();
    await run.task.toPromise();
  });

  it('skips the gap fill entirely when no hole is open', async () => {
    const run = harness();
    run.dispatch(bulkUpsertSessions([session({ messages: [message('m-10', 10)] })]));
    run.dispatch(prependHistoryMessages(AGENT, [message('m-05', 5)]));
    run.channel.put(historyGapFillRequested(WS, AGENT));
    await settle();
    expect(mocks.getConversation).not.toHaveBeenCalled();
    run.task.cancel();
    await run.task.toPromise();
  });

  it('an older prepend settle drops the gap cursor (cap prune invalidates the forward walk)', async () => {
    const run = harness();
    run.dispatch(bulkUpsertSessions([session({ messages: [message('m-tail', 2000)] })]));
    const bulk: AgentMessage[] = [];
    for (let index = 0; index <= HISTORY_SEGMENT_MAX; index++) {
      bulk.push(message(`m-${String(index + 1000)}`, index + 1000));
    }
    run.dispatch(prependHistoryMessages(AGENT, bulk));
    mocks.getConversation.mockResolvedValueOnce(
      page([message('m-pruned-1', 1900)], { prevToken: 'fwd-1' }),
    );
    run.channel.put(historyGapFillRequested(WS, AGENT));
    await settle();
    expect(run.chat()?.scrollbackGapToken).toBe('fwd-1');

    mocks.getConversation.mockResolvedValueOnce(
      page([message('m-0500', 500)], { nextToken: 'older-1' }),
    );
    run.channel.put(olderHistoryPageRequested(WS, AGENT));
    await settle();
    expect(run.chat()?.scrollbackOlderToken).toBe('older-1');
    expect(run.chat()?.scrollbackGapToken).toBeNull();
    run.task.cancel();
    await run.task.toPromise();
  });

  it('resets segment + continuation state on a §7.1 resumed:false snapshot', async () => {
    const run = harness();
    run.dispatch(bulkUpsertSessions([session({ messages: [message('m-10', 10)] })]));
    mocks.getConversation.mockResolvedValueOnce(
      page([message('m-05', 5)], { nextToken: 'older-1' }),
    );
    run.channel.put(olderHistoryPageRequested(WS, AGENT));
    await settle();
    expect(run.history()?.messages).toHaveLength(1);
    expect(run.chat()?.scrollbackOlderToken).toBe('older-1');

    run.channel.put(
      chatTranscriptSnapshotApplied(AGENT, {
        truncated: true,
        totalMessages: 20,
        oldestMessageId: 'm-15',
        resumed: false,
      }),
    );
    await settle();

    expect(run.history()).toBeUndefined();
    expect(run.chat()?.scrollbackOlderToken).toBeNull();
    expect(run.chat()?.scrollbackGapToken).toBeNull();
    expect(run.chat()?.fetchingOlderHistory).toBe(false);
    expect(run.chat()?.fetchingGapFill).toBe(false);
    run.task.cancel();
    await run.task.toPromise();
  });

  it('a resumed:false snapshot clears a stranded fetching flag even while the wire call hangs', async () => {
    const run = harness();
    run.dispatch(bulkUpsertSessions([session({ messages: [message('m-10', 10)] })]));
    // Transport died mid-fetch: the promise never settles, so the saga's
    // finally-settle can never clear the flag — the reducer's atomic reset
    // on the discard snapshot must.
    mocks.getConversation.mockReturnValueOnce(new Promise(() => {}));
    run.channel.put(olderHistoryPageRequested(WS, AGENT));
    await settle();
    expect(run.chat()?.fetchingOlderHistory).toBe(true);

    // Dispatch (not a bare channel put): the reducers must see the snapshot
    // — the atomic reset under test lives there, not in the saga chain.
    run.dispatch(
      chatTranscriptSnapshotApplied(AGENT, {
        truncated: false,
        totalMessages: 3,
        resumed: false,
      }),
    );
    await settle();

    expect(run.chat()?.fetchingOlderHistory).toBe(false);
    expect(run.chat()?.fetchingGapFill).toBe(false);
    expect(run.chat()?.fetchingHistorySeek).toBe(false);
    expect(run.chat()?.scrollbackOlderToken).toBeNull();
    expect(run.chat()?.scrollbackGapToken).toBeNull();
    expect(run.history()).toBeUndefined();
    run.task.cancel();
    await run.task.toPromise();
  });

  it('drops an in-flight older page that resolves AFTER a resumed:false discard', async () => {
    const run = harness();
    run.dispatch(bulkUpsertSessions([session({ messages: [message('m-10', 10)] })]));
    let resolvePage!: (value: ReturnType<typeof page>) => void;
    mocks.getConversation.mockReturnValueOnce(
      new Promise((done) => {
        resolvePage = done;
      }),
    );
    run.channel.put(olderHistoryPageRequested(WS, AGENT));
    await settle();
    expect(run.chat()?.fetchingOlderHistory).toBe(true);

    // §7.1 discard lands while the wire call is in flight: the reducer
    // resets the walk atomically (flags + cursors + epoch bump).
    run.dispatch(
      chatTranscriptSnapshotApplied(AGENT, {
        truncated: false,
        totalMessages: 3,
        resumed: false,
      }),
    );
    await settle();
    expect(run.chat()?.fetchingOlderHistory).toBe(false);

    // The stale page resolves afterwards: the worker resumes past its
    // `yield call` — it must drop the result wholesale, not recreate a
    // segment of discarded rows or persist a continuation cursor minted
    // against the discarded transcript.
    resolvePage(page([message('m-05', 5)], { nextToken: 'stale-older-1' }));
    await settle();

    expect(run.history()).toBeUndefined();
    expect(run.chat()?.scrollbackOlderToken).toBeNull();
    expect(run.chat()?.fetchingOlderHistory).toBe(false);
    run.task.cancel();
    await run.task.toPromise();
  });

  it('drops an in-flight gap-fill page that resolves AFTER a resumed:false discard', async () => {
    const run = harness();
    run.dispatch(bulkUpsertSessions([session({ messages: [message('m-tail', 2000)] })]));
    const bulk: AgentMessage[] = [];
    for (let index = 0; index <= HISTORY_SEGMENT_MAX; index++) {
      bulk.push(message(`m-${String(index + 1000)}`, index + 1000));
    }
    run.dispatch(prependHistoryMessages(AGENT, bulk));
    expect(run.history()?.gapToTail).toBe(true);

    let resolveGap!: (value: ReturnType<typeof page>) => void;
    mocks.getConversation.mockReturnValueOnce(
      new Promise((done) => {
        resolveGap = done;
      }),
    );
    run.channel.put(historyGapFillRequested(WS, AGENT));
    await settle();
    expect(run.chat()?.fetchingGapFill).toBe(true);

    run.dispatch(
      chatTranscriptSnapshotApplied(AGENT, {
        truncated: false,
        totalMessages: 3,
        resumed: false,
      }),
    );
    await settle();
    expect(run.history()).toBeUndefined();

    resolveGap(page([message('m-1900', 1900)], { prevToken: 'stale-fwd-1' }));
    await settle();

    expect(run.history()).toBeUndefined();
    expect(run.chat()?.scrollbackGapToken).toBeNull();
    expect(run.chat()?.fetchingGapFill).toBe(false);
    run.task.cancel();
    await run.task.toPromise();
  });

  it('drops an in-flight seek landing that resolves AFTER a resumed:false discard', async () => {
    const run = harness();
    run.dispatch(bulkUpsertSessions([session({ messages: [message('m-tail', 2000)] })]));
    let resolveSeek!: (value: ReturnType<typeof page>) => void;
    mocks.getConversation.mockReturnValueOnce(
      new Promise((done) => {
        resolveSeek = done;
      }),
    );
    run.channel.put(historySeekRequested(WS, AGENT, 500));
    await settle();
    expect(run.chat()?.fetchingHistorySeek).toBe(true);

    run.dispatch(
      chatTranscriptSnapshotApplied(AGENT, {
        truncated: false,
        totalMessages: 3,
        resumed: false,
      }),
    );
    await settle();
    expect(run.chat()?.fetchingHistorySeek).toBe(false);

    resolveSeek(
      page([message('m-500', 500)], {
        totalMessages: 2000,
        nextToken: 'stale-older',
        prevToken: 'stale-newer',
      }),
    );
    await settle();

    expect(run.history()).toBeUndefined();
    expect(run.chat()?.scrollbackOlderToken).toBeNull();
    expect(run.chat()?.scrollbackGapToken).toBeNull();
    expect(run.chat()?.fetchingHistorySeek).toBe(false);
    run.task.cancel();
    await run.task.toPromise();
  });

  // ── Far-flick seek (aroundIndex) ────────────────────────────────────────

  it('seek REPLACES the segment with the landing page, opens the gap, persists both cursors', async () => {
    const run = harness();
    run.dispatch(bulkUpsertSessions([session({ messages: [message('m-tail', 2000)] })]));
    // Pre-existing serial-walk segment that must be discarded wholesale.
    run.dispatch(prependHistoryMessages(AGENT, [message('m-old-a', 1), message('m-old-b', 2)]));
    expect(run.history()?.messages).toHaveLength(2);

    mocks.getConversation.mockResolvedValueOnce(
      page([message('m-500', 500), message('m-501', 501)], {
        totalMessages: 2000,
        nextToken: 'older-from-landing',
        prevToken: 'newer-from-landing',
      }),
    );
    run.channel.put(historySeekRequested(WS, AGENT, 500));
    await settle();

    // Page limit asserted loosely: the QA tiny-caps branch shrinks it.
    expect(mocks.getConversation).toHaveBeenCalledWith(
      AGENT,
      expect.any(Number),
      undefined,
      undefined,
      500,
    );
    expect(run.history()?.messages.map((m) => m.id)).toEqual(['m-500', 'm-501']);
    expect(run.history()?.gapToTail).toBe(true);
    expect(run.history()?.oldestReached).toBe(false);
    expect(run.history()?.startOrdinalEstimate).toBeGreaterThanOrEqual(0);
    expect(run.chat()?.fetchingHistorySeek).toBe(false);
    expect(run.chat()?.scrollbackOlderToken).toBe('older-from-landing');
    expect(run.chat()?.scrollbackGapToken).toBe('newer-from-landing');
    expect(run.chat()?.historySeekUnsupported).toBe(false);
    run.task.cancel();
    await run.task.toPromise();
  });

  it('cursor walks continue BOTH directions from the landing page without re-seeking', async () => {
    const run = harness();
    run.dispatch(bulkUpsertSessions([session({ messages: [message('m-tail', 2000)] })]));
    mocks.getConversation.mockResolvedValueOnce(
      page([message('m-500', 500)], {
        totalMessages: 2000,
        nextToken: 'older-1',
        prevToken: 'newer-1',
      }),
    );
    run.channel.put(historySeekRequested(WS, AGENT, 500));
    await settle();

    // Older direction: continues from the landing's backward cursor.
    mocks.getConversation.mockResolvedValueOnce(
      page([message('m-499', 499)], { nextToken: 'older-2' }),
    );
    run.channel.put(olderHistoryPageRequested(WS, AGENT));
    await settle();
    expect(mocks.getConversation.mock.calls[1]).toEqual([AGENT, expect.any(Number), 'older-1']);
    expect(run.history()?.messages.map((m) => m.id)).toEqual(['m-499', 'm-500']);
    // The prepend settle drops the forward cursor (cap-prune safety), so the
    // next gap fill re-seeks at history's newest — standard walk semantics.
    expect(run.chat()?.scrollbackGapToken).toBeNull();

    // Forward direction: gap fill toward the tail from history's newest.
    mocks.getConversation.mockResolvedValueOnce(
      page([message('m-501', 501)], { prevToken: 'newer-2' }),
    );
    run.channel.put(historyGapFillRequested(WS, AGENT));
    await settle();
    expect(mocks.getConversation.mock.calls[2]).toEqual([
      AGENT,
      expect.any(Number),
      undefined,
      'm-500',
    ]);
    expect(run.history()?.messages.map((m) => m.id)).toEqual(['m-499', 'm-500', 'm-501']);
    expect(run.chat()?.scrollbackGapToken).toBe('newer-2');
    run.task.cancel();
    await run.task.toPromise();
  });

  it('seek landing with nextToken null marks oldestReached (start ordinal exact 0)', async () => {
    const run = harness();
    run.dispatch(bulkUpsertSessions([session({ messages: [message('m-tail', 2000)] })]));
    mocks.getConversation.mockResolvedValueOnce(
      page([message('m-0', 0), message('m-1', 1)], {
        totalMessages: 2000,
        nextToken: null,
        prevToken: 'newer-1',
      }),
    );
    run.channel.put(historySeekRequested(WS, AGENT, 0));
    await settle();

    expect(run.history()?.oldestReached).toBe(true);
    expect(run.history()?.startOrdinalEstimate).toBe(0);
    run.task.cancel();
    await run.task.toPromise();
  });

  it('-32602 rejection latches historySeekUnsupported; later seeks are no-ops (serial fallback)', async () => {
    const run = harness();
    run.dispatch(bulkUpsertSessions([session({ messages: [message('m-10', 10)] })]));
    mocks.getConversation.mockRejectedValueOnce(
      Object.assign(new Error('invalid params'), { rpcCode: -32602 }),
    );
    run.channel.put(historySeekRequested(WS, AGENT, 500));
    await settle();

    expect(run.chat()?.fetchingHistorySeek).toBe(false);
    expect(run.chat()?.historySeekUnsupported).toBe(true);
    expect(run.history()).toBeUndefined();

    // Latched: a second seek request never reaches the wire.
    run.channel.put(historySeekRequested(WS, AGENT, 400));
    await settle();
    expect(mocks.getConversation).toHaveBeenCalledTimes(1);

    // The serial walk still works exactly as before.
    mocks.getConversation.mockResolvedValueOnce(page([message('m-09', 9)], { nextToken: null }));
    run.channel.put(olderHistoryPageRequested(WS, AGENT));
    await settle();
    expect(run.history()?.messages.map((m) => m.id)).toEqual(['m-09']);
    run.task.cancel();
    await run.task.toPromise();
  });

  it('a daemon silently ignoring aroundIndex (legacy newest page, target far away) latches unsupported', async () => {
    const run = harness();
    run.dispatch(bulkUpsertSessions([session({ messages: [message('m-tail', 2000)] })]));
    // Legacy response: newest page, no prevToken key (normalized to null),
    // and the page cannot contain the far target ordinal.
    mocks.getConversation.mockResolvedValueOnce(
      page([message('m-1999', 1999)], { totalMessages: 2000, nextToken: 'older-1' }),
    );
    run.channel.put(historySeekRequested(WS, AGENT, 500));
    await settle();

    expect(run.chat()?.historySeekUnsupported).toBe(true);
    expect(run.history()).toBeUndefined();
    run.task.cancel();
    await run.task.toPromise();
  });

  it('a prevToken-null landing that DOES cover the target seeds at the newest page (edge clamp)', async () => {
    const run = harness();
    run.dispatch(bulkUpsertSessions([session({ messages: [] })]));
    // Seek near the newest end: daemon clamps, page covers ordinals 1998-1999.
    mocks.getConversation.mockResolvedValueOnce(
      page([message('m-1998', 1998), message('m-1999', 1999)], {
        totalMessages: 2000,
        nextToken: 'older-1',
      }),
    );
    run.channel.put(historySeekRequested(WS, AGENT, 1999));
    await settle();

    expect(run.chat()?.historySeekUnsupported).toBe(false);
    expect(run.history()?.messages.map((m) => m.id)).toEqual(['m-1998', 'm-1999']);
    expect(run.history()?.startOrdinalEstimate).toBe(1998);
    expect(run.chat()?.scrollbackOlderToken).toBe('older-1');
    run.task.cancel();
    await run.task.toPromise();
  });

  it('dedupes concurrent seeks and refuses to race an in-flight serial fetch', async () => {
    const run = harness();
    run.dispatch(bulkUpsertSessions([session({ messages: [message('m-10', 10)] })]));
    let resolveOlder!: (value: unknown) => void;
    mocks.getConversation.mockReturnValueOnce(
      new Promise((done) => {
        resolveOlder = done;
      }),
    );
    run.channel.put(olderHistoryPageRequested(WS, AGENT));
    await settle();
    expect(run.chat()?.fetchingOlderHistory).toBe(true);

    // Seek while a serial page is in flight: dropped.
    run.channel.put(historySeekRequested(WS, AGENT, 500));
    await settle();
    expect(mocks.getConversation).toHaveBeenCalledTimes(1);

    resolveOlder(page([message('m-09', 9)], { nextToken: null }));
    await settle();
    run.task.cancel();
    await run.task.toPromise();
  });

  it('refuses to start a serial page or gap fill while a seek is in flight', async () => {
    const run = harness();
    run.dispatch(bulkUpsertSessions([session({ messages: [message('m-10', 10)] })]));
    let resolveSeek!: (value: unknown) => void;
    mocks.getConversation.mockReturnValueOnce(
      new Promise((done) => {
        resolveSeek = done;
      }),
    );
    run.channel.put(historySeekRequested(WS, AGENT, 500));
    await settle();
    expect(run.chat()?.fetchingHistorySeek).toBe(true);

    // Serial page and gap fill while the seek is in flight: both dropped —
    // the seek's landing REPLACES the segment, so a page anchored at the
    // pre-seek segment must never merge into the seeded one.
    run.channel.put(olderHistoryPageRequested(WS, AGENT));
    run.channel.put(historyGapFillRequested(WS, AGENT));
    await settle();
    expect(mocks.getConversation).toHaveBeenCalledTimes(1);

    resolveSeek(page([message('m-500', 500)], { totalMessages: 2000, nextToken: 'older-1' }));
    await settle();
    expect(run.chat()?.fetchingHistorySeek).toBe(false);
    run.task.cancel();
    await run.task.toPromise();
  });
});
