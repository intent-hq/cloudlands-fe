import type { AppClient } from '$lib/client';
import { store as appStore } from '$store/renderer/store';
import { selectSpecialists } from '$store/renderer/slices/specialists/specialists-selectors';

import { effectsFor, hasUnsavedInput, reduceDetailed } from '../controller';
import type { ControllerEvent, ControllerState } from '../controller';
import { adoptPromotedWorkspace, type WorkspaceAdoption } from './adoption';
import { newWorkspaceEffectSaga, type NewWorkspaceSagaDependencies } from './new-workspace-saga';

interface DraftTransactionClock {
  saveDebounceMs?: number;
}

const DEFAULT_SAVE_DEBOUNCE_MS = 250;

interface DraftTransactionLog {
  error(message: string, error: unknown): void;
}

type EffectExecutor = (
  state: ControllerState,
  dependencies: NewWorkspaceSagaDependencies,
  settled: () => void,
) => () => void;

interface DraftTransactionRunnerOptions {
  client?: AppClient;
  /** Draft to restore. Pass `null` to force a distinct new draft. */
  requestedDraftId?: string | null;
  adopt?: WorkspaceAdoption;
  clock?: DraftTransactionClock;
  log?: DraftTransactionLog;
  /** Test seam; production uses the configured app Store saga runtime. */
  executeEffect?: EffectExecutor;
}

function currentSpecialists() {
  try {
    return selectSpecialists.select(appStore.state);
  } catch {
    return [];
  }
}

export interface DraftTransactionRunner {
  start(initialState: ControllerState): void;
  dispatch(event: ControllerEvent): void;
  subscribe(listener: (state: ControllerState) => void): () => void;
  flush(): void;
  stop(): void;
}

/**
 * Owns one pure controller instance for `/workspace/new`.
 * `start` begins effect delivery, `dispatch` reduces user/daemon events,
 * `subscribe` observes every handled transition, and `stop` cancels delivery.
 */
export function createDraftTransactionRunner(
  options: DraftTransactionRunnerOptions = {},
): DraftTransactionRunner {
  let state: ControllerState | null = null;
  let running = false;
  let rerun = false;
  let stopped = false;
  let closing = false;
  let saveDelayPending = false;
  let flushRequested = false;
  let cancel: (() => void) | null = null;
  const listeners = new Set<(state: ControllerState) => void>();
  const log = options.log ?? console;

  const execute: EffectExecutor =
    options.executeEffect ??
    ((snapshot, dependencies, settled) =>
      appStore.runSaga(function* runNewWorkspaceEffects() {
        try {
          yield* newWorkspaceEffectSaga(snapshot, dependencies);
        } catch (error) {
          log.error('New workspace transaction effect failed', error);
        } finally {
          queueMicrotask(settled);
        }
      }));

  const notify = () => {
    if (state && !closing) for (const listener of listeners) listener(state);
  };

  const hasDraftSave = (snapshot: ControllerState): boolean =>
    effectsFor(snapshot).some(({ type }) => type === 'updateDraft');

  const finishStop = () => {
    stopped = true;
    closing = false;
    rerun = false;
    saveDelayPending = false;
    flushRequested = false;
    cancel = null;
  };

  const schedule = () => {
    if (stopped || !state) return;
    if (running) {
      rerun = true;
      return;
    }
    running = true;
    rerun = false;
    const immediate = flushRequested || state.phase === 'starting';
    flushRequested = false;
    const saveDebounceMs = immediate
      ? 0
      : (options.clock?.saveDebounceMs ?? DEFAULT_SAVE_DEBOUNCE_MS);
    saveDelayPending = hasDraftSave(state) && saveDebounceMs > 0;
    const dependencies: NewWorkspaceSagaDependencies = {
      client: options.client,
      requestedDraftId: options.requestedDraftId,
      adopt: options.adopt ?? adoptPromotedWorkspace,
      dispatch,
      getState: () => {
        if (!state) throw new Error('Draft transaction runner has not started');
        return state;
      },
      getSpecialists: currentSpecialists,
      saveDebounceMs,
    };
    cancel = execute(state, dependencies, () => {
      running = false;
      saveDelayPending = false;
      cancel = null;
      if (closing) {
        if (state && hasDraftSave(state)) {
          flushRequested = true;
          schedule();
        } else {
          finishStop();
        }
        return;
      }
      if (rerun) schedule();
    });
  };

  const dispatch = (event: ControllerEvent) => {
    if (!state || stopped) return;
    const transition = reduceDetailed(state, event);
    if (transition.disposition === 'ignored') return;
    state = transition.state;
    if (event.type === 'draft.saveIssued') saveDelayPending = false;
    notify();
    if (closing) return;
    if (event.type === 'start.requested') flushRequested = true;
    if (saveDelayPending && (event.type === 'user.edited' || event.type === 'start.requested')) {
      rerun = true;
      cancel?.();
      return;
    }
    schedule();
  };

  const flush = () => {
    if (!state || stopped || !hasDraftSave(state)) return;
    flushRequested = true;
    if (running) {
      rerun = true;
      if (saveDelayPending) cancel?.();
      return;
    }
    schedule();
  };

  return {
    start(initialState) {
      if (state) throw new Error('Draft transaction runner has already started');
      stopped = false;
      state = initialState;
      notify();
      schedule();
    },
    dispatch,
    flush,
    subscribe(listener) {
      listeners.add(listener);
      if (state) listener(state);
      return () => listeners.delete(listener);
    },
    stop() {
      listeners.clear();
      if (!state || stopped) return;
      const drainPendingInput =
        (state.phase === 'pristine' || state.phase === 'editing' || state.phase === 'starting') &&
        hasUnsavedInput(state) &&
        (state.draft !== null || state.creationIssued);
      if (!drainPendingInput) {
        cancel?.();
        finishStop();
        return;
      }
      closing = true;
      flushRequested = true;
      rerun = true;
      if (saveDelayPending) cancel?.();
      else if (!running) schedule();
    },
  };
}
