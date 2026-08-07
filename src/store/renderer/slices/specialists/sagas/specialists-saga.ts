import { END, buffers, eventChannel, type EventChannel } from 'redux-saga';
import { call, fork, put, take } from 'typed-redux-saga';

import { appClient } from '$lib/client';
import type { SpecialistDef } from '$lib/client/app-client';
import { SPECIALISTS, type Specialist } from '$lib/constants/specialists';
import { createLogger } from '$lib/utils/client-logger';
import { m } from '$shared/paraglide/messages.js';
import type { SpecialistFileScope } from '$shared/specialist-file-types';
import { selectBundledSpecialists, selectGetFileSpecialist } from '../specialists-selectors';
import {
  deleteFileSpecialist,
  exportBuiltinToFile,
  loadFileSpecialists,
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

type SpecialistAction = ReturnType<
  | typeof saveFileSpecialist
  | typeof deleteFileSpecialist
  | typeof exportBuiltinToFile
  | typeof loadFileSpecialists
>;

interface ListContext {
  generation: number;
}

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
  };
}

function bundledFallback(builtin: Specialist): Specialist {
  const mapped: Specialist = {
    id: builtin.id,
    name: builtin.name,
    description: builtin.description,
    defaultBehaviorPrompt: builtin.defaultBehaviorPrompt,
    source: 'bundled',
  };
  if (builtin.codingAgent !== undefined) mapped.codingAgent = builtin.codingAgent;
  if (builtin.defaultModel !== undefined) mapped.defaultModel = builtin.defaultModel;
  if (builtin.roleReminder !== undefined) mapped.roleReminder = builtin.roleReminder;
  if (builtin.defaultAgentType !== undefined) mapped.defaultAgentType = builtin.defaultAgentType;
  if (builtin.hidden !== undefined) mapped.hidden = builtin.hidden;
  if (builtin.modelOptions !== undefined) mapped.modelOptions = builtin.modelOptions;
  if (builtin.resolvedModel !== undefined) mapped.resolvedModel = builtin.resolvedModel;
  if (builtin.resolvedProvider !== undefined) mapped.resolvedProvider = builtin.resolvedProvider;
  return mapped;
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
    resolvedModel: def.resolvedModel,
    resolvedProvider: def.resolvedProvider,
  };
}

function* applySpecialistList(defs: SpecialistDef[]) {
  const bundledDefs = defs.filter((def) => def.source === 'bundled');
  const fileDefs = defs.filter((def) => def.source === 'user' || def.source === 'project');
  const bundledById = new Map(bundledDefs.map((def) => [def.id, def]));
  const knownIds = new Set(SPECIALISTS.map((specialist) => specialist.id));
  const bundled = SPECIALISTS.map((builtin) => {
    const def = bundledById.get(builtin.id);
    return def ? toBundledSpecialist(def) : bundledFallback(builtin);
  });
  for (const def of bundledDefs) {
    if (!knownIds.has(def.id)) bundled.push(toBundledSpecialist(def));
  }

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

function* showMutationError(error: unknown, fallback: string) {
  const { toast } = yield* call(() => import('svelte-sonner'));
  yield* call([toast, toast.error], errorMessage(error, fallback));
}

function* handleSave(action: ReturnType<typeof saveFileSpecialist>, context: ListContext) {
  const [payload] = action.payload;
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
    yield* call(refetchSpecialists, context);
  } catch (error) {
    logger.error('Failed to save file specialist', error);
    yield* call(showMutationError, error, m.specialists_mutation_saveFailed_error());
  }
}

function* handleDelete(action: ReturnType<typeof deleteFileSpecialist>, context: ListContext) {
  const [ref] = action.payload;
  try {
    yield* call(
      [appClient.specialists, appClient.specialists.delete],
      ref.id,
      ref.scope ?? 'user',
      ref.workspacePath,
    );
    yield* call(refetchSpecialists, context);
  } catch (error) {
    logger.error('Failed to delete file specialist', error);
    yield* call(showMutationError, error, m.specialists_mutation_deleteFailed_error());
  }
}

function* handleExport(action: ReturnType<typeof exportBuiltinToFile>, context: ListContext) {
  const [id] = action.payload;
  try {
    const bundledSpecialists = yield* selectBundledSpecialists.effect();
    const bundled = (bundledSpecialists.length ? bundledSpecialists : SPECIALISTS).find(
      (specialist) => specialist.id === id,
    );
    if (!bundled) throw new Error(`Bundled specialist not found: ${id}`); // i18n-ignore (diagnostic includes an internal id)
    const spec: SpecialistDef = {
      id: bundled.id,
      name: bundled.name,
      description: bundled.description,
      codingAgent: bundled.codingAgent,
      model: bundled.defaultModel,
      roleReminder: bundled.roleReminder,
      modelOptions: bundled.modelOptions,
      reasoningEffort: bundled.reasoningEffort,
      behaviorPrompt: bundled.defaultBehaviorPrompt,
      source: 'user',
      hidden: bundled.hidden,
    };
    yield* call(
      { context: appClient.specialists, fn: appClient.specialists.create },
      id,
      spec,
      'user' as const,
      undefined,
    );
    yield* call(refetchSpecialists, context);
  } catch (error) {
    logger.error('Failed to export bundled specialist to file', error);
    yield* call(showMutationError, error, m.specialists_mutation_exportFailed_error());
  }
}

function* handleAction(action: SpecialistAction, context: ListContext) {
  switch (action.type) {
    case saveFileSpecialist.type:
      yield* call(handleSave, action as ReturnType<typeof saveFileSpecialist>, context);
      break;
    case deleteFileSpecialist.type:
      yield* call(handleDelete, action as ReturnType<typeof deleteFileSpecialist>, context);
      break;
    case exportBuiltinToFile.type:
      yield* call(handleExport, action as ReturnType<typeof exportBuiltinToFile>, context);
      break;
    case loadFileSpecialists.type:
      yield* call(refetchSpecialists, context);
      break;
  }
}

function actionKey(action: SpecialistAction): string {
  if (action.type === loadFileSpecialists.type) return '$list';
  const [payload] = action.payload as [{ id: string } | string];
  return typeof payload === 'string' ? payload : payload.id;
}

export function createSpecialistsChannel(): EventChannel<SpecialistDef[]> {
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
  const queues = new Map<string, SpecialistAction[]>();
  const running = new Set<string>();
  yield* fork(watchSpecialistsSubscription, context);
  try {
    while (true) {
      const action: SpecialistAction = yield* take([
        saveFileSpecialist,
        deleteFileSpecialist,
        exportBuiltinToFile,
        loadFileSpecialists,
      ]);
      const key = actionKey(action);
      const queue = queues.get(key) ?? [];
      queue.push(action);
      queues.set(key, queue);
      if (running.has(key)) continue;
      running.add(key);
      yield* fork(function* () {
        try {
          while (queue.length > 0) {
            const next = queue.shift();
            if (next) yield* call(handleAction, next, context);
          }
        } finally {
          running.delete(key);
          queues.delete(key);
        }
      });
    }
  } finally {
    queues.clear();
    running.clear();
  }
}
