import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentSession, QueuedMessage, Workspace } from '$shared/types';
import { store as appStore } from '$store/renderer/store';
import { createAdmittedLegacyPrincipal } from '../../test/fixtures/admitted-legacy-principal';
import { setWorkspaceEntity } from '$store/renderer/slices/workspace/workspace-slice';
import { bulkUpsertSessions } from '$store/renderer/slices/agent-session/agent-session-slice';
import {
  pendingLifecycleObserved,
  pendingSubmissionSettled,
} from '$store/renderer/slices/pending-submissions/pending-submissions-slice';
import { admitAgentSubmission } from '$store/renderer/slices/pending-submissions/pending-submissions-admission';
import { selectPendingSubmissionDisplay } from '$store/renderer/slices/pending-submissions/pending-submissions-selectors';
import { routeDaemonEventsNotification } from '$features/events/daemon-events-bridge.client';
import {
  hydrateAgentQueue,
  __resetAgentQueueReadServiceForTests,
} from './agent-queue-read-service';
import { beginSubmissionRead } from './submission-evidence';
import { chatReadSaga } from '$store/renderer/slices/chat-state/sagas/chat-read-saga';

const wire = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('$lib/client/live/backend-transport', () => ({
  backendRequest: wire.request,
  onBackendReconnected: () => () => {},
  onBackendNotification: () => () => {},
}));
vi.mock('svelte', async (importOriginal) => ({
  ...(await importOriginal<typeof import('svelte')>()),
  getContext: () => undefined,
}));
let dispose: () => void;
beforeEach(() => {
  dispose = appStore.init(createAdmittedLegacyPrincipal());
  appStore.dispatch(setWorkspaceEntity({ id: 'evidence-workspace', myRole: 'owner' } as Workspace));
  appStore.dispatch(
    bulkUpsertSessions([
      {
        id: 'agent-evidence',
        workspaceId: 'evidence-workspace',
        messages: [],
      } as unknown as AgentSession,
    ]),
  );
  wire.request
    .mockReset()
    .mockImplementation(async (method) =>
      method === 'agent.get' ? { agent: null } : { queue: [] },
    );
});
afterEach(() => {
  dispose();
  __resetAgentQueueReadServiceForTests();
});

function fixture() {
  const accepted = admitAgentSubmission(appStore, 'agent-evidence', 'evidence-workspace', 1, {
    content: 'pending content',
    destination: 'conversation',
  })!;
  const row: QueuedMessage = {
    id: accepted.submission.id,
    content: 'pending content',
    queuedAt: new Date().toISOString(),
    position: 0,
    turnId: 'turn-evidence',
    submissionIds: [accepted.submission.id],
    mergeEligible: true,
    author: {
      principalId: accepted.scope.principalId,
      login: null,
      displayName: null,
      avatarUrl: null,
    },
  };
  return {
    ...accepted,
    row,
    display: () => selectPendingSubmissionDisplay.select(appStore.state, accepted.scope),
  };
}
function event(type: string, data: Record<string, unknown>) {
  routeDaemonEventsNotification('events.event', {
    id: crypto.randomUUID(),
    type,
    workspaceId: 'evidence-workspace',
    timestamp: new Date().toISOString(),
    data: { agentId: 'agent-evidence', ...data },
  });
}

