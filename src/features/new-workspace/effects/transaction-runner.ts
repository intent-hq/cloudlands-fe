import type { AppClient } from '$lib/client';
import { store as appStore } from '$store/renderer/store';

import { reduceDetailed } from '../controller';
import type { ControllerEvent, ControllerState } from '../controller';
import { adoptPromotedWorkspace, type WorkspaceAdoption } from './adoption';
import { newWorkspaceEffectSaga, type NewWorkspaceSagaDependencies } from './new-workspace-saga';

export interface DraftTransactionClock {
  saveDebounceMs?: number;
}

export interface DraftTransactionLog {
  error(message: string, error: unknown): void;
}

type EffectExecutor = (
  state: ControllerState,
  dependencies: NewWorkspaceSagaDependencies,
  settled: () => void,
) => () => void;

export interface DraftTransactionRunnerOptions {
  client?: AppClient;
  adopt?: WorkspaceAdoption;
  clock?: DraftTransactionClock;
  log?: DraftTransactionLog;
  /** Test seam; production uses the configured app Store saga runtime. */
  executeEffect?: EffectExecutor;
}

export interface DraftTransactionRunner {
  start(initialState: ControllerState): void;
  dispatch(event: ControllerEvent): void;
  subscribe(listener: (state: ControllerState) => void): () => void;
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
    if (state) for (const listener of listeners) listener(state);
  };

  const schedule = () => {
    if (stopped || !state) return;
    if (running) {
      rerun = true;
      return;
    }
    running = true;
    rerun = false;
    const dependencies: NewWorkspaceSagaDependencies = {
      client: options.client,
      adopt: options.adopt ?? adoptPromotedWorkspace,
      dispatch,
      getState: () => {
        if (!state) throw new Error('Draft transaction runner has not started');
        return state;
      },
      saveDebounceMs: options.clock?.saveDebounceMs,
    };
    cancel = execute(state, dependencies, () => {
      running = false;
      cancel = null;
      if (rerun) schedule();
    });
  };

  const dispatch = (event: ControllerEvent) => {
    if (!state || stopped) return;
    const transition = reduceDetailed(state, event);
    if (transition.disposition === 'ignored') return;
    state = transition.state;
    notify();
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
    subscribe(listener) {
      listeners.add(listener);
      if (state) listener(state);
      return () => listeners.delete(listener);
    },
    stop() {
      stopped = true;
      rerun = false;
      cancel?.();
      cancel = null;
      listeners.clear();
    },
  };
}
