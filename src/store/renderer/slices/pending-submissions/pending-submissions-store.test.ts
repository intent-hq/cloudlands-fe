import { afterEach, describe, expect, it, vi } from 'vitest';
import { StreamingStore } from '@themislib/themis/streaming-store';
import type { Workspace } from '$shared/types';
import { createAdmittedLegacyPrincipal } from '../../../../test/fixtures/admitted-legacy-principal';
import { reducers } from '../../reducer';
import { admitAgentSubmission } from './pending-submissions-admission';
import { selectPendingSubmissionDisplay } from './pending-submissions-selectors';
import { removeWorkspaceEntity, setWorkspaceEntity } from '../workspace/workspace-slice';
import { pendingSubmissionSettled } from './pending-submissions-slice';

vi.mock('$lib/client/live/backend-transport', () => ({
  onBackendReconnected: () => () => undefined,
}));
const disposers: (() => void)[] = [];
afterEach(() => {
  disposers.splice(0).forEach((dispose) => dispose());
});
function fixture() {
  const store = new StreamingStore(reducers, []);
  disposers.push(store.init(createAdmittedLegacyPrincipal()));
  store.dispatch(setWorkspaceEntity({ id: 'workspace', myRole: 'owner' } as Workspace));
  return store;
}

describe('pending submissions with the production renderer store', () => {
  it('shows early pending text without modifying transcript, counts, unread or confirmed queue', async () => {
    const store = fixture();
    const before = {
      history: store.state.chatState,
      sessions: store.state.agentSessions,
      unread: store.state.unreadTracking,
      queue: store.state.agentQueue,
    };
    let resolve!: () => void;
    const preparation = new Promise<void>((done) => {
      resolve = done;
    });
    const accepted = admitAgentSubmission(store, 'agent', 'workspace', 1, {
      content: 'early',
      destination: 'conversation',
    })!;
    expect(accepted).not.toBeNull();
    expect(
      selectPendingSubmissionDisplay
        .select(store.state, accepted.scope)
        .conversation.map((s) => s.content),
    ).toEqual(['early']);
    expect(store.state.chatState).toBe(before.history);
    expect(store.state.agentSessions).toBe(before.sessions);
    expect(store.state.unreadTracking).toBe(before.unread);
    expect(store.state.agentQueue).toBe(before.queue);
    resolve();
    await preparation;
  });

  it('withholds text and callbacks after access loss and does not revive them on readmission', () => {
    const store = fixture();
    const old = admitAgentSubmission(store, 'agent', 'workspace', 1, {
      content: 'private',
      destination: 'conversation',
    })!;
    store.dispatch(removeWorkspaceEntity('workspace'));
    expect(old.isCurrent()).toBe(false);
    expect(selectPendingSubmissionDisplay.select(store.state, old.scope).conversation).toEqual([]);
    expect(
      admitAgentSubmission(store, 'agent', 'workspace', 1, {
        content: 'denied',
        destination: 'conversation',
      }),
    ).toBeNull();
    store.dispatch(setWorkspaceEntity({ id: 'workspace', myRole: 'collaborator' } as Workspace));
    const fresh = admitAgentSubmission(store, 'agent', 'workspace', 1, {
      content: 'new lifetime',
      destination: 'conversation',
    })!;
    store.dispatch(pendingSubmissionSettled(old.scope, old.submission.id, 'accepted', 1));
    expect(
      selectPendingSubmissionDisplay
        .select(store.state, fresh.scope)
        .conversation.map((s) => s.content),
    ).toEqual(['new lifetime']);
  });
});
