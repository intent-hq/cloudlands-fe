import { afterEach, describe, expect, it, vi } from 'vitest';
import { ReactStore } from '@themislib/themis/react-store';
import type { Task } from 'redux-saga';
import { fork, getContext, select, setContext } from 'typed-redux-saga';
import type { StoreDispatch, StoreMiddleware } from '@themislib/themis/types';
import { getItems } from '@themislib/themis/utils/collections/collection-utils';
import { AgentStatus, type AgentSession } from '$shared/types';
import { IPC_CHANNELS } from '$shared/ipc-registry';
import { connectionsListReceived, connectionsReducer } from '../../connections/connections-slice';
import {
  connectionStatusChanged,
  daemonHealthReducer,
} from '../../daemon-health/daemon-health-slice';
import {
  daemonEventsSubscribed,
  workspaceEventsReducer,
} from '../../workspace-events/workspace-events-slice';
import {
  getPrincipalActionContext,
  getPrincipalConnectionContext,
} from '../../principal/principal-projections';
import {
  principalContextChanged,
  principalIdentityChanged,
  principalReceived,
  principalReducer,
} from '../../principal/principal-slice';
import { userPreferencesReducer } from '../../user-preferences/user-preferences-slice';
import {
  agentSessionReducer,
  bulkUpsertSessions,
  markAgentDetailHydrated,
  upsertSession,
} from '../../agent-session/agent-session-slice';
import { workspaceUnmounted } from '../../workspace-lifecycle/workspace-lifecycle-slice';
import { ensureAgentSessionLoaded, workspaceAgentsReducer } from '../workspace-agents-slice';
import {
  closeTabsByAgentId,
  destroyTabsByOwnerAgent,
  openHiddenTab,
  openTab,
  panelLayoutReducer,
  pruneRecentlyClosed,
} from '../../panel-layout/panel-layout-slice';
import { clearPendingAgentDeletions } from '../../../../../features/agent/utils/pending-agent-deletions';
import { createAgentReadSaga } from './agent-read-saga-factory';
import { createDeletedAgentCleanup } from './deleted-agent-cleanup-factory';

const logs = vi.hoisted(() => ({ error: vi.fn(), warn: vi.fn(), debug: vi.fn(), info: vi.fn() }));
vi.mock('$lib/utils/client-logger', () => ({ createLogger: () => logs, logger: logs }));

const WS = 'read-workspace';
const AGENT = 'read-agent';
const notFound = { rpcCode: -32602, data: { code: 'not-found' }, message: 'Agent not found' };
const reducers = {
  connections: connectionsReducer,
  daemonHealth: daemonHealthReducer,
  workspaceEvents: workspaceEventsReducer,
  principal: principalReducer,
  userPreferences: userPreferencesReducer,
  agentSessions: agentSessionReducer,
  workspaceAgents: workspaceAgentsReducer,
  panelLayout: panelLayoutReducer,
};
type State = { [K in keyof typeof reducers]: ReturnType<(typeof reducers)[K]> };
type TestReduxStore = {
  getState: () => State;
  dispatch: StoreDispatch;
  subscribe: (listener: () => void) => () => void;
};
const principalSelector = {
  select: getPrincipalActionContext,
  *effect() {
    return yield* select(getPrincipalActionContext);
  },
};
const sessionSelector = {
  *effect(agentId: string) {
    return yield* select((state: State) => state.agentSessions.byAgentId[agentId]);
  },
};
const stops: (() => void)[] = [];
afterEach(() => {
  stops.splice(0).forEach((stop) => stop());
  clearPendingAgentDeletions();
  vi.clearAllMocks();
});
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function session(id = AGENT, workspaceId = WS): AgentSession {
  return {
    id,
    workspaceId,
    backendSessionId: null,
    name: 'Loaded',
    status: AgentStatus.Active,
    messages: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  } as AgentSession;
}

