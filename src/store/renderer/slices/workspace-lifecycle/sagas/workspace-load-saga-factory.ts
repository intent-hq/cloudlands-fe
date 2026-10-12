import { buffers, eventChannel, type EventChannel, type Task } from 'redux-saga';
import { createChannelFromSelector, type SelectorChannelPayload } from '@themislib/themis/saga';
import {
  isAgentReadScopeCurrent,
  putAgentReadAction,
  type AgentReadScope,
} from '../../workspace-agents/sagas/agent-read-admission';
import type {
  WorkspaceLoadClients,
  WorkspaceLoadOptions,
  WorkspaceLoadReadScope,
  WorkspaceLoadRequestLifetime,
} from '../workspace-load-admission-types';
import {
  call,
  cancel,
  delay,
  fork,
  put,
  race,
  select,
  take,
  type SagaGenerator,
} from 'typed-redux-saga';

import {
  loadWorkspacesRequested,
  removeWorkspaceEntity,
  setWorkspaceEntity,
} from '../../workspace/workspace-slice';
import { closeWorkspaceTab } from '../../tab-state/tab-state-slice';
import { markWorkspaceNavigationInitialized } from '../../workspace-navigation/workspace-navigation-slice';
import type { Workspace } from '$shared/types';
import { WorkspaceId } from '$shared/types/branded-ids';
import {
  backendReconnected,
  workspaceDeleted,
  workspaceHydrationRequested,
  workspaceLoadCachedReady,
  workspaceLoadCancelled,
  workspaceLoadFailed,
  workspaceLoadOptimisticReady,
  workspaceLoadRequested,
  workspaceLoadStarted,
  workspaceLoadSucceeded,
  workspaceOpenFailed,
  workspaceOpenSucceeded,
  workspaceUnmounted,
} from '../workspace-lifecycle-slice';
/** Bind the canonical load owner; principal ports require genuine host/read provenance. */
export function createWorkspaceLoadSaga<State>(options: WorkspaceLoadOptions<State>) {
  const { selectWorkspaceById, selectIsWorkspaceSessionLive, selectWorkspaceLoadState } = options;
  type LoadOperation = WorkspaceLoadClients & { scope: AgentReadScope };
  const sourceOperation: LoadOperation | undefined =
    options.admission.kind === 'source'
      ? {
          scope: options.admission,
          workspaceClient: options.workspaceClient!,
          appClient: options.appClient!,
        }
      : undefined;

  const NOT_FOUND_RETRY_DELAY_MS = 500;

  // Anchored to the workspace subject (monorepo#3787): a generic backend error
  // that merely contains "not found" (e.g. "git binary not found") must not be
  // classified as workspace-not-found — that classification feeds the
  // destructive path (closeWorkspaceTab + removeWorkspaceEntity). Covers the
  // daemon's actual missing-workspace phrasings: the workspace.* router mapping
  // and FE IPC fold ("Workspace not found"), id-suffixed variants
  // ("Workspace not found: {id}"), and the generic domain-error display
  // ("not found: workspace {id}"). The `[^:]*` barrier keeps a prefixed cause
  // like "failed to open workspace: <tool> not found" out of the match.
  function isNotFoundError(error: string): boolean {
    const normalized = error
      .toLowerCase()
      .replace(/[\s_-]+/g, ' ')
      .trim();
    return (
      /\bworkspace\b[^:]*\b(?:not found|does not exist)\b/.test(normalized) ||
      /\bnot found: workspace\b/.test(normalized)
    );
  }

  function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  function* isLoadInvalidated(workspaceId: string): SagaGenerator<boolean> {
    const state = yield* select(selectWorkspaceLoadState.select, workspaceId);
    return state.status === 'idle';
  }

  type ObservedAction = { type: string; payload?: unknown };

  function isWorkspaceDetailInvalidation(action: ObservedAction, workspaceId: string): boolean {
    if (action.type === backendReconnected.type) return true;
    if (
      action.type !== removeWorkspaceEntity.type &&
      action.type !== workspaceDeleted.type &&
      action.type !== workspaceUnmounted.type
    ) {
      return false;
    }
    return Array.isArray(action.payload) && action.payload[0] === workspaceId;
  }

  function workspacePathsMatch(left: Workspace, right: Workspace): boolean {
    return (
      left.path === right.path &&
      left.repositoryPath === right.repositoryPath &&
      left.worktreePath === right.worktreePath
    );
  }

  function* hydrateOptionalWorkspaceDetail(
    workspaceId: string,
    openedWorkspace: Workspace,
    operation: LoadOperation = sourceOperation!,
  ): SagaGenerator<void> {
    const { appClient, scope } = operation;
    try {
      const { hydratedWorkspace, invalidated } = yield* race({
        hydratedWorkspace:
          scope.kind === 'source'
            ? call([appClient.workspaces, appClient.workspaces.get], workspaceId)
            : call(async () => {
                if (!isAgentReadScopeCurrent(scope)) return null;
                return appClient.workspaces.get(workspaceId);
              }),
        invalidated: take((action: ObservedAction) =>
          isWorkspaceDetailInvalidation(action, workspaceId),
        ),
      });
      if (!isAgentReadScopeCurrent(scope) || invalidated || !hydratedWorkspace) return;

      const current = yield* select(selectWorkspaceById.select, workspaceId);
      if (!current || !workspacePathsMatch(current, openedWorkspace)) return;

      yield* putAgentReadAction(
        scope,
        setWorkspaceEntity({
          ...current,
          path: hydratedWorkspace.path,
          repositoryPath: hydratedWorkspace.repositoryPath,
          worktreePath: hydratedWorkspace.worktreePath,
        }),
      );
    } catch {
      // Opening succeeded; path-dependent consumers retain their own missing/error states.
    }
  }

  type ActiveWorkspaceLoad = {
    workspaceId: string;
    task?: Task;
    succeeded: boolean;
    request?: WorkspaceLoadRequestLifetime;
    operation?: LoadOperation;
    cancelOnSupersession?: boolean;
  };

  function* loadWorkspace(
    action: ReturnType<typeof workspaceLoadRequested>,
    slot: ActiveWorkspaceLoad,
    operation: LoadOperation,
  ): SagaGenerator<void> {
    const { workspaceClient, scope } = operation;
    const workspaceId = action.payload[0];
    if (workspaceId.startsWith('optimistic-')) {
      if (!(yield* putAgentReadAction(scope, workspaceLoadOptimisticReady(workspaceId)))) return;
      return;
    }

    // Principal mode cannot treat an unversioned entity/live phase as an admitted
    // read. Keep source fast paths/fallbacks; principal loads require scoped open.
    const cached =
      scope.kind === 'source' ? yield* select(selectWorkspaceById.select, workspaceId) : undefined;
    const live =
      scope.kind === 'source'
        ? yield* select(selectIsWorkspaceSessionLive.select, workspaceId)
        : false;
    if (cached && live) {
      if (!(yield* putAgentReadAction(scope, workspaceLoadSucceeded(workspaceId)))) return;
      slot.succeeded = true;
      if (!(yield* putAgentReadAction(scope, markWorkspaceNavigationInitialized(workspaceId))))
        return;
      return;
    }
    if (!(yield* putAgentReadAction(scope, workspaceLoadStarted(workspaceId)))) return;
    if (cached && !(yield* putAgentReadAction(scope, workspaceLoadCachedReady(workspaceId))))
      return;

    if (!(yield* putAgentReadAction(scope, workspaceHydrationRequested(workspaceId)))) return;
    try {
      let result = (
        scope.kind === 'source'
          ? yield* call([workspaceClient, workspaceClient.open], WorkspaceId(workspaceId))
          : yield* call(async () => {
              if (!isAgentReadScopeCurrent(scope)) return undefined;
              return workspaceClient.open(WorkspaceId(workspaceId));
            })
      )!;
      if (scope.kind === 'principal' && (!isAgentReadScopeCurrent(scope) || !result)) return;
      if (yield* isLoadInvalidated(workspaceId)) return;
      if (!result.ok && isNotFoundError(result.error)) {
        if (!(yield* putAgentReadAction(scope, loadWorkspacesRequested()))) return;
        yield* delay(NOT_FOUND_RETRY_DELAY_MS);
        if (yield* isLoadInvalidated(workspaceId)) return;
        result = (
          scope.kind === 'source'
            ? yield* call([workspaceClient, workspaceClient.open], WorkspaceId(workspaceId))
            : yield* call(async () => {
                if (!isAgentReadScopeCurrent(scope)) return undefined;
                return workspaceClient.open(WorkspaceId(workspaceId));
              })
        )!;
        if (scope.kind === 'principal' && (!isAgentReadScopeCurrent(scope) || !result)) return;
        if (yield* isLoadInvalidated(workspaceId)) return;
      }

      if (!result.ok) {
        const notFound = isNotFoundError(result.error);
        if (notFound) {
          if (!(yield* putAgentReadAction(scope, closeWorkspaceTab(workspaceId)))) return;
          if (!(yield* putAgentReadAction(scope, removeWorkspaceEntity(workspaceId)))) return;
        } else if (cached) {
          if (!(yield* putAgentReadAction(scope, workspaceOpenFailed(workspaceId)))) return;
          return;
        }
        if (
          !(yield* putAgentReadAction(
            scope,
            workspaceLoadFailed(workspaceId, {
              kind: notFound ? 'not_found' : 'error',
              message: result.error,
            }),
          ))
        )
          return;
        if (!(yield* putAgentReadAction(scope, workspaceOpenFailed(workspaceId)))) return;
        return;
      }

      const workspace = result.data;
      if (!(yield* putAgentReadAction(scope, setWorkspaceEntity(workspace)))) return;
      if (yield* isLoadInvalidated(workspaceId)) return;
      if (!(yield* putAgentReadAction(scope, workspaceOpenSucceeded(workspaceId)))) return;
      if (!(yield* putAgentReadAction(scope, workspaceLoadSucceeded(workspaceId)))) return;
      slot.succeeded = true;
      if (!(yield* putAgentReadAction(scope, markWorkspaceNavigationInitialized(workspaceId))))
        return;
      if (!workspace.repositoryPath) {
        if (scope.kind === 'source') {
          yield* call(hydrateOptionalWorkspaceDetail, workspaceId, workspace);
        } else {
          yield* call(hydrateOptionalWorkspaceDetail, workspaceId, workspace, operation);
        }
      }
    } catch (error) {
      if (!isAgentReadScopeCurrent(scope)) return;
      if (yield* isLoadInvalidated(workspaceId)) return;
      if (cached) {
        if (!(yield* putAgentReadAction(scope, workspaceOpenFailed(workspaceId)))) return;
        return;
      }
      if (
        !(yield* putAgentReadAction(
          scope,
          workspaceLoadFailed(workspaceId, { kind: 'error', message: errorMessage(error) }),
        ))
      )
        return;
      if (!(yield* putAgentReadAction(scope, workspaceOpenFailed(workspaceId)))) return;
    }
  }

  function isRequestCurrent(request: WorkspaceLoadRequestLifetime): boolean {
    return !request.signal.aborted && request.isCurrent();
  }

  function observeAbort(signal: AbortSignal): EventChannel<true> {
    return eventChannel<true>((emit) => {
      const aborted = () => emit(true);
      signal.addEventListener('abort', aborted);
      // Subscribe first: retirement during listener setup must not be lost.
      if (signal.aborted) aborted();
      return () => signal.removeEventListener('abort', aborted);
    }, buffers.sliding(1));
  }

  function* waitForAuthorityLoss(
    channel: EventChannel<SelectorChannelPayload<string | null>>,
    scope: AgentReadScope,
  ) {
    while (isAgentReadScopeCurrent(scope)) yield* take(channel);
  }

  function* loadAdmittedWorkspace(
    action: ReturnType<typeof workspaceLoadRequested>,
    slot: ActiveWorkspaceLoad,
  ): SagaGenerator<void> {
    if (options.admission.kind === 'source') {
      // Direct delegation preserves the original worker's source effect order.
      yield* loadWorkspace(action, slot, sourceOperation!);
      return;
    }
    const admission = options.admission;
    const request = slot.request;
    if (!request || !isRequestCurrent(request)) return;
    let requestAborted: EventChannel<true> | undefined;
    let readAborted: EventChannel<true> | undefined;
    let contextChannel: EventChannel<SelectorChannelPayload<string | null>> | undefined;
    let reads: WorkspaceLoadReadScope | null = null;
    try {
      requestAborted = yield* call(observeAbort, request.signal);
      contextChannel = yield* createChannelFromSelector(admission.contextSelector);
      const channel = contextChannel;
      const { context } = yield* race({
        invalidated: take(requestAborted),
        context: call(function* waitForContext() {
          while (isRequestCurrent(request)) {
            const current = admission.readCurrentContext();
            if (current !== null) return current;
            yield* take(channel);
          }
          return null;
        }),
      });
      if (context == null) return;
      reads = yield* call(() => {
        if (!isRequestCurrent(request) || admission.readCurrentContext() !== context) return null;
        return request.acquireReadScope(context);
      });
      // Null acquisition is terminal refusal, not another readiness wait. An
      // acquired but rejected lease still belongs to this finally for release.
      if (!reads || reads.requestIdentity !== request.identity || reads.context !== context) return;
      const acquired = reads;
      const scope: AgentReadScope = {
        kind: 'principal',
        context,
        readCurrentContext: () =>
          isRequestCurrent(request) && !acquired.signal.aborted && acquired.isCurrent()
            ? admission.readCurrentContext()
            : null,
        dispatch: admission.dispatch,
      };
      if (!isAgentReadScopeCurrent(scope)) return;
      const operation: LoadOperation = {
        workspaceClient: acquired.workspaceClient,
        appClient: acquired.appClient,
        scope,
      };
      slot.operation = operation;
      readAborted = yield* call(observeAbort, acquired.signal);
      if (!isAgentReadScopeCurrent(scope)) return;
      yield* race({
        requestLost: take(requestAborted),
        readLost: take(readAborted),
        authorityLost: call(waitForAuthorityLoss, channel, scope),
        load: call(loadWorkspace, action, slot, operation),
      });
    } finally {
      try {
        // Check while still leased. Never let an old same-id cancellation clear
        // replacement state; source cancellation remains watcher-owned below.
        if (slot.cancelOnSupersession && !slot.succeeded && slot.operation) {
          yield* putAgentReadAction(slot.operation.scope, workspaceLoadCancelled(slot.workspaceId));
        }
      } finally {
        requestAborted?.close();
        readAborted?.close();
        contextChannel?.close();
        reads?.release();
      }
    }
  }

  return function* workspaceLoadSaga(): SagaGenerator<void> {
    let active: ActiveWorkspaceLoad | undefined;
    while (true) {
      const action = yield* take(workspaceLoadRequested);
      const workspaceId = action.payload[0];
      const request =
        options.admission.kind === 'principal'
          ? options.admission.captureRequest(action as ReturnType<typeof workspaceLoadRequested>)
          : undefined;
      if (
        options.admission.kind === 'principal' &&
        (!request || request.workspaceId !== workspaceId || !isRequestCurrent(request))
      ) {
        continue;
      }
      const activeTask = active?.task;
      if (active && activeTask?.isRunning()) {
        if (
          active.workspaceId === workspaceId &&
          (options.admission.kind === 'source' ||
            (active.request &&
              request &&
              active.request.identity === request.identity &&
              isRequestCurrent(active.request) &&
              (!active.operation || isAgentReadScopeCurrent(active.operation.scope))))
        ) {
          continue;
        }
        const stale = active;
        if (options.admission.kind === 'principal') {
          stale.cancelOnSupersession = stale.workspaceId !== workspaceId;
        }
        yield* cancel(activeTask);
        if (options.admission.kind === 'source' && !stale.succeeded) {
          yield* put(workspaceLoadCancelled(stale.workspaceId));
        }
      }

      const slot: ActiveWorkspaceLoad = {
        workspaceId,
        succeeded: false,
        request: request ?? undefined,
      };
      active = slot;
      const task = yield* fork(function* activeWorkspaceLoad() {
        try {
          yield* loadAdmittedWorkspace(action as ReturnType<typeof workspaceLoadRequested>, slot);
        } finally {
          if (active === slot) active = undefined;
        }
      });
      slot.task = task;
      if (!task.isRunning() && active === slot) active = undefined;
    }
  };
}
