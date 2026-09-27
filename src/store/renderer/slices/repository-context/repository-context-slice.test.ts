import { describe, expect, it } from 'vitest';
import fixture from '$shared/types/__fixtures__/repository-context.json';
import {
  RepositoryContextSchema,
  type RepositoryContextRequest,
} from '$shared/types/repository-context';
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
  selectRepositoryContextRoot,
  selectRepositoryContextState,
} from './repository-context-selectors';
import type { RepositoryContextState } from './repository-context-types';

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
