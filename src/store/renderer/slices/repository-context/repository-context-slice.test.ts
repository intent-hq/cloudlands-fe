import { getItems } from '@augmentcode/themis/utils/collections/collection-utils';
import {
  repositorySelectionEditStarted,
  repositorySelectionPreviewReceived,
  repositorySelectionObserved,
  repositorySelectionRetired,
  repositorySelectionEditCleared,
} from './repository-context-slice';
import { describe, expect, it } from 'vitest';
import fixture from '$shared/types/__fixtures__/repository-context.json';
import {
  RepositoryContextSchema,
  type RepositoryContextRequest,
} from '$shared/types/repository-context';
import { withLegacyPrincipal } from '../../../../test/fixtures/principal-state';
import { selectPrincipalAdmissionContext } from '../principal/principal-selectors';
import { WorkspaceId } from '$shared/types/branded-ids';
import type { StoreState } from '../../types';
import { workspaceUnmounted } from '../workspace-lifecycle/workspace-lifecycle-slice';
import {
  getRepositoryContextWorkspaceState,
  repositoryContextBound,
  repositoryContextFailed,
  repositoryContextReceived,
  repositoryContextReducer,
  repositoryContextRetired,
  repositoryContextStarted,
} from './repository-context-slice';
import {
  selectRepositoryContextForDemand,
  selectRepositoryContextRoot,
  selectRepositoryContextState,
} from './repository-context-selectors';
import type {
  RepositoryContextDemand,
  RepositoryContextDemandOwnership,
  RepositoryContextState,
} from './repository-context-types';

const context = RepositoryContextSchema.parse(fixture);
const root = context.roots[0].root;
const request: RepositoryContextRequest = {
  workspaceId: 'workspace-1',
  binding: 'upstream-A/account-A',
  requestId: 'read-1',
};
const initial = () => repositoryContextReducer(undefined, { type: '@@INIT' });
const started = () =>
  repositoryContextReducer(
    repositoryContextReducer(
      initial(),
      repositoryContextBound(request.workspaceId, request.binding),
    ),
    repositoryContextStarted(request),
  );
const ready = () =>
  repositoryContextReducer(started(), repositoryContextReceived({ request, context }));
const appState = (state: RepositoryContextState) => ({ repositoryContext: state }) as StoreState;
const displayedRoot = (state: RepositoryContextState, binding = request.binding) =>
  selectRepositoryContextRoot.select(appState(state), root, binding);

