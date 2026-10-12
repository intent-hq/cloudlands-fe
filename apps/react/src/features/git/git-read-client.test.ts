/** Actual configured React Store and captured transport; only declared preload replies are controlled.
 * This is an adapter boundary test, not full lifecycle receiver composition or a real main origin.
 */
import { setImmediate } from 'node:timers/promises';
import { describe, expect, it, vi } from 'vitest';
import { store } from '@/store';
import { createReactGitReadPorts } from './git-read-client';
import { IPC_CHANNELS } from '$shared/ipc-registry';
import type {
  WorkspaceLoadPrepare,
  WorkspaceLoadRouteRef,
} from '$shared/types/workspace-load-route';
import { WorkspaceStatus } from '$shared/types';
import { WorkspaceId } from '$shared/types/branded-ids';
import { connectionsListReceived } from '../../../../../src/store/renderer/slices/connections/connections-slice';
import { connectionStatusChanged } from '../../../../../src/store/renderer/slices/daemon-health/daemon-health-slice';
import { daemonEventsSubscribed } from '../../../../../src/store/renderer/slices/workspace-events/workspace-events-slice';
import {
  principalContextChanged,
  principalReceived,
} from '../../../../../src/store/renderer/slices/principal/principal-slice';
import {
  selectPrincipalConnectionContext,
  selectPrincipalActionContext,
} from '../../store/principal/principal-selectors';
import {
  setWorkspaceEntity,
  setWorkspaceHasLoaded,
} from '../../../../../src/store/renderer/slices/workspace/workspace-slice';

