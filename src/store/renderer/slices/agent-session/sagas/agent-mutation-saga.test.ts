import { runSaga, stdChannel, type Task } from 'redux-saga';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  getConversation: vi.fn(),
  updateSpecialist: vi.fn(),
  rename: vi.fn(),
  deleteAgent: vi.fn(),
  cancelDelete: vi.fn(),
  dismissQuestions: vi.fn(),
  resolveProposal: vi.fn(),
  restore: vi.fn(),
  warning: vi.fn(),
  error: vi.fn(),
}));
vi.mock('$lib/client', () => ({
  appClient: {
    agents: {
      get: mocks.get,
      getConversation: mocks.getConversation,
      updateSpecialist: mocks.updateSpecialist,
      rename: mocks.rename,
      delete: mocks.deleteAgent,
      cancelDelete: mocks.cancelDelete,
      dismissQuestions: mocks.dismissQuestions,
      resolveProposal: mocks.resolveProposal,
      restore: mocks.restore,
    },
  },
}));
vi.mock('svelte-sonner', () => ({
  toast: { warning: mocks.warning, error: mocks.error },
}));

import {
  clearPendingAgentDeletions,
  getPendingAgentDeletion,
  listPendingAgentDeletions,
} from '$features/agent/utils/pending-agent-deletions';
import { loadChatTranscript } from '$features/agent/chat-read-service';
import { store as appStore } from '$store/renderer/store';
import type { AgentSession } from '$shared/types';
import { AgentStatus } from '$shared/types';
import {
  refreshWorkspaceSubscriptionEntriesRequested,
  removeWatchedAgent,
} from '../../agent-subscription-ui/agent-subscription-ui-slice';
import { selectAgentSubscriptions } from '../../agent-subscription-ui/agent-subscription-ui-selectors';
import {
  activateAgentRequested,
  deleteAgentWithUndoRequested,
  deleteAgentSessionRequested,
  renameAgentSessionRequested,
  restoreAgentSessionRequested,
  restoreRetiredAgentRequested,
  saveAgentSessionRequested,
  undoAgentDeletionRequested,
  initialState as workspaceAgentsInitialState,
  workspaceAgentsReducer,
} from '../../workspace-agents/workspace-agents-slice';
import { selectWorkspaceAgentIds } from '../../workspace-agents/workspace-agents-selectors';
import {
  agentProposalResolveRequested,
  agentSessionDismissQuestionsRequested,
  agentSessionReducer,
  bulkUpsertSessions,
  FE_OWNED_FIELD_POLICY,
  initialState as agentSessionInitialState,
  removeSession,
  restoreStoredSessions,
  updateSession,
  upsertSession,
} from '../agent-session-slice';
import type { FeOwnedSessionState, StoredAgentSession } from '../agent-session-types';
import {
  agentScopedProposalKey,
  proposalResolutionReconciled,
} from '../../proposal-lifecycle/proposal-lifecycle-slice';
import { selectAgentSession } from '../agent-session-selectors';
import { TOAST_COUNTDOWN_CLASS } from '$lib/components/ui/toast';
import { AGENT_DELETION_TOMBSTONE_TTL_MS, agentMutationSaga } from './agent-mutation-saga';

const WS = 'ws-mutation';
const A1 = 'agent-1';
// Flush microtasks so the forked showUndoToast dynamic import settles before
// the next dispatch (its in-flight import races showError's otherwise).
const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

function session(id = A1, overrides: Partial<AgentSession> = {}): AgentSession {
  return {
    id,
    backendSessionId: `backend-${id}`,
    workspaceId: WS,
    name: id,
    status: AgentStatus.Active,
    messages: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  } as AgentSession;
}

/**
 * Run the saga against a static state snapshot, or (`live`) against a store whose
 * `agentSessions` slice is folded through the real reducer on every dispatch, so
 * mid-request selects observe earlier writes the way the app store does.
 */
function start(
  sessions: Record<string, AgentSession> = { [A1]: session() },
  { live = false }: { live?: boolean } = {},
) {
  const channel = stdChannel();
  const dispatched: any[] = [];
  let state = { agentSessions: { ...agentSessionInitialState, byAgentId: sessions } };
  const dispatch = (action: any) => {
    if (live) state = { agentSessions: agentSessionReducer(state.agentSessions, action) };
    dispatched.push(action);
    channel.put(action);
    return action;
  };
  const task = runSaga({ channel, getState: () => state, dispatch }, agentMutationSaga);
  return { channel, dispatched, dispatch, task, getState: () => state };
}

async function stop(task: Task): Promise<void> {
  task.cancel();
  await task.toPromise();
}

