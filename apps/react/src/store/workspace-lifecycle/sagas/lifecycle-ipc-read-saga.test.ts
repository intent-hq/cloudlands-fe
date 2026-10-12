// Actual configured React Store, complete bound owner and real clients/backend/settings.
// Only declared preload delivery is controlled. No branch receiver or app root is started.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { call, takeEvery } from 'typed-redux-saga';
import { getItems } from '@themislib/themis/utils/collections/collection-utils';
import { IPC_CHANNELS } from '$shared/ipc-registry';
import { WorkspaceStatus, type Workspace } from '$shared/types';
import { CHIEF_WORKSPACE_ID, ROOT_WORKSPACE_ID, WorkspaceId } from '$shared/types/branded-ids';
import type { KnownRepo } from '$shared/types/known-repo';
import { store } from '../../index';
import { settingsRuntime } from '../../../features/settings/settings-client';
import { lifecycleIpcReadSaga } from './lifecycle-ipc-read-saga';
import { selectPrincipalConnectionContext } from '../../principal/principal-selectors';
import { createAdmittedLegacyPrincipal } from '../../../../../../src/test/fixtures/admitted-legacy-principal';
import { connectionsListReceived } from '../../../../../../src/store/renderer/slices/connections/connections-slice';
import {
  principalContextChanged,
  principalReceived,
} from '../../../../../../src/store/renderer/slices/principal/principal-slice';
import { hostExecutionConnectionChanged } from '../../../../../../src/store/renderer/slices/host-execution/host-execution-slice';
import {
  loadGithubRepos,
  setGithubRepos,
  setGithubReposError,
} from '../../../../../../src/store/renderer/slices/github-repos/github-repos-slice';
import {
  loadKnownRepos,
  setRepos,
} from '../../../../../../src/store/renderer/slices/known-repos/known-repos-slice';
import {
  fetchEditors,
  fetchEditorsSuccess,
  fetchEditorsFailure,
  setLoading,
} from '../../../../../../src/store/renderer/slices/external-editors/external-editors-slice';
import {
  workspaceMounted,
  workspaceUnmounted,
  workspaceHydrationRequested,
  backendReconnected,
} from '../../../../../../src/store/renderer/slices/workspace-lifecycle/workspace-lifecycle-slice';
import { setWorkspaceEntity } from '../../../../../../src/store/renderer/slices/workspace/workspace-slice';
import { hydrateWorkspaceSidebarUi } from '../../../../../../src/store/renderer/slices/sidebar-nav/sidebar-nav-slice';
import { openTab } from '../../../../../../src/store/renderer/slices/panel-layout/panel-layout-slice';
import { loadEventsRequested } from '../../../../../../src/store/renderer/slices/workspace-events/workspace-events-slice';
import { refreshScripts } from '../../../../../../src/store/renderer/slices/scripts/scripts-slice';
import { loadSkillsRequested } from '../../../../../../src/store/renderer/slices/skills/skills-slice';
import { refreshPRStatusRequested } from '../../../../../../src/store/renderer/slices/pr-status/pr-status-slice';
import { loadWorkspaceDataRequested } from '../../../../../../src/store/renderer/slices/changes/changes-slice';
import { hydrateAgentsRequested } from '../../../../../../src/store/renderer/slices/workspace-agents/workspace-agents-slice';
import { hydrateTerminalsRequested } from '../../../../../../src/store/renderer/slices/terminals/terminals-slice';
import { hydrateFileExplorerRequested } from '../../../../../../src/store/renderer/slices/file-explorer/file-explorer-slice';
import { initContextForWorkspace } from '../../../../../../src/store/renderer/slices/context/context-slice';
import { hydrateTaskAgentAssociationsRequested } from '../../../../../../src/store/renderer/slices/task-agent-associations/task-agent-associations-slice';
import { workspaceNotesHydrationRequested } from '../../../../../../src/store/renderer/slices/workspace-notes/workspace-notes-slice';