const id = '77777777-7777-4777-8777-777777777777';
const channels = IPC_CHANNELS.WORKSPACE_LOAD;
const refused = {
  ok: false,
  error: { code: 'WORKSPACE_LOAD_ROUTE_UNAVAILABLE', message: 'unavailable' },
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  let settled = false;
  return {
    promise,
    get settled() {
      return settled;
    },
    resolve(value: T) {
      if (!settled) {
        settled = true;
        resolve(value);
      }
    },
  };
}
function observe<T>(promise: Promise<T>) {
  return promise.then(
    (value) => ({ status: 'fulfilled' as const, value }),
    (error) => ({ status: 'rejected' as const, error: error as unknown }),
  );
}
async function withAdapter(run: (f: Awaited<ReturnType<typeof setup>>) => Promise<void>) {
  const f = await setup();
  const errors: unknown[] = [];
  try {
    await run(f);
  } catch (error) {
    errors.push(error);
  }
  try {
    f.controller.abort();
  } catch (error) {
    errors.push(error);
  }
  for (const close of f.releases.reverse())
    try {
      close();
    } catch (error) {
      errors.push(error);
    }
  for (const call of f.calls) {
    try {
      call.reply.resolve(refused);
      await call.reply.promise;
    } catch (error) {
      errors.push(error);
    }
  }
  await setImmediate();
  try {
    expect(f.listeners.size).toBe(0);
  } catch (error) {
    errors.push(error);
  }
  try {
    f.dispose();
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
  if (errors.length === 1) throw errors[0];
  if (errors.length) throw new AggregateError(errors, 'Adapter test/cleanup failures');
}
async function setup() {
  const dispose = store.init();
  // Own the disposer before remaining setup; the catch below closes partial setup.
  const releases: Array<() => void> = [];
  const controller = new AbortController();
  const calls: Array<{
    channel: string;
    args: unknown[];
    reply: ReturnType<typeof deferred<unknown>>;
  }> = [];
  const listeners = new Map<string, (...args: unknown[]) => void>();
  const waiters = new Map<string, ReturnType<typeof deferred<(typeof calls)[number]>>>();
  const list = (channel: string) => calls.filter((call) => call.channel === channel);
  const api: Window['electronAPI'] = {
    invoke: vi.fn(function (channel: string, ...args: unknown[]) {
      const index = list(channel).length;
      const reply = deferred<unknown>();
      const entry = { channel, args, reply };
      calls.push(entry);
      waiters.get(`${channel}:${index}`)?.resolve(entry);
      if (channel === channels.RELEASE || channel === channels.RELEASE_ORIGIN)
        reply.resolve({ ok: true, result: undefined });
      return reply.promise;
    }),
    on: vi.fn((_channel, handler) => {
      const token = `listener-${listeners.size}`;
      listeners.set(token, handler);
      return token;
    }),
    offById: vi.fn((_channel, token) => {
      listeners.delete(token);
    }),
    send: vi.fn(),
    off: vi.fn(),
    removeAllListeners: vi.fn(),
    devInstance: null,
    devPort: null,
  };
  try {
    vi.stubGlobal('window', { electronAPI: api });
    const ports = createReactGitReadPorts();
    function next(channel: string, index = 0) {
      const current = list(channel)[index];
      if (current) return Promise.resolve(current);
      const key = `${channel}:${index}`;
      let waiter = waiters.get(key);
      if (!waiter) {
        waiter = deferred();
        waiters.set(key, waiter);
      }
      return waiter.promise;
    }
    async function deliver(call: (typeof calls)[number], value: unknown) {
      call.reply.resolve(value);
      await call.reply.promise;
      await setImmediate();
    }
    async function acquire(originId = 'declared-origin', index = 0) {
      const pending = ports.acquire(id, controller.signal);
      const call = await next(channels.OBSERVE_ORIGIN, index);
      expect(call.args).toEqual([]);
      await deliver(call, { ok: true, result: { originId } });
      const result = await pending;
      if (result.kind !== 'acquired') throw new Error('Expected declared scope');
      releases.push(result.scope.release);
      return result.scope;
    }
    async function preparePr(
      scope: Awaited<ReturnType<typeof acquire>>,
      originId = 'declared-origin',
      index = 0,
    ) {
      const pending = scope.preparePrRefresh();
      const call = await next(channels.PREPARE, index);
      expect(call.args).toEqual([
        { originId, workspaceId: id, requestId: expect.any(String), operation: 'pr-refresh' },
      ]);
      const { operation: _operation, ...input } = call.args[0] as WorkspaceLoadPrepare & {
        operation: string;
      };
      const ref = { ...input, routeId: `route-${index}` };
      await deliver(call, {
        ok: true,
        result: { ref, provenance: { physicalOwnerId: 'declared-owner' } },
      });
      return { prepared: await pending, ref };
    }
    async function read(ref: WorkspaceLoadRouteRef, value: unknown, index = 0) {
      const call = await next(channels.READ, index);
      await deliver(call, {
        ok: true,
        result: { ref, current: true, settlement: { status: 'fulfilled', value } },
      });
    }
    function grant() {
      store.dispatch(
        connectionsListReceived({ connections: [], activeId: 'local', windowBackendId: 'local' }),
      );
      store.dispatch(connectionStatusChanged('connected'));
      store.dispatch(daemonEventsSubscribed());
      const context = selectPrincipalConnectionContext.select(store.state);
      if (!context) throw new Error('Actual connection context required');
      store.dispatch(principalContextChanged(context));
      store.dispatch(
        principalReceived(
          { context, invalidation: 0, presentationVersion: 0 },
          {
            principal: {
              id: 'reader',
              login: null,
              displayName: null,
              avatarUrl: null,
              isAdministrator: true,
              hostRole: 'owner',
              hostMembershipRevision: 1,
            },
            capabilities: {
              hostMembership: true,
              collaborationIdentity: true,
              personalPairing: false,
              authenticatedDevices: false,
            },
          },
        ),
      );
      const admitted = selectPrincipalActionContext.select(store.state);
      store.dispatch(
        setWorkspaceEntity({
          id: WorkspaceId(id),
          title: 'Git',
          branch: 'main',
          status: WorkspaceStatus.Active,
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z',
          changesets: [],
          timeline: [],
          conversationInfo: [],
        }),
      );
      store.dispatch(setWorkspaceHasLoaded(true, 'local', admitted));
      return admitted;
    }
    return {
      ports,
      api,
      next,
      list,
      calls,
      listeners,
      releases,
      controller,
      dispose,
      deliver,
      acquire,
      preparePr,
      read,
      grant,
    };
  } catch (error) {
    const errors: unknown[] = [error];
    try {
      controller.abort();
    } catch (failure) {
      errors.push(failure);
    }
    try {
      dispose();
    } catch (failure) {
      errors.push(failure);
    }
    try {
      vi.unstubAllGlobals();
    } catch (failure) {
      errors.push(failure);
    }
    if (errors.length === 1) throw error;
    throw new AggregateError(errors, 'Adapter setup/cleanup failures');
  }
}

describe('inactive actual React Git binding', () => {
  it('constructs without traffic and reads canonical same-snapshot admission', async () =>
    withAdapter(async (f) => {
      expect(f.calls).toEqual([]);
      expect(f.ports.readCurrentContext(id)).toBeNull();
      const context = f.grant();
      expect(context).not.toBeNull();
      expect(f.ports.readCurrentContext(id)).toBe(context);
      store.dispatch(principalContextChanged(null));
      expect(f.ports.readCurrentContext(id)).toBeNull();
      expect(f.calls).toEqual([]);
    }));
  it('attests without READ and releases a skipped probe without claiming a successful refresh', async () =>
    withAdapter(async (f) => {
      f.grant();
      const scope = await f.acquire();
      const { prepared } = await f.preparePr(scope);
      expect(prepared.provenance).toEqual({ physicalOwnerId: 'declared-owner' });
      expect(f.list(channels.READ)).toEqual([]);
      scope.release();
      expect(f.listeners.size).toBe(0);
      expect(f.list(channels.RELEASE_ORIGIN).map((x) => x.args)).toEqual([
        [{ originId: 'declared-origin' }],
      ]);
      expect(f.ports.readMetadata(id)).toEqual({
        lastRefreshTime: null,
        isRefreshing: false,
        lastError: null,
      });
    }));
  it('maps the same prepared child while its publication parent remains live until final release', async () =>
    withAdapter(async (f) => {
      f.grant();
      const scope = await f.acquire();
      const { prepared, ref } = await f.preparePr(scope);
      const pending = observe(prepared.read({ automatic: true }));
      expect((await f.next(channels.READ)).args).toEqual([
        { ...ref, operation: 'pr-refresh', automatic: true },
      ]);
      await f.read(ref, {
        outcome: 'linked',
        prNumber: 9,
        prUrl: 'https://example.test/pr/9',
        pullRequests: [],
      });
      expect(await pending).toEqual({
        status: 'fulfilled',
        value: {
          outcome: 'linked',
          prNumber: 9,
          prUrl: 'https://example.test/pr/9',
          prStatus: undefined,
          pullRequests: [],
        },
      });
      expect(scope.isCurrent()).toBe(true);
      expect(scope.signal.aborted).toBe(false);
      expect(f.list(channels.RELEASE).map((x) => x.args)).toEqual([[ref]]);
      expect(f.list(channels.RELEASE_ORIGIN)).toEqual([]);
      expect(f.ports.readMetadata(id).lastRefreshTime).toBeNull(); // Adapter does not own publication.
      scope.release();
      expect(f.list(channels.RELEASE_ORIGIN)).toHaveLength(1);
      expect(f.listeners.size).toBe(0);
    }));
  it('keeps refused acquisition distinct from successful empty data or freshness', async () =>
    withAdapter(async (f) => {
      f.grant();
      const pending = f.ports.acquire(id, f.controller.signal);
      await f.deliver(await f.next(channels.OBSERVE_ORIGIN), refused);
      expect(await pending).toEqual({ kind: 'unavailable' });
      expect(f.list(channels.PREPARE)).toEqual([]);
      expect(f.list(channels.READ)).toEqual([]);
      expect(f.ports.readMetadata(id).lastRefreshTime).toBeNull();
    }));
  it('retains canonical denial through mapper and full cleanup without granting metadata', async () =>
    withAdapter(async (f) => {
      f.grant();
      const scope = await f.acquire();
      const { prepared, ref } = await f.preparePr(scope);
      const pending = observe(prepared.read({ automatic: false }));
      await f.deliver(await f.next(channels.READ), {
        ok: true,
        result: {
          ref,
          current: true,
          settlement: {
            status: 'rejected',
            error: { code: 'FORBIDDEN', message: 'member required', rpcCode: -32003 },
          },
        },
      });
      const result = await pending;
      expect(result.status).toBe('rejected');
      if (result.status !== 'rejected') throw new Error('Expected original denial');
      expect(result.error).toMatchObject({ code: 'FORBIDDEN', message: 'member required' });
      expect(scope.isCurrent()).toBe(true);
      expect(scope.signal.aborted).toBe(false);
      expect(f.list(channels.RELEASE_ORIGIN)).toEqual([]);
      scope.release(); // Explicit publication owner finalizes the retained ordinary failure.
      expect(scope.isCurrent()).toBe(false);
      expect(f.list(channels.RELEASE_ORIGIN)).toHaveLength(1);
      expect(f.ports.readMetadata(id).lastRefreshTime).toBeNull();
    }));
});

// TTL-1 receiver boundary: actual React Store + canonical receiver + actual raw/adapter/preload.
// Non-Git startup owners are deliberately parked and all unrelated reads throw.
// This is not the separately held complete React lifecycle composition.
import { take, takeEvery, type SagaGenerator } from 'typed-redux-saga';
import { createAction } from '@themislib/themis/utils/store/create-action';
import type { GenericAction } from '@themislib/themis/types';
import { ClientLogger } from '$lib/utils/client-logger';
import { createLifecycleReadSaga } from '../../../../../src/store/renderer/slices/workspace-lifecycle/sagas/lifecycle-read-saga-factory';
import type { LifecycleReadDependencies } from '../../../../../src/store/renderer/slices/workspace-lifecycle/lifecycle-read-types';
import { selectHostRole } from '../../store/principal/principal-selectors';
import {
  selectWorkspaceById,
  selectWorkspaceListLoadedForBackend,
} from '../../store/workspace/workspace-selectors';
import {
  prStatusRefreshStarted,
  prStatusRefreshCompleted,
  prStatusScopedRefreshSucceeded,
  refreshPRStatusRequested,
} from '../../../../../src/store/renderer/slices/pr-status/pr-status-slice';
import { prBranchLookupSucceeded } from '../../../../../src/store/renderer/slices/pr-branch-lookup/pr-branch-lookup-slice';
const terminalFixtureStop = createAction('test/gitTerminalOwnerStop');
function unusedTerminalDependency(): never {
  throw new Error('Unrelated receiver dependency was reached');
}
function* parkedTerminalOwner(): SagaGenerator<void> {
  yield* take(terminalFixtureStop);
}
async function unexpectedTerminalRead(): Promise<never> {
  throw new Error('Unrelated client read was reached');
}
function startTerminalReceiver(f: Awaited<ReturnType<typeof setup>>) {
  const actions: GenericAction[] = [];
  const failureBoundary: Array<{ listeners: number; originReleases: number }> = [];
  const stopProbe = store.runSaga(function* terminalActionProbe(): SagaGenerator<void> {
    yield* takeEvery(
      [
        prStatusRefreshStarted,
        prStatusRefreshCompleted,
        prStatusScopedRefreshSucceeded,
        prBranchLookupSucceeded,
      ],
      function (action: GenericAction): void {
        actions.push(action);
        if (action.type === prStatusRefreshCompleted.type)
          failureBoundary.push({
            listeners: f.listeners.size,
            originReleases: f.list(channels.RELEASE_ORIGIN).length,
          });
      },
    );
  });
  f.releases.push(stopProbe); // Track this partial acquisition before starting the receiver.
  const unused = { effect: unusedTerminalDependency };
  const dependencies: LifecycleReadDependencies<typeof store.state, { requestId: string }> = {
    scopedGit: f.ports,
    appClient: {
      workspaces: { getContext: unexpectedTerminalRead, getTokenUsage: unexpectedTerminalRead },
      agents: { list: unexpectedTerminalRead, listWithMeta: unexpectedTerminalRead },
      tasks: { list: unexpectedTerminalRead, listAgentLinks: unexpectedTerminalRead },
      events: { queryPage: unexpectedTerminalRead },
      git: {
        status: unexpectedTerminalRead,
        trackedChanges: unexpectedTerminalRead,
        commitsWithBoundary: unexpectedTerminalRead,
        prRefresh: unexpectedTerminalRead,
      },
      scripts: { list: unexpectedTerminalRead },
      skills: { list: unexpectedTerminalRead },
      terminals: { list: unexpectedTerminalRead },
    },
    getAgentLineStats: unexpectedTerminalRead,
    beginScriptRead: unusedTerminalDependency,
    isScriptReadCurrent: unusedTerminalDependency,
    reconcileScriptRead: unusedTerminalDependency,
    refreshIntegrationAuthAfterReconnect: unusedTerminalDependency,
    workspaceAuthoritySaga: parkedTerminalOwner,
    createMembershipSaga: () => parkedTerminalOwner,
    selectors: {
      selectPrincipalActionContext,
      selectHostRole,
      selectWorkspaceById,
      selectWorkspaceListLoadedForBackend,
      selectCurrentWorkspaceTabId: unused,
      selectAllWorkspaceScriptEntries: unused,
      selectAgentSessionWorkspaceId: unused,
      selectAgentSession: unused,
      selectAgentSessionsById: unused,
      selectShouldRequestAgentLineStats: unused,
      selectPRStatusLastRefreshTime: unused,
      selectTerminalsForWorkspace: unused,
      selectActiveAgentId: unused,
      selectWorkspaceAgentIds: unused,
      selectAllWorkspaceAgents: unused,
      selectRetiredAgentsLoaded: unused,
      selectIsLoadingRetiredAgents: unused,
      selectDelegatedAgentsLoaded: unused,
      selectIsLoadingDelegatedAgents: unused,
      selectBackgroundAgentsLoaded: unused,
      selectIsLoadingBackgroundAgents: unused,
      selectOrphanedDelegatedAgentsLoaded: unused,
      selectIsLoadingOrphanedDelegatedAgents: unused,
      selectDelegatedParentLoaded: unused,
      selectIsLoadingDelegatedParent: unused,
      selectLoadedDelegatedParentIds: unused,
      selectScopeCounts: unused,
      selectDelegatedCounts: unused,
      selectScopeCountsGeneration: unused,
      selectOlderEventsNextToken: unused,
      selectDemandedTaskWorkspaceIds: unused,
      selectWorkspaceTasksShouldLoad: unused,
    },
  };
  const stop = store.runSaga(createLifecycleReadSaga(dependencies));
  f.releases.push(stop);
  return { actions, failureBoundary, stop, stopProbe };
}
async function admitTerminalRead(
  f: Awaited<ReturnType<typeof setup>>,
  index: number,
  originId: string,
) {
  await f.deliver(await f.next(channels.OBSERVE_ORIGIN, index), { ok: true, result: { originId } });
  const prepare = await f.next(channels.PREPARE, index);
  expect(prepare.args).toEqual([
    { originId, workspaceId: id, requestId: expect.any(String), operation: 'pr-refresh' },
  ]);
  const input = prepare.args[0];
  if (
    !input ||
    typeof input !== 'object' ||
    !('requestId' in input) ||
    typeof input.requestId !== 'string'
  )
    throw new Error('Expected original preparation tuple');
  const ref: WorkspaceLoadRouteRef = {
    originId,
    workspaceId: id,
    requestId: input.requestId,
    routeId: `terminal-route-${index}`,
  };
  await f.deliver(prepare, {
    ok: true,
    result: { ref, provenance: { physicalOwnerId: `declared-terminal-owner-${index}` } },
  });
  const read = await f.next(channels.READ, index);
  expect(read.args).toEqual([{ ...ref, operation: 'pr-refresh', automatic: true }]);
  return { ref, read };
}
const terminalDenial = {
  code: 'FORBIDDEN',
  message: 'member required',
  rpcCode: -32003,
  data: { code: 'FORBIDDEN' },
};
function deniedTerminalReply(ref: WorkspaceLoadRouteRef) {
  return {
    ok: true,
    result: { ref, current: true, settlement: { status: 'rejected', error: terminalDenial } },
  };
}

describe('current terminal PR rejection through actual React raw/adapter/receiver', () => {
  it('settles its started failure once with original error and no freshness or link renewal', async () =>
    withAdapter(async (f) => {
      const context = f.grant();
      if (!context) throw new Error('Real admission required');
      vi.spyOn(Date, 'now').mockReturnValue(1_000);
      store.dispatch(
        prStatusScopedRefreshSucceeded(id, {
          principalContext: context,
          physicalOwnerId: 'previous-owner',
        }),
      );
      const previous = f.ports.readMetadata(id);
      const logged = vi.spyOn(ClientLogger.prototype, 'error');
      const receiver = startTerminalReceiver(f);
      vi.mocked(Date.now).mockReturnValue(2_000);
      store.dispatch(refreshPRStatusRequested(id, true, false));
      const attempt = await admitTerminalRead(f, 0, 'terminal-origin-a');
      expect(f.ports.readMetadata(id).isRefreshing).toBe(true);
      expect(f.list(channels.RELEASE_ORIGIN)).toEqual([]);
      await f.deliver(attempt.read, deniedTerminalReply(attempt.ref));
      expect(
        receiver.actions
          .filter((a) => a.type === prStatusRefreshCompleted.type)
          .map((a) => a.payload),
      ).toEqual([{ wsId: id, success: false, error: 'member required', timestamp: 2_000 }]);
      expect(receiver.actions.filter((a) => a.type === prStatusRefreshStarted.type)).toHaveLength(
        1,
      );
      expect(receiver.failureBoundary).toEqual([{ listeners: 1, originReleases: 0 }]);
      expect(
        receiver.actions.some(
          (a) =>
            a.type === prStatusScopedRefreshSucceeded.type ||
            a.type === prBranchLookupSucceeded.type,
        ),
      ).toBe(false);
      expect(f.ports.readMetadata(id)).toEqual({
        ...previous,
        isRefreshing: false,
        lastError: 'member required',
      });
      const errors = logged.mock.calls.map((call) => call[1]);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toMatchObject(terminalDenial);
      expect(f.list(channels.RELEASE).map((call) => call.args)).toEqual([[attempt.ref]]);
      expect(f.list(channels.RELEASE_ORIGIN).map((call) => call.args)).toEqual([
        [{ originId: 'terminal-origin-a' }],
      ]);
      expect(f.listeners.size).toBe(0);
    }));
  it.each(['principal', 'origin', 'successor'] as const)(
    'suppresses old failure publication after %s retirement and preserves a newer attempt',
    async (boundary) =>
      withAdapter(async (f) => {
        f.grant();
        const oldReceiver = startTerminalReceiver(f);
        store.dispatch(refreshPRStatusRequested(id, true, false));
        const old = await admitTerminalRead(f, 0, 'terminal-origin-a');
        expect(f.ports.readMetadata(id).isRefreshing).toBe(true);
        if (boundary === 'principal') {
          store.dispatch(principalContextChanged(null));
          f.grant();
        } else if (boundary === 'origin')
          for (const listener of [...f.listeners.values()])
            listener({ kind: 'origin', originId: 'terminal-origin-a' });
        let nextReceiver = oldReceiver;
        if (boundary === 'successor') {
          // Replace only after stopping the sole old owner. Its late original reply arrives while B is loading.
          oldReceiver.stop();
          oldReceiver.stopProbe();
          nextReceiver = startTerminalReceiver(f);
        } else {
          // Exercise principal/physical retirement without stopping the receiver: cancellation cannot mask a broken fence.
          await f.deliver(old.read, deniedTerminalReply(old.ref));
          expect(
            oldReceiver.actions.filter((a) => a.type === prStatusRefreshCompleted.type),
          ).toEqual([]);
          expect(f.ports.readMetadata(id).isRefreshing).toBe(true);
        }
        expect(f.list(channels.RELEASE_ORIGIN).map((call) => call.args)).toEqual([
          [{ originId: 'terminal-origin-a' }],
        ]);
        store.dispatch(refreshPRStatusRequested(id, true, false));
        const next = await admitTerminalRead(f, 1, 'terminal-origin-b');
        if (boundary === 'successor') await f.deliver(old.read, deniedTerminalReply(old.ref)); // Original invoke, never a replacement promise.
        expect(oldReceiver.actions.filter((a) => a.type === prStatusRefreshCompleted.type)).toEqual(
          [],
        );
        expect(
          nextReceiver.actions.filter((a) => a.type === prStatusRefreshCompleted.type),
        ).toEqual([]);
        expect(f.ports.readMetadata(id).isRefreshing).toBe(true);
        expect(f.list(channels.RELEASE_ORIGIN).map((call) => call.args)).toEqual([
          [{ originId: 'terminal-origin-a' }],
        ]);
        await f.deliver(next.read, {
          ok: true,
          result: {
            ref: next.ref,
            current: true,
            settlement: { status: 'fulfilled', value: { outcome: 'skipped', pullRequests: [] } },
          },
        });
        expect(
          nextReceiver.actions.filter((a) => a.type === prStatusScopedRefreshSucceeded.type),
        ).toHaveLength(1);
        expect(f.ports.readMetadata(id).isRefreshing).toBe(false);
        expect(f.ports.readMetadata(id).lastError).toBeNull();
        expect(f.ports.readMetadata(id).refreshProvenance?.physicalOwnerId).toBe(
          'declared-terminal-owner-1',
        );
        expect(f.list(channels.RELEASE_ORIGIN).map((call) => call.args)).toEqual([
          [{ originId: 'terminal-origin-a' }],
          [{ originId: 'terminal-origin-b' }],
        ]);
        expect(f.listeners.size).toBe(0);
      }),
  );
});