function fixture(source = false) {
  const actions: { type: string }[] = [];
  const record: StoreMiddleware = () => (next) => (action) => {
    actions.push(action as { type: string });
    return next(action);
  };
  // Own a real isolated Redux store through the installed public Store API.
  const isolated = new ReactStore(reducers, record);
  const dispose = isolated.init();
  let store!: TestReduxStore;
  const releaseContext = isolated.runSaga(function* captureTestReduxContext() {
    store = yield* getContext<TestReduxStore>('reduxStore');
  });
  releaseContext();
  let held = false;
  const pending = new Set<() => void>();
  let subscriptions = 0;
  let onSubscribe: (() => void) | undefined;
  const reduxStore = {
    ...store,
    subscribe(listener: () => void) {
      subscriptions++;
      // Redux still runs reducers and notifies its subscribers before saga action
      // delivery. Only this consumer's observation is held/coalesced, modeling
      // a delayed selector notification without replacing the authority source.
      const unsubscribe = store.subscribe(() => {
        if (held) pending.add(listener);
        else listener();
      });
      const setup = onSubscribe;
      onSubscribe = undefined;
      setup?.();
      return () => {
        subscriptions--;
        pending.delete(listener);
        unsubscribe();
      };
    },
  };
  const read = vi
    .fn<(id: string, ws?: string) => Promise<AgentSession | null>>()
    .mockImplementation(async (id, ws) => session(id, ws));
  const invoke = vi.fn().mockResolvedValue({ success: true, tabIds: ['hidden'] });
  const cleanup = createDeletedAgentCleanup({ invoke });
  const saga = createAgentReadSaga({
    admission: source
      ? { kind: 'source' }
      : {
          kind: 'principal',
          contextSelector: principalSelector,
          readCurrentContext: () => getPrincipalActionContext(store.getState()),
          dispatch: isolated.dispatch,
        },
    readAgentSession: read,
    selectAgentSession: sessionSelector,
    cleanupDeletedAgentTabs: cleanup,
  });
  let task!: Task;
  const stop = isolated.runSaga(function* runTestAgentReadSaga() {
    yield* setContext({ reduxStore });
    task = yield* fork(saga);
  });
  stops.push(() => {
    stop();
    dispose();
  });
  function admit(id = 'principal') {
    store.dispatch(
      connectionsListReceived({ connections: [], activeId: 'local', windowBackendId: 'local' }),
    );
    store.dispatch(connectionStatusChanged('connected'));
    store.dispatch(daemonEventsSubscribed());
    const context = getPrincipalConnectionContext(store.getState());
    expect(context).not.toBeNull();
    store.dispatch(principalContextChanged(context));
    store.dispatch(
      principalReceived(
        { context: context!, invalidation: 0, presentationVersion: 0 },
        {
          principal: { id, login: null, displayName: null, avatarUrl: null, isAdministrator: true },
          capabilities: {
            hostMembership: false,
            collaborationIdentity: false,
            personalPairing: false,
            authenticatedDevices: false,
          },
        },
      ),
    );
    expect(getPrincipalActionContext(store.getState())).not.toBeNull();
  }
  return {
    store,
    actions,
    read,
    invoke,
    task,
    admit,
    ensure: (agent = AGENT, ws = WS) => store.dispatch(ensureAgentSessionLoaded(ws, agent)),
    revoke: () => store.dispatch(principalIdentityChanged('principal')),
    hold: () => {
      held = true;
    },
    flush: () => {
      held = false;
      const callbacks = [...pending];
      pending.clear();
      callbacks.forEach((cb) => cb());
    },
    duringSubscribe: (callback: () => void) => {
      onSubscribe = callback;
    },
    subscriptions: () => subscriptions,
  };
}
const published = (f: ReturnType<typeof fixture>) =>
  f.actions.filter((a) =>
    [bulkUpsertSessions.type, upsertSession.type, markAgentDetailHydrated.type].includes(a.type),
  );
const cleaned = (f: ReturnType<typeof fixture>) =>
  f.actions.filter((a) =>
    [closeTabsByAgentId.type, destroyTabsByOwnerAgent.type, pruneRecentlyClosed.type].includes(
      a.type,
    ),
  );
