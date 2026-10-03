import { afterEach, describe, expect, it, vi } from 'vitest';
import { StreamingStore } from '@themislib/themis/streaming-store';
import type { Workspace } from '$shared/types';
import { createAdmittedLegacyPrincipal } from '../../../../test/fixtures/admitted-legacy-principal';
import { reducers } from '../../reducer';
import { admitAgentSubmission } from './pending-submissions-admission';
import { selectPendingSubmissionDisplay } from './pending-submissions-selectors';
import {
  bulkUpdateWorkspaceEntities,
  updateWorkspaceEntity,
  removeWorkspaceEntity,
  setWorkspaceEntity,
} from '../workspace/workspace-slice';
import {
  pendingReadStarted,
  pendingReadCompleted,
  pendingSubmissionSettled,
} from './pending-submissions-slice';

vi.mock('$lib/client/live/backend-transport', () => ({
  onBackendReconnected: () => () => undefined,
}));
import { submissionReadIsCurrent } from './pending-submissions-model';

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
  it.each(['upsert', 'bulk'] as const)(
    'clears capability-only participation loss via %s and never revives old scope, reads or callbacks',
    (kind) => {
      const store = fixture();
      store.dispatch(
        setWorkspaceEntity({ id: 'workspace', myRole: null, canManage: true } as Workspace),
      );
      const old = admitAgentSubmission(store, `capability-${kind}`, 'workspace', 1, {
        content: 'old private text',
        destination: 'conversation',
      })!;
      const token = { scope: old.scope, id: 'same-read-id', kind: 'queue' as const, generation: 0 };
      store.dispatch(pendingReadStarted(token));
      const change = (canManage: boolean) =>
        store.dispatch(
          kind === 'bulk'
            ? bulkUpdateWorkspaceEntities([updateWorkspaceEntity('workspace', { canManage })])
            : setWorkspaceEntity({ id: 'workspace', canManage } as Workspace),
        );
      change(false);
      expect(old.isCurrent()).toBe(false);
      expect(selectPendingSubmissionDisplay.select(store.state, old.scope).conversation).toEqual(
        [],
      );
      expect(store.state.pendingSubmissions.byAgentId[old.scope.agentId]).toBeUndefined();
      change(true);
      expect(old.isCurrent()).toBe(false);
      const fresh = admitAgentSubmission(store, old.scope.agentId, 'workspace', 1, {
        content: 'new participation',
        destination: 'conversation',
      })!;
      expect(fresh).not.toBeNull();
      expect(fresh.scope).not.toEqual(old.scope);
      store.dispatch(pendingReadStarted({ ...token, scope: fresh.scope }));
      expect(
        submissionReadIsCurrent(store.state.pendingSubmissions.byAgentId[old.scope.agentId], token),
      ).toBe(false);
      store.dispatch(pendingReadCompleted(token, [], 9));
      store.dispatch(pendingSubmissionSettled(old.scope, old.submission.id, 'accepted', 10));
      expect(old.isCurrent()).toBe(false);
      expect(selectPendingSubmissionDisplay.select(store.state, old.scope).conversation).toEqual(
        [],
      );
      expect(
        selectPendingSubmissionDisplay
          .select(store.state, fresh.scope)
          .conversation.map((row) => row.content),
      ).toEqual(['new participation']);
    },
  );

  it.each(['upsert', 'bulk'] as const)(
    'preserves collaborator participation when only management is removed via %s',
    (kind) => {
      const store = fixture();
      store.dispatch(
        setWorkspaceEntity({
          id: 'workspace',
          myRole: 'collaborator',
          canManage: true,
        } as Workspace),
      );
      const accepted = admitAgentSubmission(store, `collaborator-${kind}`, 'workspace', 1, {
        content: 'collaborator text',
        destination: 'conversation',
      })!;
      store.dispatch(
        kind === 'bulk'
          ? bulkUpdateWorkspaceEntities([updateWorkspaceEntity('workspace', { canManage: false })])
          : setWorkspaceEntity({ id: 'workspace', canManage: false } as Workspace),
      );
      expect(accepted.isCurrent()).toBe(true);
      expect(
        selectPendingSubmissionDisplay
          .select(store.state, accepted.scope)
          .conversation.map((row) => row.content),
      ).toEqual(['collaborator text']);
    },
  );

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