describe('agentMutationSaga', () => {
  beforeAll(() => appStore.init());

  beforeEach(() => {
    vi.useFakeTimers();
    mocks.deleteAgent.mockResolvedValue({ success: true });
  });

  afterEach(() => {
    clearPendingAgentDeletions();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('restores through agents.get, preserves hydrated messages, and settles success', async () => {
    const messages = [{ id: 'm1', role: 'user', contentBlocks: [], timestamp: '2026-01-01' }];
    const existing = session(A1, { backendSessionId: null, messages } as Partial<AgentSession>);
    mocks.get.mockResolvedValue(session(A1, { messages: [] }));
    const { channel, dispatched, task } = start({ [A1]: existing });
    const action = restoreAgentSessionRequested(WS, A1);
    channel.put(action);

    await expect(action.promise).resolves.toEqual(expect.objectContaining({ id: A1, messages }));
    expect(mocks.get).toHaveBeenCalledWith(A1);
    const upsert = dispatched.find((candidate) => candidate.type === bulkUpsertSessions.type);
    expect(upsert.payload[0][0]).toEqual(expect.objectContaining({ id: A1, messages }));
    await stop(task);
  });

  it('un-retires through agent.restore and clears retiredAt locally on success', async () => {
    const existing = session(A1, { retiredAt: '2026-01-02T00:00:00.000Z' });
    mocks.restore.mockResolvedValue({ success: true });
    const { channel, dispatched, task } = start({ [A1]: existing });
    const action = restoreRetiredAgentRequested(WS, A1);
    channel.put(action);

    await expect(action.promise).resolves.toBeUndefined();
    expect(mocks.restore).toHaveBeenCalledWith(A1, WS);
    const restore = dispatched.find((candidate) => candidate.type === restoreStoredSessions.type);
    expect(restore.payload[0][0]).toEqual(
      expect.objectContaining({ id: A1, retiredAt: undefined }),
    );
    expect(dispatched.some((candidate) => candidate.type === bulkUpsertSessions.type)).toBe(false);
    await stop(task);
  });

  it('surfaces an agent.restore daemon failure as an error toast and rejects', async () => {
    // Per §5.5 a non-retired restore is a no-op success; the documented failure
    // shape is a thrown wire error (e.g. cross-workspace NotFound) that
    // LiveAgentsClient.restore folds into { success: false, error }.
    const existing = session(A1, { retiredAt: '2026-01-02T00:00:00.000Z' });
    mocks.restore.mockResolvedValue({ success: false, error: 'agent not found' });
    const { channel, dispatched, task } = start({ [A1]: existing });
    const action = restoreRetiredAgentRequested(WS, A1);
    channel.put(action);

    await expect(action.promise).rejects.toThrow('agent not found');
    await settle();
    expect(mocks.error).toHaveBeenCalled();
    expect(
      dispatched.find((candidate) => candidate.type === bulkUpsertSessions.type),
    ).toBeUndefined();
    await stop(task);
  });

  it('marks activation failure and rejects the action promise', async () => {
    const existing = session(A1, { backendSessionId: null, status: AgentStatus.Pending });
    mocks.get.mockRejectedValue(new Error('activation failed'));
    const { channel, dispatched, task } = start({ [A1]: existing });
    const action = activateAgentRequested(WS, A1);
    channel.put(action);

    await expect(action.promise).rejects.toThrow('activation failed');
    expect(dispatched).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: updateSession.type,
          payload: [
            A1,
            expect.objectContaining({
              activationState: 'error',
              lastActivationError: 'activation failed',
            }),
          ],
        }),
      ]),
    );
    expect(dispatched.some((candidate) => candidate.type === bulkUpsertSessions.type)).toBe(false);
    await stop(task);
  });

  it('persists a specialist picker change through the agent.update client wrapper', async () => {
    mocks.updateSpecialist.mockResolvedValue({ success: true });
    const { channel, task } = start();
    const action = saveAgentSessionRequested(WS, A1, true, {
      specialistUpdate: {
        specialist: 'spec-writer',
        model: 'grok4.6',
        systemPrompt: 'Coordinate the work.',
      },
    });
    channel.put(action);

    await expect(action.promise).resolves.toBeUndefined();
    expect(mocks.updateSpecialist).toHaveBeenCalledWith({
      agentId: A1,
      workspaceId: WS,
      specialist: 'spec-writer',
      model: 'grok4.6',
      systemPrompt: 'Coordinate the work.',
    });
    await stop(task);
  });

  it('persists clearing the specialist and system prompt as explicit nulls', async () => {
    mocks.updateSpecialist.mockResolvedValue({ success: true });
    const { channel, task } = start();
    const action = saveAgentSessionRequested(WS, A1, true, {
      specialistUpdate: { specialist: null, systemPrompt: null },
    });
    channel.put(action);

    await expect(action.promise).resolves.toBeUndefined();
    expect(mocks.updateSpecialist).toHaveBeenCalledWith({
      agentId: A1,
      workspaceId: WS,
      specialist: null,
      systemPrompt: null,
    });
    await stop(task);
  });

  it('rolls back an optimistic specialist change and surfaces persistence failure', async () => {
    const previousMetadata = { source: 'chat-panel' };
    const optimistic = session(A1, {
      metadata: {
        ...previousMetadata,
        specialist: 'spec-writer',
        behaviorPrompt: 'Coordinate the work.',
      },
      model: 'grok4.6',
    });
    mocks.updateSpecialist.mockResolvedValue({ success: false, error: 'update rejected' });
    const { channel, dispatched, task } = start({ [A1]: optimistic });
    const action = saveAgentSessionRequested(WS, A1, true, {
      specialistUpdate: {
        specialist: 'spec-writer',
        model: 'grok4.6',
        systemPrompt: 'Coordinate the work.',
      },
      specialistRollback: { metadata: previousMetadata, model: 'default-model' },
    });
    channel.put(action);

    await expect(action.promise).rejects.toThrow('update rejected');
    expect(dispatched).toContainEqual(
      updateSession(A1, { metadata: previousMetadata, model: 'default-model' }),
    );
    expect(mocks.error).toHaveBeenCalledWith('update rejected');
    await stop(task);
  });

  it('forwards exact rename parameters and settles daemon failure', async () => {
    mocks.rename.mockResolvedValue({ success: false, error: 'rename rejected' });
    const { channel, task } = start();
    const action = renameAgentSessionRequested(WS, A1, 'New Name');
    channel.put(action);

    await expect(action.promise).rejects.toThrow('rename rejected');
    expect(mocks.rename).toHaveBeenCalledWith(A1, 'New Name', WS);
    await stop(task);
  });

  it('restores an immediately deleted session once and rejects on daemon failure', async () => {
    mocks.deleteAgent.mockResolvedValue({ success: false, error: 'delete rejected' });
    const { channel, dispatched, task } = start();
    const action = deleteAgentSessionRequested(WS, A1);
    channel.put(action);

    await expect(action.promise).rejects.toThrow('delete rejected');
    expect(mocks.deleteAgent).toHaveBeenCalledWith(A1, WS);
    expect(dispatched.filter((candidate) => candidate.type === restoreStoredSessions.type)).toEqual(
      [restoreStoredSessions([session() as StoredAgentSession])],
    );
    await stop(task);
  });

  it('tombstones immediate deletion before a stale conversation read can rehydrate it', async () => {
    const agentId = 'agent-immediate-stale-read';
    const staleSession = session(agentId, { taskNoteId: 'task-stale-read' });
    const conversationStarted = Promise.withResolvers<void>();
    let resolveConversation!: (value: unknown) => void;
    mocks.get.mockResolvedValueOnce(staleSession);
    mocks.getConversation.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveConversation = resolve;
          conversationStarted.resolve();
        }),
    );

    const hydration = loadChatTranscript(agentId);
    // Wait for the held request itself, not the read service's number of microtasks.
    await conversationStarted.promise;
    expect(mocks.getConversation).toHaveBeenCalledWith(agentId, 50, undefined);

    const { channel, task } = start({ [agentId]: staleSession });
    const deletion = deleteAgentSessionRequested(WS, agentId);
    channel.put(deletion);
    await expect(deletion.promise).resolves.toBeUndefined();
    expect(getPendingAgentDeletion(agentId)).toEqual(
      expect.objectContaining({ wsId: WS, agentId, snapshot: staleSession }),
    );

    resolveConversation({ messages: [], truncated: false, totalMessages: 0, nextToken: null });
    await hydration;
    expect(selectAgentSession.select(appStore.state, agentId)).toBeUndefined();
    expect(selectWorkspaceAgentIds.select(appStore.state, WS)).not.toContain(agentId);
    expect(selectAgentSubscriptions.select(appStore.state, WS, agentId)).toEqual([]);

    await vi.advanceTimersByTimeAsync(AGENT_DELETION_TOMBSTONE_TTL_MS);
    expect(getPendingAgentDeletion(agentId)).toBeUndefined();
    await stop(task);
  });

  it('keeps a newer same-agent immediate-delete tombstone when an older attempt fails', async () => {
    const firstDelete = Promise.withResolvers<{ success: false; error: string }>();
    mocks.deleteAgent
      .mockReturnValueOnce(firstDelete.promise)
      .mockResolvedValueOnce({ success: true });
    const { channel, dispatched, task } = start();

    const first = deleteAgentSessionRequested(WS, A1);
    channel.put(first);
    await settle();
    const firstEntry = getPendingAgentDeletion(A1);

    const second = deleteAgentSessionRequested(WS, A1);
    channel.put(second);
    await expect(second.promise).resolves.toBeUndefined();
    const secondEntry = getPendingAgentDeletion(A1);
    expect(secondEntry).toBeDefined();
    expect(secondEntry).not.toBe(firstEntry);

    firstDelete.resolve({ success: false, error: 'older delete rejected' });
    await expect(first.promise).rejects.toThrow('older delete rejected');
    expect(getPendingAgentDeletion(A1)).toBe(secondEntry);
    expect(dispatched.filter((candidate) => candidate.type === restoreStoredSessions.type)).toEqual(
      [],
    );
    expect(dispatched.filter((candidate) => candidate.type === bulkUpsertSessions.type)).toEqual(
      [],
    );

    await vi.advanceTimersByTimeAsync(AGENT_DELETION_TOMBSTONE_TTL_MS);
    expect(getPendingAgentDeletion(A1)).toBeUndefined();
    await stop(task);
  });

  it('rolls back only the failed agent while a different immediate delete succeeds', async () => {
    const secondAgent = 'agent-2';
    const firstDelete = Promise.withResolvers<{ success: false; error: string }>();
    const secondDelete = Promise.withResolvers<{ success: true }>();
    mocks.deleteAgent
      .mockReturnValueOnce(firstDelete.promise)
      .mockReturnValueOnce(secondDelete.promise);
    const { channel, dispatched, task } = start({
      [A1]: session(),
      [secondAgent]: session(secondAgent),
    });

    const first = deleteAgentSessionRequested(WS, A1);
    const second = deleteAgentSessionRequested(WS, secondAgent);
    channel.put(first);
    channel.put(second);
    await settle();

    firstDelete.resolve({ success: false, error: 'first rejected' });
    await expect(first.promise).rejects.toThrow('first rejected');
    expect(getPendingAgentDeletion(A1)).toBeUndefined();
    expect(getPendingAgentDeletion(secondAgent)).toBeDefined();
    expect(dispatched.filter((candidate) => candidate.type === restoreStoredSessions.type)).toEqual(
      [restoreStoredSessions([session() as StoredAgentSession])],
    );
    expect(dispatched.some((candidate) => candidate.type === bulkUpsertSessions.type)).toBe(false);

    secondDelete.resolve({ success: true });
    await expect(second.promise).resolves.toBeUndefined();
    expect(getPendingAgentDeletion(secondAgent)).toBeDefined();
    await stop(task);
  });

  it('clears and restores the owned immediate-delete tombstone on saga cancellation', async () => {
    const pendingDelete = Promise.withResolvers<{ success: true }>();
    mocks.deleteAgent.mockReturnValueOnce(pendingDelete.promise);
    const { channel, dispatched, task } = start();
    const deletion = deleteAgentSessionRequested(WS, A1);
    channel.put(deletion);
    await settle();
    expect(getPendingAgentDeletion(A1)).toBeDefined();

    task.cancel();
    await task.toPromise();
    await expect(deletion.promise).rejects.toThrow();
    expect(getPendingAgentDeletion(A1)).toBeUndefined();
    expect(dispatched.filter((candidate) => candidate.type === restoreStoredSessions.type)).toEqual(
      [restoreStoredSessions([session() as StoredAgentSession])],
    );
    expect(dispatched.some((candidate) => candidate.type === bulkUpsertSessions.type)).toBe(false);
  });

  it('surfaces a daemon dismiss-questions failure as an error toast and rejects', async () => {
    mocks.dismissQuestions.mockResolvedValue({ success: false, error: 'dismiss rejected' });
    const { channel, task } = start();
    const action = agentSessionDismissQuestionsRequested(A1, WS, 'msg-q1');
    channel.put(action);

    await expect(action.promise).rejects.toThrow('dismiss rejected');
    expect(mocks.dismissQuestions).toHaveBeenCalledWith({
      agentId: A1,
      workspaceId: WS,
      messageId: 'msg-q1',
    });
    expect(mocks.error).toHaveBeenCalledWith('dismiss rejected');
    await stop(task);
  });

  it('surfaces a dismiss-questions RPC error as an error toast and rejects', async () => {
    mocks.dismissQuestions.mockRejectedValue(new Error('socket closed'));
    const { channel, task } = start();
    const action = agentSessionDismissQuestionsRequested(A1, WS, 'msg-q1');
    channel.put(action);

    await expect(action.promise).rejects.toThrow('socket closed');
    expect(mocks.error).toHaveBeenCalledWith('socket closed');
    await stop(task);
  });

  it('shows no error toast when dismiss-questions succeeds', async () => {
    mocks.dismissQuestions.mockResolvedValue({ success: true });
    const { channel, task } = start();
    const action = agentSessionDismissQuestionsRequested(A1, WS, 'msg-q1');
    channel.put(action);

    await expect(action.promise).resolves.toBeUndefined();
    expect(mocks.error).not.toHaveBeenCalled();
    await stop(task);
  });

  it('resolveProposal success reconciles lifecycle state and resolves without a toast', async () => {
    mocks.resolveProposal.mockResolvedValue({ success: true });
    const { channel, dispatched, task } = start();
    const action = agentProposalResolveRequested(A1, WS, {
      proposalId: 'toolu-1',
      outcome: 'dismissed',
    });
    channel.put(action);

    await expect(action.promise).resolves.toBeUndefined();
    expect(mocks.resolveProposal).toHaveBeenCalledExactlyOnceWith({
      agentId: A1,
      workspaceId: WS,
      proposalId: 'toolu-1',
      outcome: 'dismissed',
    });
    const reconciled = dispatched.filter(
      (candidate) => candidate.type === proposalResolutionReconciled.type,
    );
    expect(reconciled).toHaveLength(1);
    // Reconciled under the agent-scoped key: daemon ids fall back to
    // preview.title, which can collide across agents.
    expect(reconciled[0].payload[0]).toMatchObject({
      proposalId: agentScopedProposalKey(A1, 'toolu-1'),
      outcome: 'dismissed',
    });
    expect(mocks.error).not.toHaveBeenCalled();
    await stop(task);
  });

  it('resolveProposal forwards detail on applied outcomes', async () => {
    mocks.resolveProposal.mockResolvedValue({ success: true });
    const { channel, task } = start();
    const action = agentProposalResolveRequested(A1, WS, {
      proposalId: 'toolu-2',
      outcome: 'applied',
      detail: 'created workspace ws-new',
    });
    channel.put(action);

    await expect(action.promise).resolves.toBeUndefined();
    expect(mocks.resolveProposal).toHaveBeenCalledExactlyOnceWith({
      agentId: A1,
      workspaceId: WS,
      proposalId: 'toolu-2',
      outcome: 'applied',
      detail: 'created workspace ws-new',
    });
    await stop(task);
  });

  it('surfaces a resolveProposal failure as an error toast, rejects, and does NOT reconcile', async () => {
    mocks.resolveProposal.mockResolvedValue({ success: false, error: 'resolve rejected' });
    const { channel, dispatched, task } = start();
    const action = agentProposalResolveRequested(A1, WS, {
      proposalId: 'toolu-1',
      outcome: 'dismissed',
    });
    channel.put(action);

    await expect(action.promise).rejects.toThrow('resolve rejected');
    expect(mocks.error).toHaveBeenCalledWith('resolve rejected');
    expect(
      dispatched.filter((candidate) => candidate.type === proposalResolutionReconciled.type),
    ).toHaveLength(0);
    await stop(task);
  });

  it('surfaces a resolveProposal RPC error as an error toast and rejects', async () => {
    mocks.resolveProposal.mockRejectedValue(new Error('socket closed'));
    const { channel, dispatched, task } = start();
    const action = agentProposalResolveRequested(A1, WS, {
      proposalId: 'toolu-1',
      outcome: 'applied',
    });
    channel.put(action);

    await expect(action.promise).rejects.toThrow('socket closed');
    expect(mocks.error).toHaveBeenCalledWith('socket closed');
    expect(
      dispatched.filter((candidate) => candidate.type === proposalResolutionReconciled.type),
    ).toHaveLength(0);
    await stop(task);
  });

  it('sends agent.delete with undoDelayMs immediately and undo issues the race-safe cancelDelete', async () => {
    mocks.deleteAgent.mockResolvedValue({
      success: true,
      scheduled: true,
      deleteAt: '2026-08-11T00:00:15.000Z',
    });
    mocks.cancelDelete.mockResolvedValue({ success: true, cancelled: true });
    const { channel, dispatched, task } = start();
    const deletion = deleteAgentWithUndoRequested(WS, A1, 'Agent');
    channel.put(deletion);
    await expect(deletion.promise).resolves.toEqual(session());
    expect(mocks.deleteAgent).toHaveBeenCalledExactlyOnceWith(A1, WS, { undoDelayMs: 15_000 });
    expect(dispatched).toContainEqual(removeWatchedAgent(WS, A1));
    await vi.waitFor(() =>
      expect(mocks.warning).toHaveBeenCalledExactlyOnceWith(
        expect.any(String),
        expect.objectContaining({
          duration: 15_000,
          class: expect.stringContaining(TOAST_COUNTDOWN_CLASS),
          style: expect.stringContaining('--toast-countdown-duration: 15000ms'),
        }),
      ),
    );

    const undo = undoAgentDeletionRequested(WS, A1);
    channel.put(undo);
    await expect(undo.promise).resolves.toBe(true);
    expect(mocks.cancelDelete).toHaveBeenCalledExactlyOnceWith(A1, WS);
    expect(dispatched).toContainEqual(refreshWorkspaceSubscriptionEntriesRequested(WS));
    expect(listPendingAgentDeletions()).toEqual([]);
    await stop(task);
  });

  it('does not resurrect the agent when cancelDelete reports the deletion already committed', async () => {
    mocks.deleteAgent.mockResolvedValue({
      success: true,
      scheduled: true,
      deleteAt: '2026-08-11T00:00:15.000Z',
    });
    mocks.cancelDelete.mockResolvedValue({ success: true, cancelled: false });
    const { channel, dispatched, task } = start();
    const deletion = deleteAgentWithUndoRequested(WS, A1);
    channel.put(deletion);
    await deletion.promise;
    await settle();

    const undo = undoAgentDeletionRequested(WS, A1);
    channel.put(undo);
    await expect(undo.promise).resolves.toBe(false);
    expect(mocks.error).toHaveBeenCalled();
    expect(dispatched).not.toContainEqual(refreshWorkspaceSubscriptionEntriesRequested(WS));
    expect(listPendingAgentDeletions()).toHaveLength(1);
    await stop(task);
  });

  it('restores the session and rejects when the scheduled delete fails on the wire', async () => {
    mocks.deleteAgent.mockResolvedValue({ success: false, error: 'delete rejected' });
    const { channel, dispatched, task } = start();
    const deletion = deleteAgentWithUndoRequested(WS, A1);
    channel.put(deletion);

    await expect(deletion.promise).rejects.toThrow('delete rejected');
    expect(dispatched).toContainEqual(refreshWorkspaceSubscriptionEntriesRequested(WS));
    expect(mocks.error).toHaveBeenCalledWith('delete rejected');
    expect(listPendingAgentDeletions()).toEqual([]);
    await stop(task);
  });

  describe('stored-snapshot restores round-trip FE-owned fields', () => {
    const FE_OWNED: Required<FeOwnedSessionState> = {
      tailCapPruned: true,
      liveTurnOpen: true,
      liveTurnOpenedAt: '2026-01-02T00:00:00.000Z',
      processQueueHint: { waiting: true, used: 3, cap: 3, reason: 'slots' },
    };
    const policyKeys = Object.keys(FE_OWNED_FIELD_POLICY) as Array<keyof FeOwnedSessionState>;
    const storedSession = (): StoredAgentSession =>
      ({ ...session(), isActive: true, isResponding: true, ...FE_OWNED }) as StoredAgentSession;

    const restoresOf = (dispatched: any[]) =>
      dispatched.filter((candidate) => candidate.type === restoreStoredSessions.type);
    const patchesOf = (dispatched: any[]) =>
      dispatched.filter((candidate) => candidate.type === updateSession.type);

    /** Apply the saga's restore dispatch to an empty slice, as the store would after softHide. */
    const reduceRestore = (dispatched: any[]) => {
      const restore = dispatched.find((candidate) => candidate.type === restoreStoredSessions.type);
      expect(restore).toBeDefined();
      expect(dispatched.some((candidate) => candidate.type === bulkUpsertSessions.type)).toBe(
        false,
      );
      return agentSessionReducer(agentSessionInitialState, restore).byAgentId[A1];
    };

    it('every policy key is exercised by the fixture', () => {
      expect(Object.keys(FE_OWNED).sort()).toEqual([...policyKeys].sort());
    });

    it('undo after a scheduled delete reinstates the snapshot with every FE-owned field', async () => {
      mocks.deleteAgent.mockResolvedValue({
        success: true,
        scheduled: true,
        deleteAt: '2026-08-11T00:00:15.000Z',
      });
      mocks.cancelDelete.mockResolvedValue({ success: true, cancelled: true });
      const { channel, dispatched, task } = start({ [A1]: storedSession() });
      const deletion = deleteAgentWithUndoRequested(WS, A1, 'Agent');
      channel.put(deletion);
      await deletion.promise;
      await settle();

      const undo = undoAgentDeletionRequested(WS, A1);
      channel.put(undo);
      await expect(undo.promise).resolves.toBe(true);
      const restored = reduceRestore(dispatched);
      for (const key of policyKeys) {
        expect(restored[key], key).toEqual(FE_OWNED[key]);
      }
      await stop(task);
    });

    it('a scheduled delete failing on the wire reinstates the snapshot with every FE-owned field', async () => {
      mocks.deleteAgent.mockResolvedValue({ success: false, error: 'delete rejected' });
      const { channel, dispatched, task } = start({ [A1]: storedSession() });
      const deletion = deleteAgentWithUndoRequested(WS, A1);
      channel.put(deletion);

      await expect(deletion.promise).rejects.toThrow('delete rejected');
      const restored = reduceRestore(dispatched);
      for (const key of policyKeys) {
        expect(restored[key], key).toEqual(FE_OWNED[key]);
      }
      await stop(task);
    });

    describe('activation bookkeeping patches the stored row instead of re-upserting it', () => {
      /** Fold every dispatched action through the slice, seeded with the stored row. */
      const reduceAll = (dispatched: any[]) => {
        const seeded = agentSessionReducer(
          agentSessionInitialState,
          restoreStoredSessions([storedSession()]),
        );
        return dispatched.reduce(agentSessionReducer, seeded).byAgentId[A1];
      };
      const expectStoredWritesOnly = (dispatched: any[]) => {
        expect(dispatched.some((candidate) => candidate.type === bulkUpsertSessions.type)).toBe(
          false,
        );
        expect(dispatched.some((candidate) => candidate.type === upsertSession.type)).toBe(false);
      };
      const expectFeOwnedIntact = (row: StoredAgentSession) => {
        for (const key of policyKeys) {
          expect(row[key], key).toEqual(FE_OWNED[key]);
        }
      };

      it('start + no-fetched-session fallback keep every FE-owned field', async () => {
        const existing = { ...storedSession(), status: AgentStatus.Pending };
        mocks.get.mockResolvedValue(null);
        const { channel, dispatched, task } = start({ [A1]: existing }, { live: true });
        const action = activateAgentRequested(WS, A1);
        channel.put(action);

        await expect(action.promise).resolves.toEqual(
          expect.objectContaining({ id: A1, activationState: 'active', ...FE_OWNED }),
        );
        expectStoredWritesOnly(dispatched);
        expect(restoresOf(dispatched)).toEqual([]);
        const [activating, activated] = patchesOf(dispatched).map((r) => r.payload[1]);
        expect(activating).toEqual(
          expect.objectContaining({ activationState: 'activating', activationAttempts: 1 }),
        );
        expect(activated).toEqual(
          expect.objectContaining({ activationState: 'active', status: AgentStatus.Active }),
        );
        const row = reduceAll(dispatched);
        expect(row.activationState).toBe('active');
        expectFeOwnedIntact(row);
        await stop(task);
      });

      it('start + error keep every FE-owned field', async () => {
        const existing = { ...storedSession(), status: AgentStatus.Pending };
        mocks.get.mockRejectedValue(new Error('activation failed'));
        const { channel, dispatched, task } = start({ [A1]: existing });
        const action = activateAgentRequested(WS, A1);
        channel.put(action);

        await expect(action.promise).rejects.toThrow('activation failed');
        expectStoredWritesOnly(dispatched);
        const row = reduceAll(dispatched);
        expect(row).toEqual(
          expect.objectContaining({
            activationState: 'error',
            lastActivationError: 'activation failed',
          }),
        );
        expectFeOwnedIntact(row);
        await stop(task);
      });

      it('a fetched daemon snapshot goes through the wire upsert without FE-owned keys', async () => {
        const existing = { ...storedSession(), status: AgentStatus.Pending };
        mocks.get.mockResolvedValue(session(A1, { messages: [] }));
        const { channel, dispatched, task } = start({ [A1]: existing });
        const action = activateAgentRequested(WS, A1);
        channel.put(action);

        await expect(action.promise).resolves.toEqual(
          expect.objectContaining({ id: A1, activationState: 'active' }),
        );
        const [activating] = patchesOf(dispatched).map((r) => r.payload[1]);
        expect(activating).toEqual(expect.objectContaining({ activationState: 'activating' }));
        const wire = dispatched.find((candidate) => candidate.type === bulkUpsertSessions.type);
        expect(wire.payload[0][0]).toEqual(expect.objectContaining({ activationState: 'active' }));
        for (const key of policyKeys) {
          expect(wire.payload[0][0], key).not.toHaveProperty(key);
        }
        await stop(task);
      });

      describe('a live update landing while agent.get is pending survives the settle', () => {
        // Reviewer's A/B probe on PR #2448: the pre-request row has none of the
        // FE-owned fields; the row is replaced mid-read (as the event fold does)
        // with all of them plus streaming/processing set. The bookkeeping write
        // that settles the activation must patch THAT row, not re-restore the
        // stale pre-request snapshot.
        const LIVE = { ...FE_OWNED, isStreaming: true, isProcessing: true };
        const pendingRead = () => {
          let resolve!: (value: AgentSession | null) => void;
          let reject!: (error: Error) => void;
          mocks.get.mockReturnValue(
            new Promise<AgentSession | null>((res, rej) => {
              resolve = res;
              reject = rej;
            }),
          );
          return { resolve: (value: AgentSession | null) => resolve(value), reject };
        };
        const startWithLiveUpdate = async () => {
          const seed = session(A1, { backendSessionId: null, status: AgentStatus.Pending });
          const read = pendingRead();
          const harness = start({ [A1]: seed }, { live: true });
          const action = activateAgentRequested(WS, A1);
          harness.channel.put(action);
          await settle();
          expect(mocks.get).toHaveBeenCalledWith(A1);
          const current = harness.getState().agentSessions.byAgentId[A1];
          expect(current.activationState).toBe('activating');
          harness.dispatch(restoreStoredSessions([{ ...current, ...LIVE } as StoredAgentSession]));
          return { ...harness, action, read };
        };
        const expectLiveIntact = (row: StoredAgentSession) => {
          expectFeOwnedIntact(row);
          expect(row.isStreaming).toBe(true);
          expect(row.isProcessing).toBe(true);
        };

        it('read resolves null', async () => {
          const { action, read, getState, task } = await startWithLiveUpdate();
          read.resolve(null);

          await expect(action.promise).resolves.toEqual(
            expect.objectContaining({ id: A1, activationState: 'active', ...LIVE }),
          );
          const row = getState().agentSessions.byAgentId[A1];
          expect(row.activationState).toBe('active');
          expectLiveIntact(row);
          await stop(task);
        });

        it('read rejects', async () => {
          const { action, read, getState, task } = await startWithLiveUpdate();
          read.reject(new Error('activation failed'));

          await expect(action.promise).rejects.toThrow('activation failed');
          const row = getState().agentSessions.byAgentId[A1];
          expect(row).toEqual(
            expect.objectContaining({
              activationState: 'error',
              lastActivationError: 'activation failed',
            }),
          );
          expectLiveIntact(row);
          await stop(task);
        });

        it('row removed mid-read settles null without resurrecting it', async () => {
          const { action, read, getState, dispatch, dispatched, task } =
            await startWithLiveUpdate();
          dispatch(removeSession(A1));
          read.resolve(null);

          await expect(action.promise).resolves.toBeNull();
          expect(getState().agentSessions.byAgentId[A1]).toBeUndefined();
          expect(restoresOf(dispatched)).toHaveLength(1);
          await stop(task);
        });
      });
    });

    describe('workspace membership is re-registered on restore', () => {
      const membershipAfter = (dispatched: any[]) => {
        const seeded = workspaceAgentsReducer(
          workspaceAgentsInitialState,
          upsertSession(session()),
        );
        return dispatched.reduce(workspaceAgentsReducer, seeded).byWorkspaceId[WS];
      };

      it('through a scheduled delete that fails on the wire', async () => {
        mocks.deleteAgent.mockResolvedValue({ success: false, error: 'delete rejected' });
        const { channel, dispatched, task } = start({ [A1]: storedSession() });
        const deletion = deleteAgentWithUndoRequested(WS, A1);
        channel.put(deletion);

        await expect(deletion.promise).rejects.toThrow('delete rejected');
        const membership = membershipAfter(dispatched);
        expect(membership.agentIds).toEqual([A1]);
        expect(membership.foregroundAgentIds).toEqual([A1]);
        await stop(task);
      });

      it('through undo after a scheduled delete', async () => {
        mocks.deleteAgent.mockResolvedValue({
          success: true,
          scheduled: true,
          deleteAt: '2026-08-11T00:00:15.000Z',
        });
        mocks.cancelDelete.mockResolvedValue({ success: true, cancelled: true });
        const { channel, dispatched, task } = start({ [A1]: storedSession() });
        const deletion = deleteAgentWithUndoRequested(WS, A1, 'Agent');
        channel.put(deletion);
        await deletion.promise;
        await settle();
        expect(membershipAfter(dispatched).agentIds).toEqual([]);

        const undo = undoAgentDeletionRequested(WS, A1);
        channel.put(undo);
        await expect(undo.promise).resolves.toBe(true);
        const membership = membershipAfter(dispatched);
        expect(membership.agentIds).toEqual([A1]);
        expect(membership.foregroundAgentIds).toEqual([A1]);
        await stop(task);
      });

      it('through an immediate delete cancelled mid-flight', async () => {
        mocks.deleteAgent.mockReturnValue(new Promise(() => {}));
        const { channel, dispatched, task } = start({ [A1]: storedSession() });
        const action = deleteAgentSessionRequested(WS, A1);
        action.promise.catch(() => {});
        channel.put(action);
        await settle();
        expect(membershipAfter(dispatched).agentIds).toEqual([]);

        await stop(task);
        await expect(action.promise).rejects.toThrow();
        expect(restoresOf(dispatched)).toHaveLength(1);
        expect(membershipAfter(dispatched).agentIds).toEqual([A1]);
      });
    });
  });

  it('refetches subscription entries when immediate delete restores on daemon failure', async () => {
    mocks.deleteAgent.mockResolvedValue({ success: false, error: 'delete rejected' });
    const { channel, dispatched, task } = start();
    const action = deleteAgentSessionRequested(WS, A1);
    channel.put(action);

    await expect(action.promise).rejects.toThrow('delete rejected');
    expect(dispatched).toContainEqual(removeWatchedAgent(WS, A1));
    expect(dispatched).toContainEqual(refreshWorkspaceSubscriptionEntriesRequested(WS));
    await stop(task);
  });

  it('keeps the tombstone through the grace window and clears it afterwards', async () => {
    mocks.deleteAgent.mockResolvedValue({
      success: true,
      scheduled: true,
      deleteAt: '2026-08-11T00:00:15.000Z',
    });
    const { channel, task } = start();
    const deletion = deleteAgentWithUndoRequested(WS, A1);
    channel.put(deletion);
    await deletion.promise;

    await vi.advanceTimersByTimeAsync(15_000);
    // The daemon has committed; the tombstone still guards stale refetches.
    expect(listPendingAgentDeletions()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(AGENT_DELETION_TOMBSTONE_TTL_MS);
    expect(listPendingAgentDeletions()).toEqual([]);
    // No FE-side commit: exactly the one scheduling wire call was made.
    expect(mocks.deleteAgent).toHaveBeenCalledTimes(1);
    await stop(task);
  });

  it('does not resurrect the agent when the cancelDelete RPC itself fails', async () => {
    mocks.deleteAgent.mockResolvedValue({
      success: true,
      scheduled: true,
      deleteAt: '2026-08-11T00:00:15.000Z',
    });
    mocks.cancelDelete.mockRejectedValue(new Error('daemon offline'));
    const { channel, dispatched, task } = start();
    const deletion = deleteAgentWithUndoRequested(WS, A1);
    channel.put(deletion);
    await deletion.promise;
    await settle();

    const undo = undoAgentDeletionRequested(WS, A1);
    channel.put(undo);
    await expect(undo.promise).resolves.toBe(false);
    expect(mocks.error).toHaveBeenCalled();
    expect(dispatched).not.toContainEqual(refreshWorkspaceSubscriptionEntriesRequested(WS));
    await stop(task);
  });

  it('leaves the daemon-owned deletion pending when the saga is cancelled mid-window', async () => {
    mocks.deleteAgent.mockResolvedValue({
      success: true,
      scheduled: true,
      deleteAt: '2026-08-11T00:00:15.000Z',
    });
    const { channel, task } = start();
    const deletion = deleteAgentWithUndoRequested(WS, A1);
    channel.put(deletion);
    await deletion.promise;
    task.cancel();
    await task.toPromise();

    // No FE-side flush: the daemon owns the commit. The tombstone survives
    // teardown (detached clearer) and lifts after the grace window.
    expect(mocks.deleteAgent).toHaveBeenCalledTimes(1);
    expect(listPendingAgentDeletions()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(15_000 + AGENT_DELETION_TOMBSTONE_TTL_MS);
    expect(listPendingAgentDeletions()).toEqual([]);
  });
});
