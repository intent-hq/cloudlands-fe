import { END, buffers, eventChannel, type EventChannel } from 'redux-saga';
import {
  actionChannel,
  all,
  call,
  cancelled,
  delay,
  flush,
  fork,
  put,
  take,
  takeEvery,
} from 'typed-redux-saga';

import { appClient } from '$lib/client';
import type { AppliedSettingChange, SpecialistDef } from '$lib/client/app-client';
import { SPECIALISTS, type Specialist } from '$lib/constants/specialists';
import { createLogger } from '$lib/utils/client-logger';
import type { RequireSharedKeys } from '$lib/utils/mapped-shape';
import { m } from '$shared/paraglide/messages.js';
import type { SpecialistFileScope } from '$shared/specialist-file-types';
import { settingsChanged } from '../../settings-events/settings-events-slice';
import { selectBundledSpecialists, selectGetFileSpecialist } from '../specialists-selectors';
import {
  deleteFileSpecialist,
  saveFileSpecialist,
  setBundledSpecialists,
  setBundledSpecialistsLoaded,
  setCustomSpecialistsLoaded,
  setFileSpecialists,
  setFileSpecialistsLoaded,
  setOverridesLoaded,
  type FileSpecialist,
} from '../specialists-slice';

const logger = createLogger('SpecialistsSaga');

interface ListContext {
  generation: number;
}

/**
 * Settings paths that feed the daemon-side specialist model-resolution chain:
 * a change to any of them shifts every specialist's `resolvedModel` /
 * `resolvedProvider` preview, but the daemon only emits `specialists:changed`
 * for specialist *file* changes — so the FE refetches `specialist.list` itself
 * when a `settings:changed` delta touches one of these paths
 * (intent-hq/monorepo#1925).
 */
const MODEL_RESOLUTION_SETTINGS_PATHS: readonly string[] = [
  'model.providerDefaults',
  'model.default',
  'model.defaultProvider',
];

/**
 * Trailing debounce for settings-driven refetches so one `specialist.list`
 * call serves a multi-path delta burst — mirrors the live client's
 * `specialists:changed` debounce.
 */
const SETTINGS_REFETCH_DEBOUNCE_MS = 100;

/**
 * Predicate pattern (not the action creator) so unrelated settings deltas
 * never enter the refetch channel — they neither trigger a refetch nor
 * displace a buffered relevant delta.
 */
function touchesModelResolutionSettings(action: { type: string; payload?: unknown }): boolean {
  if (action.type !== settingsChanged.type) return false;
  const changes = Array.isArray(action.payload) ? action.payload[0] : undefined;
  return (
    Array.isArray(changes) &&
    changes.some((change: AppliedSettingChange) =>
      MODEL_RESOLUTION_SETTINGS_PATHS.includes(change.path),
    )
  );
}

// The `satisfies RequireSharedKeys<...>` on each mapper makes omitting a key
// shared by the wire def and the store type a compile error (see the
// #2217 `reasoningEffort` drop). Renamed fields stay hand-mapped.
function toBundledSpecialist(def: SpecialistDef): Specialist {
  return {
    id: def.id,
    name: def.name,
    description: def.description,
    codingAgent: def.codingAgent,
    defaultModel: def.model,
    defaultBehaviorPrompt: def.behaviorPrompt ?? def.prompt ?? '',
    roleReminder: def.roleReminder,
    source: 'bundled',
    defaultAgentType: def.agentType,
    hidden: def.hidden,
    modelOptions: def.modelOptions,
    reasoningEffort: def.reasoningEffort,
    resolvedModel: def.resolvedModel,
    resolvedProvider: def.resolvedProvider,
    role: def.role,
    teamAgents: def.teamAgents,
    icon: def.icon,
  } satisfies RequireSharedKeys<SpecialistDef, Specialist>;
}

function bundledFallback(builtin: Specialist): Specialist {
  return {
    id: builtin.id,
    name: builtin.name,
    description: builtin.description,
    codingAgent: builtin.codingAgent,
    defaultModel: builtin.defaultModel,
    defaultBehaviorPrompt: builtin.defaultBehaviorPrompt,
    roleReminder: builtin.roleReminder,
    source: 'bundled',
    defaultAgentType: builtin.defaultAgentType,
    hidden: builtin.hidden,
    modelOptions: builtin.modelOptions,
    reasoningEffort: builtin.reasoningEffort,
    resolvedModel: builtin.resolvedModel,
    resolvedProvider: builtin.resolvedProvider,
    role: builtin.role,
    teamAgents: builtin.teamAgents,
    icon: builtin.icon,
  } satisfies RequireSharedKeys<Specialist, Specialist>;
}

