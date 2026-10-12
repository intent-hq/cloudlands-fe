import { buffers, eventChannel } from 'redux-saga';
import {
  actionChannel,
  call,
  fork,
  getContext,
  put,
  race,
  take,
  type SagaGenerator,
} from 'typed-redux-saga';
import { CURRENT_WORKSPACE_TAB_SELECTION_ACTIONS } from '../../tab-state/tab-state-slice';
import {
  workspaceDeleted,
  workspaceLoadRequested,
  workspaceUnmounted,
} from '../workspace-lifecycle-slice';
import { createWorkspaceLoadOriginOwner } from '../workspace-load-origin-owner';
import type {
  OriginWorkspaceTabCleanupOptions,
  PreparedWorkspaceLoadOrigin,
  SourceWorkspaceTabCleanupOptions,
  WorkspaceLoadOriginIntent,
  WorkspaceLoadOriginPort,
  WorkspaceOriginQueueItem,
  WorkspaceOriginReduxContext,
  WorkspaceOriginState,
} from '../workspace-load-origin-types';

/** One canonical tab lifetime owner; omitted kind preserves the original source behavior. */
export function createWorkspaceTabCleanupSaga<
  State extends WorkspaceOriginState = WorkspaceOriginState,
>(options: SourceWorkspaceTabCleanupOptions | OriginWorkspaceTabCleanupOptions<State>) {
  if (options.kind === 'origin') {
    const originOptions = options;
    return function* workspaceTabCleanupSaga(): SagaGenerator<void> {
      const redux = yield* getContext<WorkspaceOriginReduxContext<State>>('reduxStore');
      const owner = createWorkspaceLoadOriginOwner(() => redux.getState());
      let stopped = false;
      let unbind: (() => void) | undefined;
      let unsubscribe: (() => void) | undefined;
      let enqueue!: (item: WorkspaceOriginQueueItem) => void;
      const queue = eventChannel<WorkspaceOriginQueueItem>((emit) => {
        enqueue = (item) => {
          if (!stopped) emit(item);
        };
        return () => {};
      }, buffers.expanding());
      const submitted = new WeakSet<object>();
      // Cleanup receipts owned by this saga, not a second canonical membership map.
      const cleaned = new Map<
        string,
        { serial: number | undefined; jointIdentity: object | undefined }
      >();
      let observed: State['tabState']['workspaceTabAcquisitions'] | undefined;
      let focused: string | null = null;

      function schedule(intent: WorkspaceLoadOriginIntent | null) {
        if (!intent || stopped) return false;
        if (!submitted.has(intent.lifetime.identity)) {
          submitted.add(intent.lifetime.identity);
          enqueue({ kind: 'load', intent });
        }
        return true;
      }
      const port: WorkspaceLoadOriginPort = {
        submit: (workspaceId, authority) =>
          stopped ? false : schedule(owner.begin(workspaceId, authority)),
        captureRequest: (action) => owner.captureRequest(action),
      };

      function observe() {
        if (stopped) return;
        owner.observeAcceptedState(); // Abort callbacks can reenter. Read again afterwards.
        if (stopped) return;
        const state = redux.getState();
        const next = state.tabState.workspaceTabAcquisitions;
        const nextFocused = state.tabState.currentTabId;
        const previous = observed;
        const previousFocused = focused;
        observed = next;
        focused = nextFocused;
        const events: Extract<WorkspaceOriginQueueItem, { kind: 'cleanup' }>[] = [];
        // Initial live phases have no receipt from this owner and must pass a cold barrier.
        const ids = new Set([
          ...Object.keys(previous?.serialByWorkspaceId ?? {}),
          ...Object.keys(next.serialByWorkspaceId),
        ]);
        for (const id of ids) {
          const oldSerial =
            previous && Object.hasOwn(previous.serialByWorkspaceId, id)
              ? previous.serialByWorkspaceId[id]
              : undefined;
          const serial = owner.readAcceptedSerial(id);
          if (!previous || oldSerial !== serial) {
            events.push({
              kind: 'cleanup',
              workspaceId: id,
              successorSerial: serial,
              jointIdentity: undefined,
            });
          }
        }
        // Bind the original request before emitting anything that can resume the worker.
        let intent: WorkspaceLoadOriginIntent | null = null;
        if (nextFocused) {
          const serial = owner.readAcceptedSerial(nextFocused);
          const priorSerial =
            previous && Object.hasOwn(previous.serialByWorkspaceId, nextFocused)
              ? previous.serialByWorkspaceId[nextFocused]
              : undefined;
          const fresh = !previous || priorSerial !== serial;
          if (
            serial !== undefined &&
            (fresh || nextFocused !== previousFocused) &&
            (fresh || !originOptions.selectIsWorkspaceSessionLive.select(state, nextFocused))
          ) {
            const authority = originOptions.readReadyAuthority(nextFocused);
            if (authority) intent = owner.begin(nextFocused, authority, serial);
          }
        }
        // All observation bookkeeping is committed before any reentrant emission/dispatch.
        const capturedEvents = events.map((item) => ({
          ...item,
          jointIdentity: owner.readJointIdentity(item.workspaceId),
        }));
        for (const item of capturedEvents) enqueue(item);
        schedule(intent);
      }

      function* clean(
        workspaceId: string,
        serial: number | undefined,
        jointIdentity: object | undefined,
      ): SagaGenerator<boolean> {
        return yield* call(() => {
          const current = () => {
            const joint = owner.readJointIdentity(workspaceId);
            return (
              !stopped &&
              joint === jointIdentity &&
              owner.readAcceptedSerial(workspaceId) === serial
            );
          };
          if (!current()) return false;
          const receipt = cleaned.get(workspaceId);
          if (receipt && receipt.serial === serial && receipt.jointIdentity === jointIdentity)
            return true;
          // Raw Redux dispatch is synchronous. No queued put may outlive this ownership check.
          if (!current()) return false;
          redux.dispatch(workspaceUnmounted(workspaceId));
          if (!current()) return false;
          cleaned.set(workspaceId, { serial, jointIdentity });
          return true;
        });
      }

      function* prepare(intent: WorkspaceLoadOriginIntent): SagaGenerator<void> {
        const request = intent.lifetime;
        let accepting = true;
        let transferred = false;
        const result: { unclaimed: PreparedWorkspaceLoadOrigin | null } = { unclaimed: null };
        const aborted = eventChannel<true>((emit) => {
          const onAbort = () => emit(true);
          request.signal.addEventListener('abort', onAbort);
          if (request.signal.aborted) onAbort();
          return () => request.signal.removeEventListener('abort', onAbort);
        }, buffers.sliding(1));
        try {
          if (!request.isCurrent()) return;
          // This promise retains the original intent even after saga cancellation.
          const pending = intent.authority.prepare(request).then((value) => {
            if (!accepting || !request.isCurrent()) {
              value?.release();
              return null;
            }
            result.unclaimed = value;
            return value;
          });
          const { prepared } = yield* race({
            retired: take(aborted),
            prepared: call(() => pending),
          });
          if (!prepared) return;
          result.unclaimed = null; // installPrepared owns release on both success and refusal.
          if (intent.installPrepared(prepared)) {
            transferred = true;
            yield* call(enqueue, { kind: 'prepared' as const, intent });
          }
        } catch (error) {
          // A stale preparation error is not a current load failure and cannot clear its successor.
          if (request.isCurrent()) {
            transferred = true;
            yield* call(enqueue, { kind: 'preparationFailed' as const, intent, error });
          }
        } finally {
          accepting = false;
          result.unclaimed?.release();
          aborted.close();
          if (!transferred) intent.retire();
        }
      }

      try {
        unsubscribe = redux.subscribe(observe);
        observe();
        unbind = originOptions.bind(port);
        while (true) {
          const item = yield* take(queue);
          if (item.kind === 'cleanup') {
            yield* clean(item.workspaceId, item.successorSerial, item.jointIdentity);
            continue;
          }
          const { intent } = item;
          if (item.kind === 'load') {
            if (
              !intent.lifetime.isCurrent() ||
              !(yield* clean(intent.lifetime.workspaceId, intent.serial, intent.jointIdentity))
            ) {
              intent.retire();
              continue;
            }
            // Attached preparation can wait on I/O; this sole queue keeps draining teardown.
            yield* fork(prepare, intent);
            continue;
          }
          let published = false;
          try {
            if (!intent.lifetime.isCurrent()) continue;
            if (!(yield* clean(intent.lifetime.workspaceId, intent.serial, intent.jointIdentity)))
              continue;
            if (!intent.lifetime.isCurrent()) continue;
            if (item.kind === 'preparationFailed') throw item.error;
            // Only this worker can authorize b0 capture, after cleanup and preparation.
            published = yield* call(() => {
              const receipt = cleaned.get(intent.lifetime.workspaceId);
              if (
                !receipt ||
                receipt.serial !== intent.serial ||
                receipt.jointIdentity !== intent.jointIdentity ||
                !intent.lifetime.isCurrent() ||
                !intent.authorizePublication()
              )
                return false;
              // Check and synchronous dispatch share one call frame, including nested dispatch.
              redux.dispatch(intent.action);
              return intent.lifetime.isCurrent();
            });
          } finally {
            if (!published) intent.retire();
          }
        }
      } finally {
        stopped = true;
        // Retire while load receivers and the actual Store still exist.
        owner.dispose();
        unsubscribe?.();
        queue.close();
        unbind?.();
      }
    };
  }
  const { selectCurrentWorkspaceTabId, selectActiveWorkspaceIds, selectIsWorkspaceSessionLive } =
    options;
  return function* workspaceTabCleanupSaga(): SagaGenerator<void> {
    const lifecycleChanges = yield* actionChannel(
      [...CURRENT_WORKSPACE_TAB_SELECTION_ACTIONS, workspaceDeleted],
      buffers.expanding(),
    );
    let previousFocusedId = yield* selectCurrentWorkspaceTabId.effect();
    let previousIds = yield* selectActiveWorkspaceIds.effect();
    const unmountedWorkspaceIds = new Set<string>();

    try {
      if (previousFocusedId && !(yield* selectIsWorkspaceSessionLive.effect(previousFocusedId))) {
        yield* put(workspaceLoadRequested(previousFocusedId));
      }

      while (true) {
        const action = yield* take(lifecycleChanges);
        const currentFocusedId = yield* selectCurrentWorkspaceTabId.effect();
        const currentIds = yield* selectActiveWorkspaceIds.effect();
        const currentIdSet = new Set(currentIds);
        const focusChanged = currentFocusedId !== previousFocusedId;
        const unmountedIds = new Set<string>();

        // Focus changes keep the previous workspace session warm. Teardown is
        // reserved for tabs that disappear or workspaces that are deleted.
        for (const workspaceId of previousIds) {
          if (!currentIdSet.has(workspaceId)) unmountedIds.add(workspaceId);
        }
        if (action.type === workspaceDeleted.type) {
          unmountedIds.add((action as ReturnType<typeof workspaceDeleted>).payload[0]);
        }

        previousFocusedId = currentFocusedId;
        previousIds = currentIds;

        for (const workspaceId of unmountedIds) {
          if (unmountedWorkspaceIds.has(workspaceId)) continue;
          unmountedWorkspaceIds.add(workspaceId);
          yield* put(workspaceUnmounted(workspaceId));
        }
        if (focusChanged && currentFocusedId) {
          unmountedWorkspaceIds.delete(currentFocusedId);
          if (!(yield* selectIsWorkspaceSessionLive.effect(currentFocusedId))) {
            yield* put(workspaceLoadRequested(currentFocusedId));
          }
        }
      }
    } finally {
      lifecycleChanges.close();
    }
  };
}