describe('authoritative submission integration', () => {
  it('uses settled correlated full queue snapshots with zero recovery reads and enabled controls', async () => {
    vi.useFakeTimers();
    const stop = appStore.runSaga(chatReadSaga);
    try {
      const accepted = fixture();
      appStore.dispatch(
        pendingSubmissionSettled(
          accepted.scope,
          accepted.submission.id,
          'accepted',
          Date.now(),
          accepted.row,
          true,
        ),
      );
      wire.request.mockImplementation(async (method) => {
        if (method === 'agent.getQueue') return { queue: [accepted.row] };
        if (method === 'agent.getConversation')
          return { messages: [], totalMessages: 0, truncated: false };
        throw new Error(`Unexpected request: ${method}`);
      });
      event('agent:queue:updated', { queue: [accepted.row] });
      await vi.runAllTimersAsync();
      expect(
        accepted.display().queue.map((row) => [row.confirmedId, row.content, row.blocksMutations]),
      ).toEqual([[accepted.row.id, 'pending content', false]]);
      expect(wire.request.mock.calls.map(([method]) => method)).toEqual([]);
      event('agent:queue:updated', { queue: [{ ...accepted.row, content: 'updated content' }] });
      event('agent:queue:updated', { queue: [{ ...accepted.row, content: 'updated content' }] });
      await vi.runAllTimersAsync();
      expect(accepted.display().queue.map((row) => [row.content, row.blocksMutations])).toEqual([
        ['updated content', false],
      ]);
      event('agent:queue:updated', { queue: [] });
      await vi.runAllTimersAsync();
      expect(accepted.display().queue).toEqual([]);
      expect(wire.request).not.toHaveBeenCalled();
    } finally {
      stop();
      vi.useRealTimers();
    }
  });

  it('recovers absent accepted content from history without rereading the complete queue', async () => {
    vi.useFakeTimers();
    const stop = appStore.runSaga(chatReadSaga);
    try {
      const accepted = fixture();
      appStore.dispatch(
        pendingSubmissionSettled(
          accepted.scope,
          accepted.submission.id,
          'accepted',
          Date.now(),
          accepted.row,
          true,
        ),
      );
      let resolveHistory!: (value: unknown) => void;
      wire.request.mockImplementation((method) => {
        if (method === 'agent.getConversation')
          return new Promise((resolve) => {
            resolveHistory = resolve;
          });
        throw new Error(`Unexpected request: ${method}`);
      });
      event('agent:queue:updated', { queue: [] });
      await vi.runAllTimersAsync();
      expect(accepted.display().queue.map((row) => [row.content, row.blocksMutations])).toEqual([
        ['pending content', true],
      ]);
      expect(wire.request.mock.calls.map(([method]) => method)).toEqual(['agent.getConversation']);
      expect(wire.request).toHaveBeenCalledWith('agent.getConversation', {
        agentId: 'agent-evidence',
        workspaceId: 'evidence-workspace',
        limit: 5,
        projection: 'slim',
      });
      resolveHistory({
        messages: [
          {
            id: accepted.row.id,
            role: 'user',
            timestamp: new Date().toISOString(),
            contentBlocks: [{ type: 'text', text: accepted.row.content }],
            author: accepted.row.author,
            metadata: { submissionIds: accepted.row.submissionIds },
          },
        ],
        totalMessages: 1,
        truncated: false,
      });
      await vi.runAllTimersAsync();
      expect(accepted.display().queue).toEqual([]);
      expect(accepted.display().conversation).toEqual([]);
      expect(appStore.state.agentSessions.byAgentId['agent-evidence'].messages[0].id).toBe(
        accepted.row.id,
      );
      expect(wire.request).toHaveBeenCalledTimes(1);
    } finally {
      stop();
      vi.useRealTimers();
    }
  });

  it.each(['updated', 'duplicate', 'empty'] as const)(
    'does not reread after a complete %s queue push supersedes a held queue read',
    async (variant) => {
      const accepted = fixture();
      event('agent:queue:updated', { queue: [accepted.row] });
      appStore.dispatch(
        pendingSubmissionSettled(accepted.scope, accepted.submission.id, 'accepted', Date.now()),
      );
      let oldReply!: (value: unknown) => void;
      wire.request.mockImplementation(async () => ({ queue: [accepted.row] }));
      wire.request.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            oldReply = resolve;
          }),
      );
      const hydration = hydrateAgentQueue('agent-evidence', 'evidence-workspace');
      const pushed =
        variant === 'empty'
          ? []
          : [
              {
                ...accepted.row,
                content: variant === 'updated' ? 'new pushed content' : accepted.row.content,
              },
            ];
      event('agent:queue:updated', { queue: pushed });
      oldReply({ queue: [accepted.row] });
      await hydration;
      expect(wire.request.mock.calls).toEqual([
        ['agent.getQueue', { agentId: 'agent-evidence', workspaceId: 'evidence-workspace' }],
      ]);
      expect(
        accepted.display().queue.map((row) => [row.confirmedId, row.content, row.blocksMutations]),
      ).toEqual(pushed.map((row) => [row.id, row.content, false]));
      expect(appStore.state.agentQueue.byAgentId['agent-evidence'].isHydrating).toBe(false);
    },
  );

  it.each(['explicit hydrate', 'lifecycle invalidation'] as const)(
    'retains a trailing queue read for %s after a complete push',
    async (reason) => {
      const accepted = fixture();
      event('agent:queue:updated', { queue: [accepted.row] });
      appStore.dispatch(
        pendingSubmissionSettled(accepted.scope, accepted.submission.id, 'accepted', Date.now()),
      );
      let oldReply!: (value: unknown) => void;
      const recovered = { ...accepted.row, content: 'fresh recovery content' };
      wire.request.mockImplementation(async () => ({ queue: [recovered] }));
      wire.request.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            oldReply = resolve;
          }),
      );
      const hydration = hydrateAgentQueue('agent-evidence', 'evidence-workspace');
      event('agent:queue:updated', { queue: [accepted.row] });
      if (reason === 'explicit hydrate')
        void hydrateAgentQueue('agent-evidence', 'evidence-workspace');
      else appStore.dispatch(pendingLifecycleObserved(accepted.scope, false));
      oldReply({ queue: [] });
      await hydration;
      expect(wire.request.mock.calls).toEqual([
        ['agent.getQueue', { agentId: 'agent-evidence', workspaceId: 'evidence-workspace' }],
        ['agent.getQueue', { agentId: 'agent-evidence', workspaceId: 'evidence-workspace' }],
      ]);
      expect(accepted.display().queue[0].content).toBe('fresh recovery content');
      expect(accepted.display().queue[0].confirmedId).toBe(accepted.row.id);
      expect(appStore.state.agentQueue.byAgentId['agent-evidence'].isHydrating).toBe(false);
    },
  );

  it('uses real queue, processing and lean message events to fence a late queued ACK', () => {
    const accepted = fixture();
    event('agent:queue:updated', { queue: [accepted.row] });
    expect(accepted.display().conversation).toEqual([]);
    expect(accepted.display().queue.map((row) => row.content)).toEqual(['pending content']);
    event('agent:queue:processing', {
      messageId: accepted.row.id,
      turnId: accepted.row.turnId,
      queuedMessages: [{ ...accepted.row, mergeEligible: false }],
    });
    event('agent:queue:updated', { queue: [] });
    expect(accepted.display().processing.map((row) => row.content)).toEqual(['pending content']);
    event('agent:message', {
      role: 'user',
      messageId: accepted.row.id,
      submissionIds: accepted.row.submissionIds,
      author: accepted.row.author,
    });
    appStore.dispatch(
      pendingSubmissionSettled(
        accepted.scope,
        accepted.submission.id,
        'accepted',
        Date.now(),
        accepted.row,
        true,
      ),
    );
    expect(accepted.display().queue).toEqual([]);
    expect(accepted.display().processing.map((row) => row.content)).toEqual(['pending content']);
  });

  it('retains direct pending text between the lean delivery event and transcript publication', () => {
    const accepted = fixture();
    const read = beginSubmissionRead('agent-evidence', 'evidence-workspace', 'history');
    event('agent:message', {
      role: 'user',
      messageId: accepted.row.id,
      submissionIds: accepted.row.submissionIds,
      author: accepted.row.author,
    });
    expect(read.isCurrent()).toBe(false);
    appStore.dispatch(
      pendingSubmissionSettled(
        accepted.scope,
        accepted.submission.id,
        'accepted',
        Date.now(),
        accepted.row,
        true,
      ),
    );
    expect(accepted.display().conversation.map((row) => row.content)).toEqual(['pending content']);
    expect(accepted.display().queue).toEqual([]);
  });

  it('withholds an obsolete getQueue result from the authoritative mirror and performs a trailing read', async () => {
    const accepted = fixture();
    let oldReply!: (value: unknown) => void;
    let currentReply!: (value: unknown) => void;
    wire.request
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            oldReply = resolve;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            currentReply = resolve;
          }),
      );
    const hydration = hydrateAgentQueue('agent-evidence', 'evidence-workspace');
    expect(wire.request).toHaveBeenCalledWith('agent.getQueue', {
      agentId: 'agent-evidence',
      workspaceId: 'evidence-workspace',
    });
    appStore.dispatch(
      pendingSubmissionSettled(
        accepted.scope,
        accepted.submission.id,
        'accepted',
        Date.now(),
        accepted.row,
        true,
      ),
    );
    oldReply({ queue: [] });
    await vi.waitFor(() => expect(currentReply).toBeTypeOf('function'));
    expect(accepted.display().queue.map((row) => row.content)).toEqual(['pending content']);
    currentReply({ queue: [accepted.row] });
    await hydration;
    expect(accepted.display().queue).toHaveLength(1);
    expect(accepted.display().queue[0].confirmedId).toBe(accepted.row.id);
  });
});