function toFileSpecialist(def: SpecialistDef): FileSpecialist {
  return {
    id: def.id,
    name: def.name,
    description: def.description,
    codingAgent: def.codingAgent,
    model: def.model ?? '',
    behaviorPrompt: def.behaviorPrompt ?? def.prompt ?? '',
    roleReminder: def.roleReminder,
    filePath: def.path ?? '',
    source: def.source as SpecialistFileScope,
    hidden: def.hidden,
    modelOptions: def.modelOptions,
    // Must be mapped from the daemon def: the post-mutation refetch replaces the
    // stored specialist, so dropping it here reset the Model row picker to Auto
    // and let the next save erase the level on the daemon (hidden-dolphin ws).
    reasoningEffort: def.reasoningEffort,
    resolvedModel: def.resolvedModel,
    resolvedProvider: def.resolvedProvider,
    role: def.role,
    teamAgents: def.teamAgents,
    icon: def.icon,
  } satisfies RequireSharedKeys<SpecialistDef, FileSpecialist>;
}

function* applySpecialistList(defs: SpecialistDef[]) {
  const bundledDefs = defs.filter((def) => def.source === 'bundled');
  const fileDefs = defs.filter((def) => def.source === 'user' || def.source === 'project');
  // The daemon list is authoritative: shipped specialists absent from it must
  // not resurrect (daemon replacement mode). A successful response with only
  // user/project defs means the base set is intentionally empty, so the
  // hardcoded SPECIALISTS fallback only applies to a fully empty list
  // (specialist.list already folds transport failures to []).
  const bundled = defs.length
    ? bundledDefs.map(toBundledSpecialist)
    : SPECIALISTS.map(bundledFallback);

  yield* put(setBundledSpecialists(bundled));
  yield* put(setBundledSpecialistsLoaded(true));
  yield* put(setOverridesLoaded(true));
  yield* put(setCustomSpecialistsLoaded(true));
  yield* put(setFileSpecialists(fileDefs.map(toFileSpecialist)));
  yield* put(setFileSpecialistsLoaded(true));
}

function* refetchSpecialists(context: ListContext) {
  const generation = ++context.generation;
  try {
    const defs: SpecialistDef[] = yield* call([appClient.specialists, appClient.specialists.list]);
    if (generation === context.generation) yield* call(applySpecialistList, defs);
  } catch (error) {
    logger.error('Failed to refetch specialist list', error);
    const { toast } = yield* call(() => import('$lib/components/ui/toast'));
    yield* call([toast, toast.error], m.specialists_mutation_refreshFailed_error());
  }
}

function errorMessage(error: unknown, fallback: string): string {
  if (!error) return fallback;
  return error instanceof Error ? error.message : String(error);
}

function mutationError(error: unknown, fallback: string): Error {
  return error instanceof Error ? error : new Error(errorMessage(error, fallback));
}

function* showMutationError(error: unknown, fallback: string) {
  const { toast } = yield* call(() => import('svelte-sonner'));
  yield* call([toast, toast.error], errorMessage(error, fallback));
}

/**
 * Reject the per-dispatch promise with `error`. The promise is marked handled
 * first so fire-and-forget dispatchers (e.g. the settings editor) don't
 * surface unhandled-rejection noise; awaiting callers still get the rejection.
 */
function* rejectAction(
  action: ReturnType<typeof saveFileSpecialist> | ReturnType<typeof deleteFileSpecialist>,
  error: Error,
) {
  action.promise.catch(() => {});
  yield* put(action.failure(error));
}

