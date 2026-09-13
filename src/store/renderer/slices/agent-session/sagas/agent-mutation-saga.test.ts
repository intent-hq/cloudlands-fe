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
} from '../../workspace-agents/workspace-agents-slice';
import { selectWorkspaceAgentIds } from '../../workspace-agents/workspace-agents-selectors';
import {
  agentProposalResolveRequested,
  agentSessionDismissQuestionsRequested,
  bulkUpsertSessions,
  updateSession,
} from '../agent-session-slice';
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

function start(sessions: Record<string, AgentSession> = { [A1]: session() }) {
  const channel = stdChannel();
  const dispatched: any[] = [];
  const task = runSaga(
    {
      channel,
      getState: () => ({ agentSessions: { byAgentId: sessions } }),
      dispatch: (action) => {
        dispatched.push(action);
        channel.put(action);
        return action;
      },
    },
    agentMutationSaga,
  );
  return { channel, dispatched, task };
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
    const upsert = dispatched.find((candidate) => candidate.type === bulkUpsertSessions.type);
    expect(upsert.payload[0][0]).toEqual(expect.objectContaining({ id: A1, retiredAt: undefined }));
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
          type: bulkUpsertSessions.type,
          payload: [
            [
              expect.objectContaining({
                activationState: 'error',
                lastActivationError: 'activation failed',
              }),
            ],
          ],
        }),
      ]),
    );
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
    expect(dispatched.filter((candidate) => candidate.type === bulkUpsertSessions.type)).toEqual([
      bulkUpsertSessions([session()]),
    ]);
    await stop(task);
  });

  it('tombstones immediate deletion before a stale conversation read can rehydrate it', async () => {
    const agentId = 'agent-immediate-stale-read';
    const staleSession = session(agentId, { taskNoteId: 'task-stale-read' });
    let resolveConversation!: (value: unknown) => void;
    mocks.get.mockResolvedValueOnce(staleSession);
    mocks.getConversation.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveConversation = resolve;
      }),
    );

    const hydration = loadChatTranscript(agentId);
    await settle();
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
    expect(dispatched.filter((candidate) => candidate.type === bulkUpsertSessions.type)).toEqual([
      bulkUpsertSessions([session()]),
    ]);

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
    expect(dispatched.filter((candidate) => candidate.type === bulkUpsertSessions.type)).toEqual([
      bulkUpsertSessions([session()]),
    ]);
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
