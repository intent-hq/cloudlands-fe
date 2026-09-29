import { afterEach, describe, expect, it, vi } from 'vitest';
import { runSaga, stdChannel, type Task } from 'redux-saga';
import { select } from 'typed-redux-saga';
import fixture from '$shared/types/__fixtures__/repository-context.json';
import {
  RepositoryContextSchema,
  type RepositoryContextRequest,
} from '$shared/types/repository-context';
import type { RepositoryContextUpdate } from '$lib/client/app-client';
import { appClient } from '$lib/client';
import { workspaceUnmounted } from '../../workspace-lifecycle/workspace-lifecycle-slice';
import {
  getRepositoryContextWorkspaceState,
  repositoryContextDemanded,
  repositoryContextDemandEnded,
  repositoryContextReducer,
} from '../repository-context-slice';
import { repositoryContextSaga } from './repository-context-saga';

vi.mock('$lib/client', () => ({
  appClient: { workspaces: { observeRepositoryContext: vi.fn() } },
}));
// The real Themis watcher and Redux saga runtime own cancellation. Only the
// principal input is controlled here; it is correlation, not a read grant.
vi.mock('../../principal/principal-selectors', () => ({
  selectPrincipalAdmissionContext: {
    select: (state: { admission: string | null }) => state.admission,
    effect: function* () {
      return yield* select((state: { admission: string | null }) => state.admission);
    },
  },
}));
const tasks: Task[] = [];
afterEach(() => {
  tasks.splice(0).forEach((task) => task.cancel());
  vi.clearAllMocks();
});
function harness(admission: string | null = 'host-A/guest') {
  let state = {
    admission,
    repositoryContext: repositoryContextReducer(undefined, { type: '@@INIT' }),
  };
  const listeners = new Set<() => void>();
  const channel = stdChannel();
  const observations: Array<{
    request: RepositoryContextRequest;
    emit(update: RepositoryContextUpdate): void;
    dispose: ReturnType<typeof vi.fn>;
  }> = [];
  vi.mocked(appClient.workspaces.observeRepositoryContext).mockImplementation(
    async (request, emit) => {
      const observation = { request, emit, dispose: vi.fn() };
      observations.push(observation);
      return observation.dispose;
    },
  );
  const dispatch = (action: { type: string; payload?: unknown }) => {
    state = {
      ...state,
      repositoryContext: repositoryContextReducer(state.repositoryContext, action as never),
    };
    listeners.forEach((listener) => listener());
    channel.put(action);
    return action;
  };
  const store = {
    getState: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  const task = runSaga(
    {
      channel,
      dispatch,
      getState: store.getState,
      context: {
        reduxStore: store,
        reportRuntimeError: (error: unknown) => {
          throw error;
        },
      },
    },
    repositoryContextSaga,
  );
  tasks.push(task);
  return {
    task,
    observations,
    dispatch,
    listeners,
    current: () => getRepositoryContextWorkspaceState(state.repositoryContext, 'workspace-1'),
    principal(value: string | null) {
      state = { ...state, admission: value };
      listeners.forEach((listener) => listener());
    },
    receive(index = 0) {
      const observation = observations[index];
      observation.emit({
        type: 'received',
        response: { request: observation.request, context: RepositoryContextSchema.parse(fixture) },
      });
    },
  };
}

describe('root repository context demand ownership', () => {
  it('admits an explicit guest-correlated demand without owner/write selection and clears a retired delivered view', async () => {
    const h = harness();
    h.dispatch(repositoryContextDemanded('workspace-1', 'view-1'));
    expect(h.observations).toHaveLength(1);
    h.receive();
    expect(h.current().status).toBe('ready');
    h.observations[0].emit({ type: 'retired', request: h.observations[0].request });
    expect(h.current().status).toBe('inactive');
    await vi.waitFor(() => expect(h.observations[0].dispose).toHaveBeenCalledOnce());
  });
  it('cancels the old demand, ignores late responses and ignores an old end action', async () => {
    const h = harness();
    h.dispatch(repositoryContextDemanded('workspace-1', 'old'));
    h.dispatch(repositoryContextDemanded('workspace-1', 'new'));
    h.receive(0);
    expect(h.current().status).toBe('loading');
    h.dispatch(repositoryContextDemandEnded('workspace-1', 'old'));
    h.receive(1);
    expect(h.current().status).toBe('ready');
    h.dispatch(repositoryContextDemandEnded('workspace-1', 'new'));
    expect(h.current().status).toBe('inactive');
    await vi.waitFor(() =>
      expect(h.observations.every((o) => o.dispose.mock.calls.length === 1)).toBe(true),
    );
  });
  it('retires on principal/backend replacement without automatically reacquiring the old demand', async () => {
    const h = harness();
    h.dispatch(repositoryContextDemanded('workspace-1', 'old'));
    h.receive();
    h.principal('local-B/owner');
    expect(h.current().status).toBe('inactive');
    h.receive();
    expect(h.current().status).toBe('inactive');
    expect(h.observations).toHaveLength(1);
    h.dispatch(repositoryContextDemanded('workspace-1', 'new'));
    expect(h.observations).toHaveLength(2);
    expect(h.observations[1].request.binding).not.toBe(h.observations[0].request.binding);
  });
  it('does not read while there is no principal correlation and does not replay that demand later', () => {
    const h = harness(null);
    h.dispatch(repositoryContextDemanded('workspace-1', 'old'));
    h.principal('host-A/guest');
    expect(h.observations).toEqual([]);
    h.dispatch(repositoryContextDemanded('workspace-1', 'new'));
    expect(h.observations).toHaveLength(1);
  });
  it('retains an unavailable state without inventing repository facts', async () => {
    const h = harness();
    h.dispatch(repositoryContextDemanded('workspace-1', 'view'));
    h.observations[0].emit({ type: 'unavailable', request: h.observations[0].request });
    expect(h.current()).toMatchObject({ status: 'unavailable', scope: null, revision: null });
    await vi.waitFor(() => expect(h.observations[0].dispose).toHaveBeenCalledOnce());
  });
  it('cancels acquisition on unmount and disposes a late observer exactly once', async () => {
    const h = harness();
    let resolve!: (close: () => void) => void;
    vi.mocked(appClient.workspaces.observeRepositoryContext).mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    h.dispatch(repositoryContextDemanded('workspace-1', 'view'));
    h.dispatch(workspaceUnmounted('workspace-1'));
    const close = vi.fn();
    resolve(close);
    await vi.waitFor(() => expect(close).toHaveBeenCalledOnce());
    expect(h.current().status).toBe('inactive');
  });
  it('removes its selector subscription and all active observers on root cancellation', async () => {
    const h = harness();
    h.dispatch(repositoryContextDemanded('workspace-1', 'view'));
    h.task.cancel();
    await h.task.toPromise();
    await vi.waitFor(() => expect(h.observations[0].dispose).toHaveBeenCalledOnce());
    expect(h.listeners.size).toBe(0);
    expect(h.current().status).toBe('inactive');
  });
});
