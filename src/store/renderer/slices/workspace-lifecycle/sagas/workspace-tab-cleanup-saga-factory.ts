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
  OwnedWorkspaceOriginAuthority,
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
      const observation = originOptions.observation;
      type Freshness = { context: string | null; retired: boolean };
      type Attempt = {
        workspaceId: string;
        serial: number;
        controller: AbortController;
        freshness: Freshness;
      };
      type Completion = Extract<
        WorkspaceOriginQueueItem,
        { kind: 'prepared' | 'preparationFailed' }
      >;
      type QueueItem =
        | WorkspaceOriginQueueItem
        | { kind: 'wake' }
        | { kind: 'observe'; attempt: Attempt }
        | { kind: 'observed'; attempt: Attempt; authority: OwnedWorkspaceOriginAuthority | null };
      let enqueue!: (item: QueueItem) => void;
      const queue = eventChannel<QueueItem>((emit) => {
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
      let observing: Attempt | undefined;
      let trailing = false;
      const queuedCaptures = new Set<OwnedWorkspaceOriginAuthority>();
      const held = new Map<WorkspaceLoadOriginIntent, Completion>();
      const captures = new Map<
        WorkspaceLoadOriginIntent,
        {
          freshness: Freshness;
          published: boolean;
          release(): void;
        }
      >();

      function fresh(value: Freshness): boolean {
        if (stopped || value.retired) return false;
        const context = observation!.readCurrentContext();
        if (value.context !== null && context !== value.context) {
          value.retired = true;
          // The aborted observation still owns its pending demand until its queue item drains.
          // Clear only at first principal loss; a later genuine wake may request a fresh attempt.
          if (observing?.freshness === value) trailing = false;
        } else if (context !== null) value.context = context;
        return !stopped && !value.retired;
      }
      function intentCurrent(intent: WorkspaceLoadOriginIntent): boolean {
        const capture = captures.get(intent);
        if (capture && !capture.published && !fresh(capture.freshness)) intent.retire();
        return intent.lifetime.isCurrent();
      }
      function attemptCurrent(attempt: Attempt): boolean {
        return (
          !stopped &&
          observing === attempt &&
          fresh(attempt.freshness) &&
          !attempt.controller.signal.aborted &&
          owner.readAcceptedSerial(attempt.workspaceId) === attempt.serial &&
          redux.getState().tabState.currentTabId === attempt.workspaceId
        );
      }
      function abortObservation(attempt: Attempt) {
        if (attempt.controller.signal.aborted) return;
        attempt.controller.abort();
      }
      function requestObservation() {
        if (!observation || stopped) return;
        if (observing) {
          trailing = true;
          return;
        }
        const state = redux.getState();
        const workspaceId = state.tabState.currentTabId;
        if (!workspaceId) return;
        const serial = owner.readAcceptedSerial(workspaceId);
        if (
          serial === undefined ||
          originOptions.selectIsWorkspaceSessionLive.select(state, workspaceId)
        )
          return;
        for (const intent of captures.keys()) {
          if (
            intent.lifetime.workspaceId === workspaceId &&
            intent.serial === serial &&
            intentCurrent(intent)
          )
            return;
        }
        const attempt: Attempt = {
          workspaceId,
          serial,
          controller: new AbortController(),
          freshness: { context: observation.readCurrentContext(), retired: false },
        };
        observing = attempt; // Identity and ordinal are captured before the attached worker can await.
        if (!attemptCurrent(attempt)) {
          observing = undefined;
          abortObservation(attempt);
          return;
        }
        enqueue({ kind: 'observe', attempt });
      }
      function reconcileObservation() {
        if (!observation) return;
        if (observing && !attemptCurrent(observing)) abortObservation(observing);
        for (const intent of [...captures.keys()]) intentCurrent(intent);
        for (const [intent, completion] of held) {
          if (!intentCurrent(intent)) {
            held.delete(intent);
            continue;
          }
          if (redux.getState().tabState.currentTabId === intent.lifetime.workspaceId) {
            held.delete(intent);
            enqueue(completion);
          }
        }
      }
      function ownCapture(
        intent: WorkspaceLoadOriginIntent,
        authority: OwnedWorkspaceOriginAuthority,
        freshness: Freshness,
      ) {
        let released = false;
        const capture = {
          freshness,
          published: false,
          release() {
            if (released) return;
            released = true;
            captures.delete(intent);
            held.delete(intent);
            intent.lifetime.signal.removeEventListener('abort', capture.release);
            authority.release();
          },
        };
        captures.set(intent, capture);
        intent.lifetime.signal.addEventListener('abort', capture.release, { once: true });
        if (!intentCurrent(intent) || intent.lifetime.signal.aborted) capture.release();
      }
      function park(completion: Completion): boolean {
        if (
          !observation ||
          redux.getState().tabState.currentTabId === completion.intent.lifetime.workspaceId
        )
          return false;
        if (intentCurrent(completion.intent)) held.set(completion.intent, completion);
        return true;
      }
      function* observePhysical(attempt: Attempt): SagaGenerator<void> {
        let handedOff = false;
        let accepting = true;
        const result: { value: OwnedWorkspaceOriginAuthority | null } = { value: null };
        try {
          if (!attemptCurrent(attempt)) return;
          const pending = observation!.observe(attempt.controller.signal).then((authority) => {
            if (!accepting || !attemptCurrent(attempt)) {
              authority?.release();
              return null;
            }
            result.value = authority;
            return authority;
          });
          const authority = yield* call(() => pending);
          if (!attemptCurrent(attempt)) return;
          // Queue owns this result from now on, even when its cleanup work is busy.
          if (authority) queuedCaptures.add(authority);
          result.value = null;
          handedOff = true;
          enqueue({ kind: 'observed', attempt, authority });
        } catch {
          // A refused observation grants no request; only a later genuine wake may retry.
        } finally {
          accepting = false;
          result.value?.release();
          if (!handedOff) {
            abortObservation(attempt);
            enqueue({ kind: 'observed', attempt, authority: null });
          }
        }
      }
      function* watchObservationWakes(): SagaGenerator<void> {
        const wakes = yield* actionChannel(observation!.wakeAction, buffers.sliding(1));
        try {
          while (true) {
            yield* take(wakes);
            enqueue({ kind: 'wake' });
          }
        } finally {
          wakes.close();
        }
      }

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
          stopped || observation ? false : schedule(owner.begin(workspaceId, authority)),
        captureRequest: (action) => {
          if (
            observation &&
            ![...captures].some(
              ([intent, capture]) => intent.action === action && capture.published,
            )
          )
            return null;
          return owner.captureRequest(action);
        },
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
        if (nextFocused && !observation) {
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
        if (observation) {
          reconcileObservation();
          const serial = nextFocused ? owner.readAcceptedSerial(nextFocused) : undefined;
          const priorSerial = nextFocused ? previous?.serialByWorkspaceId[nextFocused] : undefined;
          if (
            nextFocused &&
            (!previous || nextFocused !== previousFocused || serial !== priorSerial)
          )
            requestObservation();
        }
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
          if (!intentCurrent(intent)) return;
          // This promise retains the original intent even after saga cancellation.
          const pending = intent.authority.prepare(request).then((value) => {
            if (!accepting || !intentCurrent(intent)) {
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
          if (intentCurrent(intent)) {
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
        if (observation) yield* fork(watchObservationWakes);
        unsubscribe = redux.subscribe(observe);
        observe();
        unbind = originOptions.bind(port);
        while (true) {
          const item = yield* take(queue);
          if (item.kind === 'wake') {
            reconcileObservation();
            requestObservation();
            continue;
          }
          if (item.kind === 'observe') {
            yield* fork(observePhysical, item.attempt);
            continue;
          }
          if (item.kind === 'observed') {
            const { attempt, authority } = item;
            if (authority) queuedCaptures.delete(authority);
            let transferred = false;
            try {
              if (authority && attemptCurrent(attempt)) {
                const intent = owner.begin(attempt.workspaceId, authority, attempt.serial);
                if (intent) {
                  ownCapture(intent, authority, attempt.freshness);
                  transferred = true;
                  // begin and authority getters can synchronously close/refocus the tab.
                  if (attemptCurrent(attempt) && intentCurrent(intent)) schedule(intent);
                  else intent.retire();
                }
              }
            } finally {
              if (!transferred) authority?.release();
              if (observing === attempt) {
                observing = undefined;
                const again = trailing;
                trailing = false;
                if (again) requestObservation();
              }
            }
            continue;
          }
          if (item.kind === 'cleanup') {
            yield* clean(item.workspaceId, item.successorSerial, item.jointIdentity);
            continue;
          }
          const { intent } = item;
          if (item.kind === 'load') {
            if (
              !intentCurrent(intent) ||
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
          let parked = false;
          try {
            if (observation && park(item)) {
              parked = true;
              continue;
            }
            if (!intentCurrent(intent)) continue;
            if (!(yield* clean(intent.lifetime.workspaceId, intent.serial, intent.jointIdentity)))
              continue;
            if (!intentCurrent(intent)) continue;
            if (observation && park(item)) {
              parked = true;
              continue;
            }
            if (item.kind === 'preparationFailed') throw item.error;
            // Only this worker can authorize b0 capture, after cleanup and preparation.
            published = yield* call(() => {
              const receipt = cleaned.get(intent.lifetime.workspaceId);
              if (
                !receipt ||
                receipt.serial !== intent.serial ||
                receipt.jointIdentity !== intent.jointIdentity ||
                !intentCurrent(intent) ||
                !intent.authorizePublication()
              )
                return false;
              if (observation) {
                if (!intentCurrent(intent)) return false;
                if (park(item)) {
                  parked = true;
                  return false;
                }
                const capture = captures.get(intent);
                if (capture) capture.published = true;
              }
              // Check and synchronous dispatch share one call frame, including nested dispatch.
              redux.dispatch(intent.action);
              return intent.lifetime.isCurrent();
            });
          } finally {
            if (!published && !parked) intent.retire();
          }
        }
      } finally {
        stopped = true;
        // Retire while load receivers and the actual Store still exist.
        observing?.controller.abort();
        owner.dispose();
        for (const capture of [...captures.values()]) capture.release();
        for (const capture of queuedCaptures) capture.release();
        queuedCaptures.clear();
        held.clear();
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