function* handleSave(context: ListContext, action: ReturnType<typeof saveFileSpecialist>) {
  const [payload] = action.payload;
  let settled = false;
  try {
    const existing = yield* selectGetFileSpecialist.effect(payload.id);
    const bundledSpecialists = yield* selectBundledSpecialists.effect();
    const bundled = (bundledSpecialists.length ? bundledSpecialists : SPECIALISTS).find(
      (specialist) => specialist.id === payload.id,
    );
    const scope = payload.scope ?? 'user';
    const spec: SpecialistDef = {
      id: payload.id,
      name: payload.name,
      description: payload.description,
      codingAgent: payload.codingAgent,
      model: payload.model,
      roleReminder: payload.roleReminder,
      modelOptions: payload.modelOptions?.length ? payload.modelOptions : undefined,
      reasoningEffort: payload.reasoningEffort,
      behaviorPrompt: payload.behaviorPrompt,
      source: scope,
      hidden: existing?.hidden ?? bundled?.hidden,
      role: existing?.role ?? bundled?.role,
      teamAgents: existing?.teamAgents ?? bundled?.teamAgents,
      icon: existing?.icon ?? bundled?.icon,
    };
    if (existing) {
      yield* call(
        [appClient.specialists, appClient.specialists.edit],
        payload.id,
        spec,
        scope,
        payload.workspacePath,
      );
    } else {
      yield* call(
        [appClient.specialists, appClient.specialists.create],
        payload.id,
        spec,
        scope,
        payload.workspacePath,
      );
    }
    // The daemon write succeeded: settle the promise before the list refetch
    // (which handles its own failures) so awaiting callers aren't blocked on it.
    yield* put(action.success(undefined as never));
    settled = true;
    yield* call(refetchSpecialists, context);
  } catch (error) {
    logger.error('Failed to save file specialist', error);
    yield* call(showMutationError, error, m.specialists_mutation_saveFailed_error());
    yield* call(
      rejectAction,
      action,
      mutationError(error, m.specialists_mutation_saveFailed_error()),
    );
    settled = true;
  } finally {
    if (!settled && (yield* cancelled())) {
      yield* call(rejectAction, action, new Error(m.specialists_mutation_saveFailed_error()));
    }
  }
}

function* handleDelete(context: ListContext, action: ReturnType<typeof deleteFileSpecialist>) {
  const [ref] = action.payload;
  let settled = false;
  try {
    yield* call(
      [appClient.specialists, appClient.specialists.delete],
      ref.id,
      ref.scope ?? 'user',
      ref.workspacePath,
    );
    yield* put(action.success(undefined as never));
    settled = true;
    yield* call(refetchSpecialists, context);
  } catch (error) {
    logger.error('Failed to delete file specialist', error);
    yield* call(showMutationError, error, m.specialists_mutation_deleteFailed_error());
    yield* call(
      rejectAction,
      action,
      mutationError(error, m.specialists_mutation_deleteFailed_error()),
    );
    settled = true;
  } finally {
    if (!settled && (yield* cancelled())) {
      yield* call(rejectAction, action, new Error(m.specialists_mutation_deleteFailed_error()));
    }
  }
}

/**
 * Single-flight, trailing-coalesced settings-driven refetch loop (per the
 * event-driven refetch rule in AGENTS.md). A sliding(1) action channel
 * buffers relevant deltas: the debounce window folds a burst into one
 * `specialist.list` call, the blocking `call` guarantees no concurrent
 * refetches, and deltas arriving mid-flight collapse into at most one
 * trailing refetch after the current one settles.
 */
function* watchModelResolutionSettings(context: ListContext) {
  const channel = yield* actionChannel(touchesModelResolutionSettings, buffers.sliding(1));
  while (true) {
    yield* take(channel);
    yield* delay(SETTINGS_REFETCH_DEBOUNCE_MS);
    // Deltas that arrived during the window are served by this refetch.
    yield* flush(channel);
    yield* call(refetchSpecialists, context);
  }
}

function createSpecialistsChannel(): EventChannel<SpecialistDef[]> {
  return eventChannel<SpecialistDef[]>(
    (emit) => appClient.specialists.subscribe(emit),
    buffers.expanding<SpecialistDef[]>(),
  );
}

function* watchSpecialistsSubscription(context: ListContext) {
  const channel = createSpecialistsChannel();
  try {
    while (true) {
      const defs: SpecialistDef[] = yield* take(channel);
      if (defs === (END as unknown as SpecialistDef[])) break;
      ++context.generation;
      yield* call(applySpecialistList, defs);
    }
  } finally {
    channel.close();
  }
}

export function* specialistsSaga() {
  const context: ListContext = { generation: 0 };
  yield* fork(watchSpecialistsSubscription, context);
  yield* all([
    takeEvery(saveFileSpecialist, handleSave, context),
    takeEvery(deleteFileSpecialist, handleDelete, context),
    fork(watchModelResolutionSettings, context),
  ]);
}