function seedTabs(f: ReturnType<typeof fixture>) {
  f.store.dispatch(
    openTab(
      WS,
      { type: 'agent', closable: true, title: 'Agent', agentId: AGENT },
      undefined,
      'agent-tab',
    ),
  );
  f.store.dispatch(
    openHiddenTab(
      WS,
      { type: 'browser', closable: true, title: 'Owned', ownerAgentId: AGENT },
      'hidden',
    ),
  );
  f.store.dispatch(
    openHiddenTab(
      WS,
      { type: 'browser', closable: true, title: 'Other', ownerAgentId: 'other' },
      'other-hidden',
    ),
  );
}

describe('canonical ensure admission', () => {
  it('retains the first ensure until canonical admission and publishes through the reducers', async () => {
    const f = fixture();
    f.ensure();
    expect(f.read).not.toHaveBeenCalled();
    expect(f.subscriptions()).toBe(1);
    f.admit();
    await settle();
    expect(f.read).toHaveBeenCalledExactlyOnceWith(AGENT, WS);
    expect(f.store.getState().agentSessions.byAgentId[AGENT]?.name).toBe('Loaded');
    expect(f.store.getState().agentSessions.detailHydrated?.[AGENT]).toBe(true);
    expect(published(f).map((a) => a.type)).toEqual([
      bulkUpsertSessions.type,
      upsertSession.type,
      markAgentDetailHydrated.type,
    ]);
    expect(f.subscriptions()).toBe(0);
  });

  it.each(['before request', 'during subscription'] as const)(
    'handles readiness %s without missing the first read',
    async (when) => {
      const f = fixture();
      if (when === 'before request') f.admit();
      else f.duringSubscribe(f.admit);
      f.ensure();
      await settle();
      expect(f.read).toHaveBeenCalledExactlyOnceWith(AGENT, WS);
      expect(f.subscriptions()).toBe(0);
    },
  );

  it('samples current state rather than an older buffered setup notification', async () => {
    const f = fixture();
    f.duringSubscribe(() => {
      f.admit();
      f.revoke();
    });
    f.ensure();
    expect(getPrincipalActionContext(f.store.getState())).toBeNull();
    expect(f.read).not.toHaveBeenCalled();
    f.admit('replacement');
    await settle();
    expect(f.read).toHaveBeenCalledTimes(1);
    expect(f.subscriptions()).toBe(0);
  });

  it('keeps pending requests for distinct agents independent', async () => {
    const f = fixture();
    const first = deferred<AgentSession>();
    f.read.mockImplementation((id) =>
      id === AGENT ? first.promise : Promise.resolve(session(id)),
    );
    f.ensure();
    f.ensure('second');
    f.admit();
    await settle();
    expect(f.store.getState().agentSessions.detailHydrated?.second).toBe(true);
    expect(f.store.getState().agentSessions.detailHydrated?.[AGENT]).toBeUndefined();
    first.resolve(session());
    await settle();
    expect(f.store.getState().agentSessions.detailHydrated?.[AGENT]).toBe(true);
    expect(f.subscriptions()).toBe(0);
  });

  it('same-agent supersession cancels only the earlier pending request', async () => {
    const f = fixture();
    f.ensure();
    f.ensure(AGENT, 'new-workspace');
    expect(f.subscriptions()).toBe(1);
    f.admit();
    await settle();
    expect(f.read).toHaveBeenCalledExactlyOnceWith(AGENT, 'new-workspace');
    expect(f.subscriptions()).toBe(0);
  });

  it('supersedes an admitted same-agent read without publishing its late completion', async () => {
    const f = fixture();
    const first = deferred<AgentSession>();
    f.read.mockReturnValueOnce(first.promise);
    f.admit();
    f.ensure();
    f.ensure(AGENT, 'new-workspace');
    await settle();
    expect(f.store.getState().agentSessions.byAgentId[AGENT]?.workspaceId).toBe('new-workspace');
    const count = published(f).length;
    first.resolve(session());
    await settle();
    expect(published(f)).toHaveLength(count);
    expect(f.store.getState().agentSessions.byAgentId[AGENT]?.workspaceId).toBe('new-workspace');
    expect(f.subscriptions()).toBe(0);
  });

  it.each(['workspace', 'root'] as const)(
    'cancels pre-admission waiting on %s teardown',
    async (owner) => {
      const f = fixture();
      f.ensure();
      if (owner === 'workspace') f.store.dispatch(workspaceUnmounted(WS));
      else f.task.cancel();
      expect(f.subscriptions()).toBe(0);
      f.admit();
      await settle();
      expect(f.read).not.toHaveBeenCalled();
    },
  );

  it('keeps a waiting request when a different workspace unmounts', async () => {
    const f = fixture();
    f.ensure();
    f.store.dispatch(workspaceUnmounted('other'));
    f.admit();
    await settle();
    expect(f.read).toHaveBeenCalledExactlyOnceWith(AGENT, WS);
  });

  it.each(['workspace', 'root', 'authority'] as const)(
    'detaches an admitted in-flight result on %s cancellation',
    async (owner) => {
      const f = fixture();
      const result = deferred<AgentSession>();
      f.read.mockReturnValue(result.promise);
      f.admit();
      f.ensure();
      if (owner === 'workspace') f.store.dispatch(workspaceUnmounted(WS));
      else if (owner === 'root') f.task.cancel();
      else f.revoke();
      expect(f.subscriptions()).toBe(0);
      result.resolve(session());
      await settle();
      expect(published(f)).toEqual([]);
      expect(cleaned(f)).toEqual([]);
      expect(f.invoke).not.toHaveBeenCalled();
    },
  );

  it.each(['fulfillment', 'not-found'] as const)(
    'rejects stale %s even when the selector notice is withheld',
    async (outcome) => {
      const f = fixture();
      const result = deferred<AgentSession>();
      f.read.mockReturnValue(result.promise);
      f.admit();
      seedTabs(f);
      f.ensure();
      const oldContext = getPrincipalActionContext(f.store.getState());
      const layout = f.store.getState().panelLayout;
      f.hold();
      f.admit('replacement');
      expect(getPrincipalActionContext(f.store.getState())).not.toBe(oldContext);
      expect(f.subscriptions()).toBe(1);
      if (outcome === 'fulfillment') result.resolve(session());
      else result.reject(notFound);
      await settle();
      expect(published(f)).toEqual([]);
      expect(cleaned(f)).toEqual([]);
      expect(f.store.getState().panelLayout).toBe(layout);
      expect(f.invoke).not.toHaveBeenCalled();
      expect(f.subscriptions()).toBe(0);
      f.flush();
      expect(f.read).toHaveBeenCalledTimes(1);
    },
  );

  it('refuses cleanup after synchronous revoke then throw without a channel notice', async () => {
    const f = fixture();
    f.admit();
    seedTabs(f);
    f.hold();
    f.read.mockImplementation(() => {
      f.revoke();
      throw notFound;
    });
    f.ensure();
    await settle();
    expect(getPrincipalActionContext(f.store.getState())).toBeNull();
    expect(cleaned(f)).toEqual([]);
    expect(f.invoke).not.toHaveBeenCalled();
    expect(f.subscriptions()).toBe(0);
  });

  it.each(['session', 'workspace index'] as const)(
    'stops publication after the %s write causes replacement',
    async (point) => {
      const f = fixture();
      f.admit();
      f.hold();
      const unsubscribe = f.store.subscribe(() => {
        const state = f.store.getState();
        if (!state.agentSessions.byAgentId[AGENT]) return;
        if (
          point === 'workspace index' &&
          !state.workspaceAgents.byWorkspaceId[WS]?.agentIds.includes(AGENT)
        )
          return;
        unsubscribe();
        f.admit('replacement');
      });
      f.ensure();
      await settle();
      expect(published(f).map((a) => a.type)).toEqual(
        point === 'session'
          ? [bulkUpsertSessions.type]
          : [bulkUpsertSessions.type, upsertSession.type],
      );
      expect(f.store.getState().agentSessions.byAgentId[AGENT]?.name).toBe('Loaded');
      expect(f.store.getState().agentSessions.detailHydrated?.[AGENT]).toBeUndefined();
      expect(f.subscriptions()).toBe(0);
    },
  );

  it('runs genuine current-context cleanup and retains unrelated browser ownership', async () => {
    const f = fixture();
    f.admit();
    seedTabs(f);
    f.read.mockRejectedValue(notFound);
    f.ensure();
    await settle();
    const layout = f.store.getState().panelLayout.byWorkspaceId[WS];
    expect(
      Object.values(layout.panels)
        .flatMap((p) => p.tabs)
        .some((t) => t.agentId === AGENT),
    ).toBe(false);
    expect(getItems(layout.hiddenTabs).map((t) => t.id)).toEqual(['other-hidden']);
    expect(layout.recentlyClosed.some((entry) => entry.tab.agentId === AGENT)).toBe(false);
    expect(cleaned(f).map((a) => a.type)).toEqual([
      closeTabsByAgentId.type,
      destroyTabsByOwnerAgent.type,
      pruneRecentlyClosed.type,
    ]);
    expect(f.invoke).toHaveBeenCalledExactlyOnceWith(IPC_CHANNELS.BROWSER.CLEAR_AGENT_TABS, {
      agentId: AGENT,
    });
    expect(f.subscriptions()).toBe(0);
  });

  it.each(['after close', 'before invoke'] as const)(
    'fences cleanup %s with direct authority while notices lag',
    async (point) => {
      const f = fixture();
      f.admit();
      seedTabs(f);
      f.hold();
      f.read.mockRejectedValue(notFound);
      const unsubscribe = f.store.subscribe(() => {
        const layout = f.store.getState().panelLayout.byWorkspaceId[WS];
        const agentVisible = Object.values(layout.panels)
          .flatMap((p) => p.tabs)
          .some((t) => t.agentId === AGENT);
        const targetHidden = getItems(layout.hiddenTabs).some((t) => t.id === 'hidden');
        const targetHistory = layout.recentlyClosed.some((entry) => entry.tab.agentId === AGENT);
        if (agentVisible || (point === 'before invoke' && (targetHidden || targetHistory))) return;
        unsubscribe();
        f.admit('replacement');
      });
      f.ensure();
      await settle();
      expect(cleaned(f).map((a) => a.type)).toEqual(
        point === 'after close'
          ? [closeTabsByAgentId.type]
          : [closeTabsByAgentId.type, destroyTabsByOwnerAgent.type, pruneRecentlyClosed.type],
      );
      expect(f.invoke).not.toHaveBeenCalled();
      expect(f.subscriptions()).toBe(0);
    },
  );

  it('logs ordinary errors and preserves prior state', async () => {
    const f = fixture();
    f.admit();
    seedTabs(f);
    const error = new Error('Read failed');
    const state = f.store.getState();
    f.read.mockRejectedValue(error);
    f.ensure();
    await settle();
    expect(f.store.getState().panelLayout).toBe(state.panelLayout);
    expect(published(f)).toEqual([]);
    expect(cleaned(f)).toEqual([]);
    expect(logs.error).toHaveBeenCalledWith('Failed to load agent session', error);
    expect(f.subscriptions()).toBe(0);
  });

  it('source mode reads immediately with original action order and no authority subscription', async () => {
    const f = fixture(true);
    f.ensure();
    await settle();
    expect(getPrincipalActionContext(f.store.getState())).toBeNull();
    expect(f.read).toHaveBeenCalledExactlyOnceWith(AGENT, WS);
    expect(published(f).map((a) => a.type)).toEqual([
      bulkUpsertSessions.type,
      upsertSession.type,
      markAgentDetailHydrated.type,
    ]);
    expect(f.subscriptions()).toBe(0);
  });
});