type Action = { type: string; payload?: unknown };
type Method = 'github.repos.list' | 'repo.list' | 'host.listInstalledEditors' | 'settings.get';
type Outcome<T> = { kind: 'fulfilled'; value: T } | { kind: 'rejected'; error: unknown };
const WS = 'react-ipc-a';
const cleanups: Array<() => Promise<void>> = [];
function deferred<T>() {
  let resolvePromise!: (value: T) => void;
  let rejectPromise!: (error: unknown) => void;
  let settled = false;
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return {
    promise,
    get settled() {
      return settled;
    },
    resolve(value: T) {
      settled = true;
      resolvePromise(value);
    },
    reject(error: unknown) {
      settled = true;
      rejectPromise(error);
    },
  };
}
function isMethod(method: unknown): method is Method {
  return (
    method === 'github.repos.list' ||
    method === 'repo.list' ||
    method === 'host.listInstalledEditors' ||
    method === 'settings.get'
  );
}
function wireSetting(value: unknown) {
  return {
    value,
    definition: {
      path: 'repos.known',
      label: 'Known repositories',
      description: '',
      category: 'repos',
      type: 'object',
    },
  };
}
function repo(path: string, lastUsedAt = '2026-01-01T00:00:00Z', githubUrl?: string): KnownRepo {
  return {
    path,
    name: path,
    addedAt: '2025-01-01T00:00:00Z',
    lastUsedAt,
    ...(githubUrl ? { githubUrl } : {}),
  };
}
function workspace(id = WS, path?: string): Workspace {
  return {
    id: WorkspaceId(id),
    title: id,
    branch: 'main',
    worktreePath: path,
    status: WorkspaceStatus.Active,
    changesets: [],
    timeline: [],
    conversationInfo: [],
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };
}
const branchTypes = new Set([
  'workspaceAgents/hydrateAgentsRequested',
  'terminals/hydrateTerminalsRequested',
  'taskAgentAssociations/hydrateTaskAgentAssociationsRequested',
  'workspaceNotes/hydrationRequested',
  'workspaceEvents/loadEventsRequested',
  'scripts/refreshScripts',
  'skills/loadSkillsRequested',
  'prStatus/refreshRequested',
  'changes/loadWorkspaceDataRequested',
  'fileExplorer/hydrateFileExplorerRequested',
  'context/initContextForWorkspace',
]);
function branches(actions: Action[], id = WS) {
  return actions.filter(
    (a) => branchTypes.has(a.type) && Array.isArray(a.payload) && a.payload[0] === id,
  );
}
// Independent action contract oracles; never imported from the scheduler.
function immediate(id = WS, generation = 1, force = false): Action[] {
  return [
    { type: 'workspaceAgents/hydrateAgentsRequested', payload: [id] },
    { type: 'terminals/hydrateTerminalsRequested', payload: [id] },
    { type: 'taskAgentAssociations/hydrateTaskAgentAssociationsRequested', payload: [id] },
    { type: 'workspaceNotes/hydrationRequested', payload: [id, generation, force] },
  ];
}
function remaining(id = WS, generation = 1, force = false): Action[] {
  return [
    { type: 'workspaceEvents/loadEventsRequested', payload: [id] },
    { type: 'scripts/refreshScripts', payload: [id] },
    { type: 'skills/loadSkillsRequested', payload: [id] },
    { type: 'prStatus/refreshRequested', payload: [id, force, false] },
    { type: 'changes/loadWorkspaceDataRequested', payload: [id] },
    { type: 'fileExplorer/hydrateFileExplorerRequested', payload: [id, force, generation] },
    { type: 'context/initContextForWorkspace', payload: [id, force, generation] },
  ];
}

afterEach(async () => {
  const errors: unknown[] = [];
  for (const cleanup of cleanups.splice(0).reverse()) {
    try {
      await cleanup();
    } catch (error) {
      errors.push(error);
    }
  }
  try {
    vi.useRealTimers();
  } catch (error) {
    errors.push(error);
  }
  try {
    vi.unstubAllGlobals();
  } catch (error) {
    errors.push(error);
  }
  try {
    vi.restoreAllMocks();
  } catch (error) {
    errors.push(error);
  }
  if (errors.length) throw new AggregateError(errors, 'Lifecycle IPC fixture cleanup failed');
});

