import { afterEach, describe, expect, it, vi } from 'vitest';
import { runSaga, stdChannel, type Task } from 'redux-saga';
import { select } from 'typed-redux-saga';
import type { StoreState } from '../../../types';
import type { RepositoryContextDemand } from '../repository-context-types';
import { selectRepositoryContextForDemand } from '../repository-context-selectors';
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
  repositoryContextBound,
  repositoryContextFailed,
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
  let onAction: ((action: { type: string; payload?: unknown }) => void) | undefined;
  const dispatch = (action: { type: string; payload?: unknown }) => {
    state = {
      ...state,
      repositoryContext: repositoryContextReducer(state.repositoryContext, action as never),
    };
    listeners.forEach((listener) => listener());
    channel.put(action);
    onAction?.(action);
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
    onAction(value: typeof onAction) {
      onAction = value;
    },
    view: (demand: RepositoryContextDemand) =>
      selectRepositoryContextForDemand.select(state as unknown as StoreState, demand),
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

describe('unavailable demand lifetime', () => {
  it.each(['close', 'admission', 'root cancellation', 'unmount'] as const)(
    'clears its failed read on %s without reacquiring',
    async (ending) => {
      const h = harness();
      h.dispatch(repositoryContextDemanded('workspace-1', 'failed-view'));
      h.observations[0].emit({ type: 'unavailable', request: h.observations[0].request });
      expect(h.current().status).toBe('unavailable');
      await vi.waitFor(() => expect(h.observations[0].dispose).toHaveBeenCalledOnce());
      if (ending === 'close')
        h.dispatch(repositoryContextDemandEnded('workspace-1', 'failed-view'));
      else if (ending === 'admission') h.principal('host-A/new-admission');
      else if (ending === 'root cancellation') h.task.cancel();
      else h.dispatch(workspaceUnmounted('workspace-1'));
      expect(h.current().status).toBe('inactive');
      expect(h.observations).toHaveLength(1);
      expect(h.observations[0].dispose).toHaveBeenCalledOnce();
    },
  );
});

function demand(
  demandId = 'view-1',
  admission: string | null = 'host-A/guest',
): RepositoryContextDemand {
  return { workspaceId: 'workspace-1', demandId, admission };
}
const begin = (d: RepositoryContextDemand) =>
  repositoryContextDemanded(d.workspaceId, d.demandId, d.admission);
const end = (d: RepositoryContextDemand) =>
  repositoryContextDemandEnded(d.workspaceId, d.demandId, d.admission);

describe('typed demand owner in the real Themis lifetime', () => {
  it('acknowledges only its captured demand, presents the result, and removes it on close', async () => {
    const h = harness();
    const d = demand();
    expect(h.view(d)).toBeNull();
    h.dispatch(begin(d));
    expect(h.view(d)?.status).toBe('loading');
    expect(h.view(demand('another-view'))).toBeNull();
    h.receive();
    expect(h.view(d)?.status).toBe('ready');
    expect(h.view(d)).not.toHaveProperty('binding');
    h.dispatch(end(d));
    expect(h.view(d)).toBeNull();
    h.receive();
    expect(h.view(d)).toBeNull();
    await vi.waitFor(() => expect(h.observations[0].dispose).toHaveBeenCalledOnce());
  });

  it('cannot end, adopt or replace a new host demand with equal workspace/demand IDs and old admission', async () => {
    const h = harness();
    const old = demand();
    h.dispatch(begin(old));
    h.receive();
    h.principal('local-B/owner');
    const current = demand(old.demandId, 'local-B/owner');
    h.dispatch(begin(current));
    h.receive(1);
    expect(h.view(current)?.status).toBe('ready');
    expect(h.view(old)).toBeNull();
    h.dispatch(end(old));
    h.dispatch(begin(old));
    h.receive(0);
    expect(h.observations).toHaveLength(2);
    expect(h.view(current)?.status).toBe('ready');
    h.dispatch(end(current));
    await vi.waitFor(() =>
      expect(h.observations.every((o) => o.dispose.mock.calls.length === 1)).toBe(true),
    );
  });

  it('refuses an explicitly unadmitted demand and never replays it when admission arrives', () => {
    const h = harness(null);
    const absent = demand('before-admission', null);
    h.dispatch(begin(absent));
    h.principal('host-A/guest');
    h.dispatch(begin(absent));
    expect(h.view(absent)).toBeNull();
    expect(h.observations).toHaveLength(0);
    h.dispatch(begin(demand('fresh')));
    expect(h.observations).toHaveLength(1);
  });

  it('keeps legacy end actions from cancelling an explicitly owned demand', () => {
    const h = harness();
    const d = demand();
    h.dispatch(begin(d));
    h.dispatch(repositoryContextDemandEnded(d.workspaceId, d.demandId));
    h.receive();
    expect(h.view(d)?.status).toBe('ready');
    h.dispatch(end(d));
    expect(h.view(d)).toBeNull();
  });

  it('supersedes an acquisition and disposes its eventual handle without touching the replacement', async () => {
    const h = harness();
    const old = demand('old');
    const current = demand('new');
    let finish!: (dispose: () => void) => void;
    let lateEmit!: (update: RepositoryContextUpdate) => void;
    let lateRequest!: RepositoryContextRequest;
    vi.mocked(appClient.workspaces.observeRepositoryContext).mockImplementationOnce(
      (request, emit) => {
        lateEmit = emit;
        lateRequest = request;
        return new Promise((resolve) => {
          finish = resolve;
        });
      },
    );
    h.dispatch(begin(old));
    h.dispatch(begin(current));
    h.receive();
    const dispose = vi.fn();
    finish(dispose);
    await vi.waitFor(() => expect(dispose).toHaveBeenCalledOnce());
    lateEmit({
      type: 'received',
      response: { request: lateRequest, context: RepositoryContextSchema.parse(fixture) },
    });
    lateEmit({ type: 'unavailable', request: lateRequest });
    h.dispatch(end(old));
    expect(h.view(old)).toBeNull();
    expect(h.view(current)?.status).toBe('ready');
    expect(h.observations[0].dispose).not.toHaveBeenCalled();
    h.dispatch(end(current));
    await vi.waitFor(() => expect(h.observations[0].dispose).toHaveBeenCalledOnce());
  });

  it('cannot turn a replacement into unavailable when the old acquisition rejects late', async () => {
    const h = harness();
    let reject!: (error: Error) => void;
    vi.mocked(appClient.workspaces.observeRepositoryContext).mockImplementationOnce(
      () =>
        new Promise((_resolve, fail) => {
          reject = fail;
        }),
    );
    h.dispatch(begin(demand('old')));
    const current = demand('new');
    h.dispatch(begin(current));
    h.receive();
    reject(new Error('old acquisition failed'));
    await Promise.resolve();
    expect(h.view(current)?.status).toBe('ready');
  });

  it.each(['retirement', 'unmount', 'admission'] as const)(
    'clears delivered ownership on %s without replay',
    async (ending) => {
      const h = harness();
      const d = demand();
      h.dispatch(begin(d));
      h.receive();
      if (ending === 'retirement')
        h.observations[0].emit({ type: 'retired', request: h.observations[0].request });
      if (ending === 'unmount') h.dispatch(workspaceUnmounted(d.workspaceId));
      if (ending === 'admission') h.principal('host-A/guest-new-admission');
      expect(h.view(d)).toBeNull();
      h.receive();
      expect(h.view(d)).toBeNull();
      expect(h.observations).toHaveLength(1);
      await vi.waitFor(() => expect(h.observations[0].dispose).toHaveBeenCalledOnce());
    },
  );

  it('honors a close during the bound acknowledgement before acquiring any observation', () => {
    const h = harness();
    const d = demand();
    h.onAction((action) => {
      if (action.type === repositoryContextBound.type) {
        h.onAction(undefined);
        h.dispatch(end(d));
      }
    });
    h.dispatch(begin(d));
    expect(h.view(d)).toBeNull();
    expect(h.observations).toHaveLength(0);
  });

  it('preserves the replacement when a failure subscriber starts a new explicit demand', async () => {
    const h = harness();
    const old = demand('old');
    const current = demand('new');
    h.dispatch(begin(old));
    h.onAction((action) => {
      if (action.type === repositoryContextFailed.type) {
        h.onAction(undefined);
        h.dispatch(begin(current));
      }
    });
    h.observations[0].emit({ type: 'unavailable', request: h.observations[0].request });
    expect(h.view(old)).toBeNull();
    expect(h.view(current)?.status).toBe('loading');
    h.receive(1);
    h.dispatch(end(old));
    expect(h.view(current)?.status).toBe('ready');
    await vi.waitFor(() => expect(h.observations[0].dispose).toHaveBeenCalledOnce());
  });
});