describe('scoped repository context state', () => {
  it('starts inactive without a fabricated context or RPC trigger', () => {
    expect(initial()).toEqual({ byWorkspaceId: {} });
    expect(getRepositoryContextWorkspaceState(initial(), 'missing').status).toBe('inactive');
    expect(
      selectRepositoryContextState.select(appState(initial()), request.workspaceId, null),
    ).toBeNull();
    expect(repositoryContextReducer(initial(), repositoryContextStarted(request))).toEqual(
      initial(),
    );
  });

  it('stores a ready captured root, with no active-workspace or root fallback', () => {
    const state = ready();
    expect(displayedRoot(state)).toEqual(context.roots[0]);
    expect(displayedRoot(state, 'different-context')).toBeUndefined();
    expect(
      selectRepositoryContextRoot.select(
        appState(state),
        { workspaceId: 'workspace-other', kind: 'primary' },
        request.binding,
      ),
    ).toBeUndefined();
    expect(
      selectRepositoryContextRoot.select(
        appState(state),
        { workspaceId: 'workspace-1', kind: 'registered', gitRootId: 'other' },
        request.binding,
      ),
    ).toBeUndefined();
    expect(
      repositoryContextReducer(state, repositoryContextBound(request.workspaceId, request.binding)),
    ).toBe(state);
  });

  it.each(['backend-B/account-A', 'upstream-A/account-B', 'upstream-A/account-A/generation-2'])(
    'retires the old request after replacement by %s',
    (binding) => {
      let state = repositoryContextReducer(
        started(),
        repositoryContextBound(request.workspaceId, binding),
      );
      expect(displayedRoot(state)).toBeUndefined();
      const before = state;
      state = repositoryContextReducer(state, repositoryContextReceived({ request, context }));
      expect(state).toBe(before);
      expect(repositoryContextReducer(state, repositoryContextFailed(request))).toBe(state);
      expect(
        repositoryContextReducer(
          state,
          repositoryContextRetired(request.workspaceId, request.binding),
        ),
      ).toBe(state);
    },
  );

  it('cannot restore a retired scope or an unmounted workspace from a delayed reply', () => {
    for (const action of [
      repositoryContextRetired(request.workspaceId, request.binding),
      workspaceUnmounted(WorkspaceId(request.workspaceId)),
    ]) {
      const retired = repositoryContextReducer(started(), action);
      expect(
        repositoryContextReducer(retired, repositoryContextReceived({ request, context })),
      ).toBe(retired);
      expect(retired.byWorkspaceId[request.workspaceId]).toBeUndefined();
    }
  });

  it('rejects an older request even when its response has a greater revision number', () => {
    const next = { ...request, requestId: 'read-2' };
    let state = repositoryContextReducer(started(), repositoryContextStarted(next));
    state = repositoryContextReducer(state, repositoryContextReceived({ request: next, context }));
    expect(
      repositoryContextReducer(
        state,
        repositoryContextReceived({
          request,
          context: {
            ...context,
            revision: { ...context.revision, sequence: '18446744073709551615' },
          },
        }),
      ),
    ).toBe(state);
    expect(displayedRoot(state)).toEqual(context.roots[0]);
  });

  it('does not regress the accepted revision when a later request returns an older observation', () => {
    const next = { ...request, requestId: 'read-2' };
    let state = repositoryContextReducer(ready(), repositoryContextStarted(next));
    state = repositoryContextReducer(
      state,
      repositoryContextReceived({
        request: next,
        context: { ...context, revision: { ...context.revision, sequence: '9007199254740992' } },
      }),
    );
    expect(state.byWorkspaceId[request.workspaceId].revision).toEqual(context.revision);
    expect(state.byWorkspaceId[request.workspaceId].status).toBe('unavailable');
    expect(displayedRoot(state)).toBeUndefined();
  });

  it.each(['epoch', 'daemon', 'authority', 'generation'])(
    'requires rebinding after a changed %s',
    (change) => {
      const next = { ...request, requestId: 'read-2' };
      const replacement = structuredClone(context);
      if (change === 'epoch') replacement.revision = { epoch: 'another-boot', sequence: '0' };
      if (change === 'daemon') replacement.scope.daemonId = 'daemon-B';
      if (change === 'authority') replacement.scope.authorityScopeId = 'caller-B';
      if (change === 'generation') replacement.scope.authorityGeneration = '9007199254740996';
      let state = repositoryContextReducer(ready(), repositoryContextStarted(next));
      state = repositoryContextReducer(
        state,
        repositoryContextReceived({ request: next, context: replacement }),
      );
      expect(state.byWorkspaceId[request.workspaceId]).toMatchObject({
        binding: null,
        status: 'unavailable',
        unavailableReason: 'context-changed',
      });
      expect(displayedRoot(state)).toBeUndefined();
      expect(repositoryContextReducer(state, repositoryContextStarted(request))).toBe(state);
    },
  );

  it('keeps eligible-but-failed reads unavailable, then admits a fresh same-scope recovery', () => {
    const next = { ...request, requestId: 'read-2' };
    let state = repositoryContextReducer(ready(), repositoryContextStarted(next));
    expect(displayedRoot(state)).toBeUndefined();
    state = repositoryContextReducer(state, repositoryContextFailed(next));
    expect(
      selectRepositoryContextState.select(appState(state), request.workspaceId, request.binding),
    ).toMatchObject({ status: 'unavailable', unavailableReason: 'read-failed' });
    expect(displayedRoot(state)).toBeUndefined();
    expect(
      repositoryContextReducer(state, repositoryContextReceived({ request: next, context })),
    ).toBe(state);
    const recovery = { ...request, requestId: 'recovery' };
    state = repositoryContextReducer(state, repositoryContextStarted(recovery));
    state = repositoryContextReducer(
      state,
      repositoryContextReceived({ request: recovery, context }),
    );
    expect(displayedRoot(state)).toEqual(context.roots[0]);
  });

  it('applies a later account projection only to its captured workspace and never restores the prior account', () => {
    const next = { ...request, requestId: 'read-2' };
    const replacement = structuredClone(context);
    replacement.revision.sequence = '9007199254740994';
    replacement.roots[0].targets[0].connection = {
      connectionId: 'gitlab-connection',
      accountId: 'account-B',
      connectionGeneration: '4',
    };
    let state = repositoryContextReducer(
      ready(),
      repositoryContextBound('workspace-other', 'upstream-A/other'),
    );
    state = repositoryContextReducer(state, repositoryContextStarted(next));
    state = repositoryContextReducer(
      state,
      repositoryContextReceived({ request: next, context: replacement }),
    );
    expect(displayedRoot(state)?.targets[0].connection?.accountId).toBe('account-B');
    expect(state.byWorkspaceId['workspace-other'].status).toBe('inactive');
    expect(repositoryContextReducer(state, repositoryContextReceived({ request, context }))).toBe(
      state,
    );
  });

  it('rejects a forged response root instead of relabeling it with the request workspace', () => {
    const wrong = structuredClone(context);
    wrong.roots[0].root.workspaceId = 'workspace-other';
    const state = repositoryContextReducer(
      started(),
      repositoryContextReceived({ request, context: wrong }),
    );
    expect(state.byWorkspaceId[request.workspaceId]).toMatchObject({
      binding: null,
      status: 'unavailable',
      unavailableReason: 'invalid-response',
    });
    expect(state.byWorkspaceId['workspace-other']).toBeUndefined();
  });
});