function fixture(role: 'owner' | 'guest' | 'unadmitted' = 'owner') {
  const actions: Action[] = [];
  const calls: Array<{ channel: string; args: unknown[]; method: Method }> = [];
  const queued: Array<{ method: Method; reply: ReturnType<typeof deferred<unknown>> }> = [];
  const replies: Array<{ method: Method; reply: ReturnType<typeof deferred<unknown>> }> = [];
  const observations: Array<Promise<Outcome<unknown>>> = [];
  const expectedErrors = new Set<unknown>();
  const runtimeErrors: unknown[] = [];
  const unexpectedCalls: unknown[] = [];
  const drivers: Array<{
    started: boolean;
    stop?: () => void;
    finalizer: ReturnType<typeof deferred<void>>;
  }> = [];
  const listeners = new Map<string, Map<string, (payload: unknown) => void>>();
  const registrations: Array<[string, string]> = [];
  const removals: Array<[string, string]> = [];
  const restorers: Array<() => void> = [];
  const expectedLogs: Array<{ level: 'warn' | 'error'; includes: string }> = [];
  const logReaders: Array<{ level: 'warn' | 'error'; calls: () => unknown[][] }> = [];
  let stopProbe: (() => void) | undefined;
  let errorObservation: { unsubscribe(): void } | undefined;
  let settingsAttempted = false;
  let storeAttempted = false;
  let closing = false;
  let listenerNumber = 0;
  // Before clocks, observers, spies, globals, Store, settings or saga acquisition.
  cleanups.push(cleanup);
  const initialPerformanceNames = new Set(performance.getEntries().map((entry) => entry.name));

  function observe<T>(promise: Promise<T>): Promise<Outcome<T>> {
    const result = promise.then(
      (value): Outcome<T> => ({ kind: 'fulfilled', value }),
      (error): Outcome<T> => ({ kind: 'rejected', error }),
    );
    observations.push(result);
    return result;
  }
  function retain<T>(promise: Promise<T>): Promise<T> {
    observe(promise);
    return promise;
  }
  function defaultResult(method: Method): unknown {
    if (method === 'settings.get') return wireSetting([]);
    return method === 'host.listInstalledEditors' ? { editors: [] } : { repos: [] };
  }
  function hold(method: Method) {
    const reply = deferred<unknown>();
    replies.push({ method, reply });
    queued.push({ method, reply });
    retain(reply.promise);
    return reply;
  }
  function unexpected(detail: unknown): never {
    unexpectedCalls.push(detail);
    throw new Error('Unexpected lifecycle IPC preload operation');
  }
  restorers.push(() => vi.useRealTimers());
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
  vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
  for (const level of ['warn', 'error'] as const) {
    const spy = vi.spyOn(console, level); // Passive observation: original console implementation retained.
    restorers.push(() => spy.mockRestore());
    logReaders.push({ level, calls: () => spy.mock.calls });
  }
  const api: Window['electronAPI'] & {
    platform: string;
    arch: string;
    versions: { node: string; chrome: string; electron: string };
  } = {
    invoke: (channel: string, ...args: unknown[]) => {
      const payload = args[0];
      if (
        channel !== IPC_CHANNELS.BACKEND.REQUEST ||
        args.length !== 1 ||
        !payload ||
        typeof payload !== 'object' ||
        !('method' in payload) ||
        !isMethod(payload.method)
      )
        return unexpected({ channel, args });
      const method = payload.method;
      calls.push({ channel, args, method });
      const index = queued.findIndex((item) => item.method === method);
      let reply: ReturnType<typeof deferred<unknown>>;
      if (index >= 0) reply = queued.splice(index, 1)[0].reply;
      else {
        reply = deferred<unknown>();
        replies.push({ method, reply });
        retain(reply.promise);
      }
      if (closing || index < 0) reply.resolve({ ok: true, result: defaultResult(method) });
      return retain(reply.promise);
    },
    on: (channel: string, callback: (payload: unknown) => void) => {
      if (channel !== IPC_CHANNELS.BACKEND.NOTIFICATION && channel !== IPC_CHANNELS.BACKEND.STATUS)
        return unexpected({ on: channel });
      const id = `lifecycle-ipc-${++listenerNumber}`;
      const entries = listeners.get(channel) ?? new Map<string, (payload: unknown) => void>();
      entries.set(id, callback);
      listeners.set(channel, entries);
      registrations.push([channel, id]);
      return id;
    },
    offById: (channel: string, id: string) => {
      if (!listeners.get(channel)?.delete(id)) return unexpected({ offById: [channel, id] });
      removals.push([channel, id]);
    },
    send: (...args: unknown[]) => unexpected({ send: args }),
    off: (...args: unknown[]) => unexpected({ off: args }),
    removeAllListeners: (...args: unknown[]) => unexpected({ removeAllListeners: args }),
    platform: 'linux',
    arch: 'x64',
    versions: { node: '24.21.0', chrome: '153.0.8010.12', electron: '43.0.0' },
    devInstance: null,
    devPort: null,
  };
  restorers.push(() => vi.unstubAllGlobals());
  vi.stubGlobal('window', { electronAPI: api });
  errorObservation = store.traceStreams.runtimeError.observe((event: unknown) =>
    runtimeErrors.push(event),
  );
  storeAttempted = true;
  store.init(role === 'unadmitted' ? undefined : createAdmittedLegacyPrincipal({}, role));
  settingsAttempted = true;
  settingsRuntime.start();
  stopProbe = store.runSaga(function* observeLifecycleOutputs() {
    yield* takeEvery(
      [
        workspaceMounted,
        workspaceUnmounted,
        loadEventsRequested,
        refreshScripts,
        loadSkillsRequested,
        refreshPRStatusRequested,
        loadWorkspaceDataRequested,
        hydrateAgentsRequested,
        hydrateTerminalsRequested,
        hydrateFileExplorerRequested,
        initContextForWorkspace,
        hydrateTaskAgentAssociationsRequested,
        workspaceNotesHydrationRequested,
        setGithubRepos,
        setGithubReposError,
        setRepos,
        fetchEditorsSuccess,
        fetchEditorsFailure,
        setLoading,
      ],
      function record(action: Action) {
        actions.push(action);
      },
    );
  });
  function start() {
    const driver: (typeof drivers)[number] = { started: false, finalizer: deferred<void>() };
    drivers.push(driver);
    driver.stop = store.runSaga(function* runCompleteBinding() {
      driver.started = true;
      try {
        yield* call(lifecycleIpcReadSaga);
      } finally {
        driver.finalizer.resolve(undefined);
      }
    });
    return () => driver.stop?.();
  }
  function changeHost(id: string) {
    store.dispatch(connectionsListReceived({ connections: [], activeId: id, windowBackendId: id }));
    const context = selectPrincipalConnectionContext.select(store.state);
    const snapshot = createAdmittedLegacyPrincipal({}, 'owner').principal.snapshot;
    if (!context || !snapshot)
      throw new Error('Host change needs actual admitted connection context');
    store.dispatch(principalContextChanged(context));
    store.dispatch(
      principalReceived(
        {
          context,
          invalidation: store.state.principal.invalidation,
          presentationVersion: store.state.principal.presentationVersion,
        },
        snapshot,
      ),
    );
    store.dispatch(hostExecutionConnectionChanged(context));
  }
  async function cleanup() {
    const errors: unknown[] = [];
    const attempt = (f: () => void) => {
      try {
        f();
      } catch (error) {
        errors.push(error);
      }
    };
    closing = true;
    for (const driver of drivers) attempt(() => driver.stop?.());
    attempt(() => stopProbe?.());
    let observed = 0;
    try {
      do {
        for (const { method, reply } of replies)
          attempt(() => {
            if (!reply.settled) reply.resolve({ ok: true, result: defaultResult(method) });
          });
        const batch = observations.slice(observed);
        observed = observations.length;
        const drains = await Promise.allSettled(
          batch.map(async (item) => {
            try {
              const outcome = await item;
              if (outcome.kind === 'rejected' && !expectedErrors.has(outcome.error))
                errors.push(outcome.error);
            } catch (error) {
              errors.push(error);
            }
          }),
        );
        for (const drain of drains) if (drain.status === 'rejected') errors.push(drain.reason);
        // Drain scheduled microtasks after releasing declared delivery, without claiming a native Task join.
        try {
          await vi.advanceTimersByTimeAsync(0);
        } catch (error) {
          errors.push(error);
        }
      } while (observed < observations.length);
    } catch (error) {
      errors.push(error);
    } finally {
      if (settingsAttempted) attempt(() => settingsRuntime.dispose());
      if (storeAttempted) attempt(() => store.dispose());
      try {
        // Store disposal also cancels a driver whose start threw before returning its public stop.
        try {
          const finalizers = await Promise.allSettled(
            drivers.filter((d) => d.started).map((d) => d.finalizer.promise),
          );
          for (const result of finalizers)
            if (result.status === 'rejected') errors.push(result.reason);
        } catch (error) {
          errors.push(error);
        }
        errors.push(...runtimeErrors, ...unexpectedCalls);
        attempt(() => expect(removals.slice().sort()).toEqual(registrations.slice().sort()));
        attempt(() =>
          expect([...listeners.values()].flatMap((entries) => [...entries.keys()])).toEqual([]),
        );
        for (const reader of logReaders)
          attempt(() => {
            for (const args of reader.calls())
              attempt(() => {
                const index = expectedLogs.findIndex(
                  (entry) =>
                    entry.level === reader.level && String(args[0]).includes(entry.includes),
                );
                if (index < 0) errors.push({ unexpectedLog: reader.level, args });
                else expectedLogs.splice(index, 1);
              });
          });
        if (expectedLogs.length) errors.push({ missingExpectedLogs: expectedLogs });
      } finally {
        attempt(() => errorObservation?.unsubscribe());
        for (const restore of restorers.reverse()) attempt(restore);
        // Only names created by this fixture; retain pre-existing performance entries.
        attempt(() => {
          for (const entry of performance.getEntries()) {
            if (
              !entry.name.startsWith('intent:workspace-hydration:') ||
              initialPerformanceNames.has(entry.name)
            )
              continue;
            if (entry.entryType === 'mark') attempt(() => performance.clearMarks(entry.name));
            if (entry.entryType === 'measure') attempt(() => performance.clearMeasures(entry.name));
          }
        });
      }
    }
    if (errors.length)
      throw new AggregateError(errors, 'Lifecycle IPC resources did not close cleanly');
  }
  return {
    actions,
    calls,
    start,
    hold,
    changeHost,
    reject(reply: ReturnType<typeof deferred<unknown>>, error: unknown) {
      expectedErrors.add(error);
      reply.reject(error);
    },
    expectKnownFailure() {
      expectedLogs.push({
        level: 'error',
        includes: 'Failed to load known repos; keeping prior known repos',
      });
    },
    async delivered(method: Method, count = 1) {
      await vi.waitFor(() => expect(calls.filter((c) => c.method === method)).toHaveLength(count));
    },
    emit(channel: string, payload: unknown) {
      for (const callback of [...(listeners.get(channel)?.values() ?? [])]) callback(payload);
    },
  };
}

