import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentSession, QueuedMessage, Workspace } from '$shared/types';
import { store as appStore } from '$store/renderer/store';
import { createAdmittedLegacyPrincipal } from '../../test/fixtures/admitted-legacy-principal';
import { setWorkspaceEntity } from '$store/renderer/slices/workspace/workspace-slice';
import { bulkUpsertSessions } from '$store/renderer/slices/agent-session/agent-session-slice';
import { pendingSubmissionSettled } from '$store/renderer/slices/pending-submissions/pending-submissions-slice';
import { admitAgentSubmission } from '$store/renderer/slices/pending-submissions/pending-submissions-admission';
import { selectPendingSubmissionDisplay } from '$store/renderer/slices/pending-submissions/pending-submissions-selectors';
import { routeDaemonEventsNotification } from '$features/events/daemon-events-bridge.client';
import {
  hydrateAgentQueue,
  __resetAgentQueueReadServiceForTests,
} from './agent-queue-read-service';
import { beginSubmissionRead } from './submission-evidence';

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