function ownedContext() {
  const state = {
    ...withLegacyPrincipal(
      {
        repositoryContext: initial(),
        connections: { windowBackendId: 'host-A' },
      },
      'guest',
    ),
  };
  const admission = selectPrincipalAdmissionContext.select(state);
  if (admission === null) throw new Error('fixture guest must have a read admission');
  const demand: RepositoryContextDemand = {
    workspaceId: request.workspaceId,
    demandId: 'view-1',
    admission,
  };
  const ownership: RepositoryContextDemandOwnership = {
    demandId: demand.demandId,
    admission,
    request,
  };
  state.repositoryContext = repositoryContextReducer(
    repositoryContextReducer(
      initial(),
      repositoryContextBound(request.workspaceId, request.binding, ownership),
    ),
    repositoryContextStarted(request),
  );
  const dispatch = (action: Parameters<typeof repositoryContextReducer>[1]) => {
    state.repositoryContext = repositoryContextReducer(state.repositoryContext, action);
  };
  return {
    state,
    demand,
    ownership,
    dispatch,
    view: () => selectRepositoryContextForDemand.select(state, demand),
  };
}

describe('typed original repository demand selection', () => {
  it('presents an explicitly owned guest read without revealing its private request or binding', () => {
    const h = ownedContext();
    expect(h.view()).toMatchObject({ status: 'loading', roots: [] });
    h.dispatch(repositoryContextReceived({ request, context }));
    expect(h.view()).toMatchObject({
      status: 'ready',
      roots: context.roots,
      scope: context.scope,
      revision: context.revision,
    });
    expect(h.view()).not.toHaveProperty('binding');
    expect(h.view()).not.toHaveProperty('pending');
    expect(h.view()).not.toHaveProperty('ownership');
  });

  it('does not adopt an unowned row, even when a caller knows its binding and attaches an owner later', () => {
    const h = ownedContext();
    h.state.repositoryContext = ready();
    expect(h.view()).toBeNull();
    h.dispatch(repositoryContextBound(request.workspaceId, request.binding, h.ownership));
    expect(h.view()).toBeNull();
    expect(displayedRoot(h.state.repositoryContext)).toEqual(context.roots[0]);
  });

  it.each(['workspace', 'binding'] as const)(
    'rejects mismatched ownership %s before installing it',
    (field) => {
      const h = ownedContext();
      const bad = {
        ...h.ownership,
        request: { ...request, [field === 'workspace' ? 'workspaceId' : 'binding']: 'other' },
      };
      expect(
        repositoryContextReducer(
          initial(),
          repositoryContextBound(request.workspaceId, request.binding, bad),
        ),
      ).toEqual(initial());
    },
  );

  it.each(['host', 'connection', 'subscription', 'principal', 'admission', 'revoked'] as const)(
    'withholds an old ready view immediately after actual %s changes',
    (change) => {
      const h = ownedContext();
      h.dispatch(repositoryContextReceived({ request, context }));
      if (change === 'host')
        h.state.connections = { ...h.state.connections, windowBackendId: 'local-B' };
      if (change === 'connection')
        h.state.daemonHealth = {
          ...h.state.daemonHealth,
          connectionGeneration: h.state.daemonHealth.connectionGeneration + 1,
        };
      if (change === 'subscription')
        h.state.workspaceEvents = {
          ...h.state.workspaceEvents,
          subscriptionGeneration: h.state.workspaceEvents.subscriptionGeneration + 1,
        };
      if (change === 'principal') {
        const snapshot = h.state.principal.snapshot;
        if (!snapshot) throw new Error('fixture principal missing');
        h.state.principal = {
          ...h.state.principal,
          snapshot: { ...snapshot, principal: { ...snapshot.principal, id: 'another-person' } },
        };
      }
      if (change === 'admission')
        h.state.principal = {
          ...h.state.principal,
          invalidation: h.state.principal.invalidation + 1,
        };
      if (change === 'revoked') h.state.principal = { ...h.state.principal, status: 'revoked' };
      expect(h.view()).toBeNull();
      expect(
        selectRepositoryContextForDemand.select(h.state, {
          ...h.demand,
          admission: selectPrincipalAdmissionContext.select(h.state),
        }),
      ).toBeNull();
    },
  );

  it('requires the original workspace, demand and non-null admission rather than the current row', () => {
    const h = ownedContext();
    h.dispatch(repositoryContextReceived({ request, context }));
    for (const demand of [
      { ...h.demand, workspaceId: 'another-workspace' },
      { ...h.demand, demandId: 'another-view' },
      { ...h.demand, admission: null },
      { ...h.demand, admission: 'local-B' },
    ])
      expect(selectRepositoryContextForDemand.select(h.state, demand)).toBeNull();
  });

  it('keeps an original failure eligible only until its own binding is retired', () => {
    const h = ownedContext();
    h.dispatch(repositoryContextFailed(request));
    expect(h.view()).toMatchObject({
      status: 'unavailable',
      unavailableReason: 'read-failed',
      roots: [],
    });
    h.dispatch(repositoryContextReceived({ request, context }));
    expect(h.view()?.status).toBe('unavailable');
    h.dispatch(repositoryContextRetired(request.workspaceId, request.binding));
    expect(h.view()).toBeNull();
  });

  it('retains unavailable ownership after rejecting invalid facts and clears it on the original retirement', () => {
    const h = ownedContext();
    const wrong = structuredClone(context);
    wrong.roots[0].root.workspaceId = 'wrong-workspace';
    h.dispatch(repositoryContextReceived({ request, context: wrong }));
    expect(h.view()).toMatchObject({
      status: 'unavailable',
      unavailableReason: 'invalid-response',
      roots: [],
    });
    expect(
      selectRepositoryContextState.select(h.state, request.workspaceId, request.binding),
    ).toBeNull();
    h.dispatch(repositoryContextRetired(request.workspaceId, request.binding));
    expect(h.view()).toBeNull();
  });

  it('does not attach a lower-level replacement request to the UI demand that owned its predecessor', () => {
    const h = ownedContext();
    const replacement = { ...request, requestId: 'another-read' };
    h.dispatch(repositoryContextStarted(replacement));
    expect(h.view()).toBeNull();
    h.dispatch(repositoryContextReceived({ request: replacement, context }));
    expect(h.view()).toBeNull();
    expect(displayedRoot(h.state.repositoryContext)).toEqual(context.roots[0]);
    h.dispatch(repositoryContextRetired(request.workspaceId, request.binding, request.requestId));
    expect(displayedRoot(h.state.repositoryContext)).toEqual(context.roots[0]);
    h.dispatch(repositoryContextRetired(request.workspaceId, request.binding));
    expect(displayedRoot(h.state.repositoryContext)).toBeUndefined();
  });

  it('preserves unknown availability, omitted account data, unresolved provenance and decimal revision', () => {
    const h = ownedContext();
    const unknown = structuredClone(context);
    unknown.roots[0].targets[0].availability = 'unknown';
    delete unknown.roots[0].targets[0].connection;
    unknown.roots[0].reviewSelection = {
      saved: { mode: 'unresolved-historical', recordId: '' },
      noRemotes: false,
      outcome: { state: 'selection-required', reason: 'unresolved-historical-choice' },
    };
    h.dispatch(repositoryContextReceived({ request, context: unknown }));
    expect(h.view()?.roots).toEqual(unknown.roots);
    expect(h.view()?.roots[0].targets[0]).not.toHaveProperty('connection');
    expect(h.view()?.roots[0].reviewSelection.saved).not.toHaveProperty('source');
    expect(h.view()?.revision?.sequence).toBe('9007199254740993');
  });
});