describe('inactive complete React lifecycle IPC binding', () => {
  it('does no direct work until the full owner is explicitly started', async () => {
    const f = fixture();
    store.dispatch(loadGithubRepos());
    store.dispatch(loadKnownRepos());
    store.dispatch(fetchEditors(true));
    await vi.advanceTimersByTimeAsync(0);
    expect(f.calls).toEqual([]);
    expect(store.state.githubRepos.loaded).toBe(false);
    expect(store.state.knownRepos.loaded).toBe(false);
    f.start();
    store.dispatch(loadGithubRepos());
    await vi.waitFor(() => expect(store.state.githubRepos.loaded).toBe(true));
    expect(f.calls.map((c) => c.method)).toEqual(['github.repos.list']);
  });

  it('stores all three real read outputs through canonical reducers and exact daemon requests', async () => {
    const f = fixture();
    const github = f.hold('github.repos.list'),
      known = f.hold('repo.list');
    const editors = f.hold('host.listInstalledEditors'),
      setting = f.hold('settings.get');
    f.start();
    store.dispatch(loadGithubRepos());
    store.dispatch(loadKnownRepos());
    store.dispatch(fetchEditors(false));
    expect(store.state.githubRepos.loading).toBe(true);
    expect(store.state.externalEditors.loading).toBe(true);
    const local = repo('/local'),
      pick = repo('team/pick', '2026-02-01T00:00:00Z', 'https://github.com/team/pick');
    github.resolve({
      ok: true,
      result: {
        repos: [
          {
            owner: 'team',
            name: 'repo',
            defaultBranch: 'trunk',
            htmlUrl: 'https://github.com/team/repo',
          },
        ],
      },
    });
    known.resolve({ ok: true, result: { repos: [local, repo('/cache/.clones/internal')] } });
    editors.resolve({
      ok: true,
      result: {
        editors: [
          { id: 'finder', installed: false },
          { id: 'vscode', installed: true },
        ],
      },
    });
    await f.delivered('settings.get');
    setting.resolve({ ok: true, result: wireSetting([pick]) });
    await vi.waitFor(() => expect(store.state.knownRepos.loaded).toBe(true));
    await vi.waitFor(() => expect(store.state.externalEditors.loading).toBe(false));
    expect(getItems(store.state.githubRepos.repos)).toEqual([
      { id: 'team/repo', owner: 'team', name: 'repo', defaultBranch: 'trunk' },
    ]);
    expect(store.state.githubRepos).toMatchObject({ loading: false, loaded: true, error: null });
    expect(getItems(store.state.knownRepos.repos)).toEqual([pick, local]);
    expect(
      getItems(store.state.externalEditors.editors).map((e) => ({
        id: e.id,
        installed: e.installed,
      })),
    ).toEqual([
      { id: 'finder', installed: true },
      { id: 'vscode', installed: true },
    ]);
    expect(store.state.externalEditors.error).toBeNull();
    expect(f.calls.map(({ channel, args }) => ({ channel, args }))).toEqual([
      { channel: 'backend:request', args: [{ method: 'github.repos.list', params: undefined }] },
      { channel: 'backend:request', args: [{ method: 'repo.list', params: undefined }] },
      {
        channel: 'backend:request',
        args: [{ method: 'host.listInstalledEditors', params: undefined }],
      },
      {
        channel: 'backend:request',
        args: [{ method: 'settings.get', params: { path: 'repos.known' } }],
      },
    ]);
  });

  it.each(['github', 'known', 'editors'] as const)(
    'coalesces a held %s trigger and permits a later fresh read',
    async (kind) => {
      const f = fixture();
      const method =
        kind === 'github'
          ? 'github.repos.list'
          : kind === 'known'
            ? 'repo.list'
            : 'host.listInstalledEditors';
      const trigger = () => {
        if (kind === 'github') store.dispatch(loadGithubRepos());
        else if (kind === 'known') store.dispatch(loadKnownRepos());
        else store.dispatch(fetchEditors(true));
      };
      const result = kind === 'editors' ? { editors: [] } : { repos: [] };
      const reply = f.hold(method);
      f.start();
      trigger();
      trigger();
      await f.delivered(method);
      reply.resolve({ ok: true, result });
      await vi.advanceTimersByTimeAsync(0);
      trigger();
      await f.delivered(method, 2);
      await vi.advanceTimersByTimeAsync(0);
      expect(f.calls.filter((c) => c.method === method)).toHaveLength(2);
      if (kind === 'github')
        expect(store.state.githubRepos).toMatchObject({ loaded: true, loading: false });
      if (kind === 'known') expect(store.state.knownRepos.loaded).toBe(true);
      if (kind === 'editors') expect(store.state.externalEditors.loading).toBe(false);
    },
  );

  it.each(['daemon', 'raw'] as const)(
    'keeps GitHub error state after a %s failure',
    async (mode) => {
      const f = fixture(),
        reply = f.hold('github.repos.list');
      f.start();
      store.dispatch(loadGithubRepos());
      if (mode === 'daemon')
        reply.resolve({
          ok: false,
          error: { code: 'FORBIDDEN', message: 'Repository access denied' },
        });
      else f.reject(reply, new Error('Repository access denied'));
      await vi.waitFor(() =>
        expect(store.state.githubRepos.error).toBe('Repository access denied'),
      );
      expect(store.state.githubRepos).toMatchObject({ loaded: false, loading: false });
      expect(getItems(store.state.githubRepos.repos)).toEqual([]);
    },
  );

  it('retains editor failure and clears loading through the original finally', async () => {
    const f = fixture(),
      reply = f.hold('host.listInstalledEditors');
    f.start();
    store.dispatch(fetchEditors(true));
    reply.resolve({ ok: false, error: { code: 'UNAVAILABLE', message: 'Catalog unavailable' } });
    await vi.waitFor(() => expect(store.state.externalEditors.error).toBe('Catalog unavailable'));
    expect(store.state.externalEditors.loading).toBe(false);
    expect(getItems(store.state.externalEditors.editors)).toEqual([]);
  });

  it.each(['raw', 'malformed'] as const)(
    'keeps previously read known repositories after %s failure',
    async (mode) => {
      const f = fixture(),
        first = f.hold('repo.list');
      f.start();
      store.dispatch(loadKnownRepos());
      const prior = repo('/prior');
      first.resolve({ ok: true, result: { repos: [prior] } });
      await vi.waitFor(() => expect(store.state.knownRepos.loaded).toBe(true));
      const second = f.hold('repo.list');
      f.expectKnownFailure();
      store.dispatch(loadKnownRepos());
      if (mode === 'raw') f.reject(second, new Error('Registry failed'));
      else second.resolve({ ok: true, result: { repos: [null] } });
      await vi.advanceTimersByTimeAsync(0);
      expect(getItems(store.state.knownRepos.repos)).toEqual([prior]);
      expect(store.state.knownRepos.loaded).toBe(true);
      expect(f.calls.filter((c) => c.method === 'repo.list')).toHaveLength(2);
    },
  );

  it.each(['github', 'known'] as const)(
    'cancels the old-host %s worker before its raw response and accepts its successor',
    async (kind) => {
      const f = fixture();
      const method = kind === 'github' ? 'github.repos.list' : 'repo.list';
      const trigger = () => {
        if (kind === 'github') store.dispatch(loadGithubRepos());
        else store.dispatch(loadKnownRepos());
      };
      const old = f.hold(method);
      f.start();
      trigger();
      await f.delivered(method);
      const previousContext = selectPrincipalConnectionContext.select(store.state);
      f.changeHost('new-host');
      expect(selectPrincipalConnectionContext.select(store.state)).not.toBe(previousContext);
      expect(store.state.githubRepos.loaded).toBe(false);
      expect(store.state.knownRepos.loaded).toBe(false);
      const current = f.hold(method);
      trigger();
      await f.delivered(method, 2);
      current.resolve({
        ok: true,
        result: {
          repos: kind === 'github' ? [{ owner: 'current', name: 'repo' }] : [repo('/current')],
        },
      });
      await vi.waitFor(() =>
        expect(
          kind === 'github' ? store.state.githubRepos.loaded : store.state.knownRepos.loaded,
        ).toBe(true),
      );
      old.resolve({
        ok: true,
        result: {
          repos: kind === 'github' ? [{ owner: 'stale', name: 'repo' }] : [repo('/stale')],
        },
      });
      await vi.advanceTimersByTimeAsync(0);
      if (kind === 'github')
        expect(getItems(store.state.githubRepos.repos)).toEqual([
          { id: 'current/repo', owner: 'current', name: 'repo', defaultBranch: undefined },
        ]);
      else expect(getItems(store.state.knownRepos.repos)).toEqual([repo('/current')]);
    },
  );

  it('retires a held known-repository settings read on reconnect before a current-host result', async () => {
    const f = fixture(),
      oldSetting = f.hold('settings.get');
    f.start();
    store.dispatch(loadKnownRepos());
    await f.delivered('settings.get');
    f.emit(IPC_CHANNELS.BACKEND.STATUS, { status: 'connected', reconnected: true });
    f.changeHost('replacement');
    const currentRepo = f.hold('repo.list'),
      currentSetting = f.hold('settings.get');
    store.dispatch(loadKnownRepos());
    await f.delivered('repo.list', 2);
    currentRepo.resolve({ ok: true, result: { repos: [repo('/current')] } });
    oldSetting.resolve({
      ok: true,
      result: wireSetting([
        repo('old/pick', '2026-03-01T00:00:00Z', 'https://github.com/old/pick'),
      ]),
    });
    await f.delivered('settings.get', 2);
    currentSetting.resolve({ ok: true, result: wireSetting([]) });
    await vi.waitFor(() => expect(store.state.knownRepos.loaded).toBe(true));
    expect(getItems(store.state.knownRepos.repos)).toEqual([repo('/current')]);
  });

  it.each(['guest', 'unadmitted'] as const)(
    'retains registry-only known reads for %s without an owner settings request',
    async (role) => {
      const f = fixture(role),
        reply = f.hold('repo.list');
      f.start();
      store.dispatch(loadKnownRepos());
      reply.resolve({ ok: true, result: { repos: [repo('/visible')] } });
      await vi.waitFor(() => expect(store.state.knownRepos.loaded).toBe(true));
      expect(getItems(store.state.knownRepos.repos)).toEqual([repo('/visible')]);
      expect(f.calls.map((c) => c.method)).toEqual(['repo.list']);
    },
  );

  it('keeps the editor cache and lets force refresh or expiry issue a new real read', async () => {
    const f = fixture(),
      first = f.hold('host.listInstalledEditors');
    f.start();
    store.dispatch(fetchEditors(false));
    first.resolve({ ok: true, result: { editors: [{ id: 'vscode', installed: true }] } });
    await vi.waitFor(() => expect(store.state.externalEditors.loading).toBe(false));
    store.dispatch(fetchEditors(false));
    await vi.advanceTimersByTimeAsync(0);
    expect(f.calls).toHaveLength(1);
    const forced = f.hold('host.listInstalledEditors');
    store.dispatch(fetchEditors(true));
    store.dispatch(fetchEditors(true));
    await f.delivered('host.listInstalledEditors', 2);
    forced.resolve({ ok: true, result: { editors: [{ id: 'vscode', installed: true }] } });
    await vi.waitFor(() => expect(store.state.externalEditors.loading).toBe(false));
    await vi.advanceTimersByTimeAsync(60_001);
    store.dispatch(fetchEditors(false));
    await f.delivered('host.listInstalledEditors', 3);
    await vi.advanceTimersByTimeAsync(0);
    expect(store.state.externalEditors.loading).toBe(false);
  });

  it('clears editor loading when the complete owner stops and ignores late delivery', async () => {
    const f = fixture(),
      reply = f.hold('host.listInstalledEditors');
    const stop = f.start();
    store.dispatch(fetchEditors(true));
    expect(store.state.externalEditors.loading).toBe(true);
    stop();
    expect(store.state.externalEditors.loading).toBe(false);
    const afterStop = store.state.externalEditors;
    reply.resolve({ ok: true, result: { editors: [{ id: 'vscode', installed: true }] } });
    await vi.advanceTimersByTimeAsync(0);
    expect(store.state.externalEditors).toBe(afterStop);
  });

  it('coalesces mount requests per workspace and dispatches every tier without claiming completion', async () => {
    const f = fixture();
    f.start();
    for (const id of [WS, 'react-ipc-b'])
      store.dispatch(setWorkspaceEntity(workspace(id, '/repo')));
    store.dispatch(workspaceHydrationRequested(WS));
    store.dispatch(workspaceHydrationRequested(WS));
    store.dispatch(workspaceHydrationRequested('react-ipc-b'));
    expect(branches(f.actions)).toEqual(immediate());
    expect(branches(f.actions, 'react-ipc-b')).toEqual(immediate('react-ipc-b', 2));
    expect(f.actions.filter((a) => a.type === workspaceMounted.type)).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1_500);
    expect(branches(f.actions)).toEqual([...immediate(), ...remaining()]);
    expect(branches(f.actions, 'react-ipc-b')).toEqual([
      ...immediate('react-ipc-b', 2),
      ...remaining('react-ipc-b', 2),
    ]);
    expect(store.state.workspaceLifecycle.sessionPhaseByWorkspaceId[WS]).toBe('hydrated');
    expect(store.state.workspaceLifecycle.loadByWorkspaceId[WS]).toBeUndefined();
    expect(f.calls).toEqual([]); // Branch request dispatch is not hydration completion.
  });

  it('promotes canonical sidebar consumers once before the fallback', async () => {
    const f = fixture();
    f.start();
    store.dispatch(setWorkspaceEntity(workspace(WS, '/repo')));
    store.dispatch(workspaceHydrationRequested(WS));
    store.dispatch(hydrateWorkspaceSidebarUi(WS, { selectedTabIds: ['changes'] }));
    store.dispatch(hydrateWorkspaceSidebarUi(WS, { selectedTabIds: ['changes'] }));
    const promoted = [
      { type: 'changes/loadWorkspaceDataRequested', payload: [WS] },
      { type: 'prStatus/refreshRequested', payload: [WS, false, false] },
    ];
    expect(branches(f.actions)).toEqual([...immediate(), ...promoted]);
    await vi.advanceTimersByTimeAsync(1_500);
    expect(branches(f.actions)).toHaveLength(11);
    for (const action of promoted)
      expect(branches(f.actions).filter((a) => a.type === action.type)).toEqual([action]);
  });

  it('promotes an actual active activity panel without substituting panel selector state', async () => {
    const f = fixture();
    f.start();
    store.dispatch(setWorkspaceEntity(workspace(WS, '/repo')));
    store.dispatch(workspaceHydrationRequested(WS));
    store.dispatch(
      openTab(
        WS,
        { type: 'activity', title: 'Activity', closable: true },
        undefined,
        'activity-tab',
        false,
        1,
      ),
    );
    const event = { type: 'workspaceEvents/loadEventsRequested', payload: [WS] };
    expect(branches(f.actions)).toEqual([...immediate(), event]);
    await vi.advanceTimersByTimeAsync(1_500);
    expect(branches(f.actions).filter((a) => a.type === event.type)).toEqual([event]);
  });

  it('expires path waits without inventing skills or file-explorer responses', async () => {
    const f = fixture();
    f.start();
    store.dispatch(setWorkspaceEntity(workspace()));
    store.dispatch(workspaceHydrationRequested(WS));
    await vi.advanceTimersByTimeAsync(3_000);
    expect(
      branches(f.actions).filter(
        (a) =>
          a.type === 'skills/loadSkillsRequested' ||
          a.type === 'fileExplorer/hydrateFileExplorerRequested',
      ),
    ).toEqual([]);
    store.dispatch(setWorkspaceEntity(workspace(WS, '/too-late')));
    await vi.advanceTimersByTimeAsync(0);
    expect(branches(f.actions)).toHaveLength(9);
  });

  it('cancels an old path wait and only dispatches the reopened generation after path resolution', async () => {
    const f = fixture();
    f.start();
    store.dispatch(workspaceHydrationRequested(WS));
    store.dispatch(hydrateWorkspaceSidebarUi(WS, { selectedTabIds: ['files'] }));
    store.dispatch(workspaceUnmounted(WS));
    store.dispatch(workspaceHydrationRequested(WS));
    store.dispatch(setWorkspaceEntity(workspace(WS, '/resolved')));
    await vi.advanceTimersByTimeAsync(0);
    expect(
      branches(f.actions).filter((a) => a.type === 'fileExplorer/hydrateFileExplorerRequested'),
    ).toEqual([{ type: 'fileExplorer/hydrateFileExplorerRequested', payload: [WS, false, 2] }]);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(
      branches(f.actions).filter((a) => a.type === 'fileExplorer/hydrateFileExplorerRequested'),
    ).toHaveLength(1);
    expect(branches(f.actions).filter((a) => a.type === 'skills/loadSkillsRequested')).toHaveLength(
      1,
    );
  });

  it.each([ROOT_WORKSPACE_ID, CHIEF_WORKSPACE_ID])(
    'skips path-dependent requests for synthetic workspace %s',
    async (id) => {
      const f = fixture();
      f.start();
      store.dispatch(workspaceHydrationRequested(id));
      await vi.advanceTimersByTimeAsync(3_000);
      expect(
        branches(f.actions, id).filter(
          (a) =>
            a.type === 'skills/loadSkillsRequested' ||
            a.type === 'fileExplorer/hydrateFileExplorerRequested',
        ),
      ).toEqual([]);
      expect(branches(f.actions, id)).toHaveLength(9);
    },
  );

  it('cancels the pending fallback on unmount and starts a fresh generation on reopen', async () => {
    const f = fixture();
    f.start();
    store.dispatch(setWorkspaceEntity(workspace(WS, '/repo')));
    store.dispatch(workspaceHydrationRequested(WS));
    store.dispatch(workspaceUnmounted(WS));
    await vi.advanceTimersByTimeAsync(3_000);
    expect(branches(f.actions)).toEqual(immediate());
    store.dispatch(workspaceHydrationRequested(WS));
    await vi.advanceTimersByTimeAsync(1_500);
    expect(branches(f.actions)).toEqual([...immediate(), ...immediate(WS, 2), ...remaining(WS, 2)]);
  });

  it.each(['reconnect', 'backend-identity'] as const)(
    'restarts mounted work with force after %s and cancels its old timer',
    async (trigger) => {
      const f = fixture();
      f.start();
      store.dispatch(setWorkspaceEntity(workspace(WS, '/repo')));
      store.dispatch(workspaceHydrationRequested(WS));
      if (trigger === 'reconnect') store.dispatch(backendReconnected());
      else {
        store.dispatch(
          connectionsListReceived({ connections: [], activeId: 'local', windowBackendId: 'local' }),
        );
        expect(branches(f.actions)).toEqual(immediate());
        store.dispatch(
          connectionsListReceived({
            connections: [],
            activeId: 'remote',
            windowBackendId: 'remote',
          }),
        );
      }
      expect(branches(f.actions)).toEqual([...immediate(), ...immediate(WS, 2, true)]);
      await vi.advanceTimersByTimeAsync(1_500);
      expect(branches(f.actions)).toEqual([
        ...immediate(),
        ...immediate(WS, 2, true),
        ...remaining(WS, 2, true),
      ]);
    },
  );

  it('stops all scheduled work and retains source hydrated-phase behavior on explicit restart', async () => {
    const f = fixture();
    const stop = f.start();
    store.dispatch(setWorkspaceEntity(workspace(WS, '/repo')));
    store.dispatch(workspaceHydrationRequested(WS));
    stop();
    await vi.advanceTimersByTimeAsync(3_000);
    expect(branches(f.actions)).toEqual(immediate());
    f.start();
    store.dispatch(workspaceHydrationRequested(WS));
    await vi.advanceTimersByTimeAsync(3_000);
    expect(branches(f.actions)).toEqual(immediate());
    store.dispatch(workspaceUnmounted(WS));
    store.dispatch(workspaceHydrationRequested(WS));
    await vi.advanceTimersByTimeAsync(1_500);
    expect(branches(f.actions)).toEqual([...immediate(), ...immediate(), ...remaining()]);
  });
});