describe('selection operation collection independent of context rows', () => {
  const owner = {
    root: { workspaceId: 'workspace-1', kind: 'primary' as const },
    editId: 'edit',
    admission: 'host-A',
  };
  it('preserves actual receipts through read retirement and refuses another owner', () => {
    let state = repositoryContextReducer(initial(), repositorySelectionEditStarted(owner));
    const observation = {
      current: false,
      uncertain: false,
      attempt: {
        status: 'settled' as const,
        receipt: {
          result: { kind: 'failed' as const, code: 'storage-failed' as const },
          persistence: { kind: 'committed' as const, selectionRevision: '2' },
        },
      },
    };
    state = repositoryContextReducer(state, repositorySelectionObserved(owner, observation));
    const before = state.selectionEdits;
    state = repositoryContextReducer(state, repositoryContextRetired('workspace-1', 'unused'));
    expect(state.selectionEdits).toEqual(before);
    expect(
      repositoryContextReducer(
        state,
        repositorySelectionEditCleared({ ...owner, admission: 'host-B' }),
      ),
    ).toBe(state);
    state = repositoryContextReducer(state, repositorySelectionRetired(owner, 'admission'));
    expect(JSON.stringify(state)).toContain('committed');
    state = repositoryContextReducer(
      state,
      repositorySelectionObserved(owner, { current: false, attempt: null, uncertain: true }),
    );
    expect(JSON.stringify(state)).toContain('committed');
  });
  it('does not restore a retired preview and clears only its original owner', () => {
    let state = repositoryContextReducer(initial(), repositorySelectionEditStarted(owner));
    state = repositoryContextReducer(state, repositorySelectionRetired(owner, 'closed'));
    const preview = {
      root: owner.root,
      scope: { daemonId: 'A', authorityScopeId: 'op', authorityGeneration: '1' },
      snapshot: {
        root: owner.root,
        rootIncarnation: '1',
        selectionRevision: '0',
        selection: { kind: 'neverSaved' as const },
      },
      expiresAfterMs: 300000 as const,
    };
    expect(
      repositoryContextReducer(state, repositorySelectionPreviewReceived(owner, preview)),
    ).toBe(state);
    expect(
      getItems(
        repositoryContextReducer(state, repositorySelectionEditCleared(owner)).selectionEdits!,
      ),
    ).toEqual([]);
  });
});
