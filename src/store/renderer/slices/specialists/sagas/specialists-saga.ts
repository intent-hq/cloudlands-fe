import { store } from '../../../store';
import { takeLatestFromSelector, type SelectorChannelPayload } from '@themislib/themis/saga';
import {
  selectCanAdministerHost,
  selectPrincipalActionContext,
} from '../../principal/principal-selectors';
import { END, buffers, channel, eventChannel, type Channel, type EventChannel } from 'redux-saga';
import {
  actionChannel,
  all,
  call,
  cancel,
  cancelled,
  delay,
  flush,
  fork,
  put,
  race,
  take,
  takeEvery,
  type SagaGenerator,
} from 'typed-redux-saga';

import { appClient } from '$lib/client';
import type {
  AppliedSettingChange,
  SpecialistDef,
  SpecialistCatalog,
} from '$lib/client/app-client';
import {
  SPECIALISTS,
  GITHUB_DEPENDENT_SPECIALIST_IDS,
  type Specialist,
} from '$lib/constants/specialists';
import { createLogger } from '$lib/utils/client-logger';
import { m } from '$shared/paraglide/messages.js';
import {
  generateUniqueSpecialistId,
  type SpecialistFileScope,
} from '$shared/specialist-file-types';
import { splitLegacyCompoundId } from '$shared/utils/legacy-model-id';
import { emptySpecialistCreation } from '../specialist-creation-types';
import {
  workspaceCatalogRequested,
  workspaceCatalogReceived,
  workspaceCatalogReadFailed,
} from '../../provider-catalog/provider-catalog-slice';
import { selectGitHubAuthIsAuthenticated } from '../../github-auth/github-auth-selectors';
import { settingsChanged } from '../../settings-events/settings-events-slice';
import {
  filterSpecialistsByGitHubAuth,
  selectFileSpecialists,
  selectSpecialistCreation,
  selectSpecialistCreationIds,
  selectSpecialists,
  selectSpecialistsFolderPath,
  selectBundledSpecialists,
  selectBundledSpecialistsLoaded,
  selectGetFileSpecialist,
} from '../specialists-selectors';
import {
  specialistSessionEnded,
  createSpecialistFromDraft,
  setSpecialistCreation,
  deleteFileSpecialist,
  refetchSpecialistsRequested,
  saveFileSpecialist,
  setSpecialistImportDiagnostics,
  setBundledSpecialists,
  setBundledSpecialistsLoaded,
  setCustomSpecialistsLoaded,
  setFileSpecialists,
  setFileSpecialistsLoaded,
  setOverridesLoaded,
  type FileSpecialist,
} from '../specialists-slice';

const logger = createLogger('SpecialistsSaga');
// An object emits the initial unknown admission too, so direct actions always settle.
const selectSession = store.createSelector((state) => ({
  admission: selectPrincipalActionContext.select(state),
}));

type CatalogReadOutcome = 'accepted' | 'failed';

interface ListContext {
  generation: number;
  // Each creation needs every outcome; a shared unicast channel would steal updates.
  confirmations: Set<Channel<CatalogReadOutcome>>;
}

function* publishCatalogRead(context: ListContext, outcome: CatalogReadOutcome) {
  for (const updates of [...context.confirmations]) yield* put(updates, outcome);
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
 * Trailing debounce for explicit and settings-driven refetches so one
 * `specialist.list` call serves a trigger burst — mirrors the live client's
 * `specialists:changed` debounce.
 */
const REFETCH_DEBOUNCE_MS = 100;

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

function triggersSpecialistRefetch(action: { type: string; payload?: unknown }): boolean {
  return action.type === refetchSpecialistsRequested.type || touchesModelResolutionSettings(action);
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
    role: def.role,
    teamAgents: def.teamAgents,
    icon: def.icon,
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
  if (builtin.role !== undefined) mapped.role = builtin.role;
  if (builtin.teamAgents !== undefined) mapped.teamAgents = builtin.teamAgents;
  if (builtin.icon !== undefined) mapped.icon = builtin.icon;
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
    importedFrom: def.importedFrom,
    unsupportedFields: def.unsupportedFields,
    requiredSkills: def.requiredSkills,
    missingSkills: def.missingSkills,
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
  };
}

function* applySpecialistCatalog(catalog: SpecialistCatalog) {
  yield* put(setSpecialistImportDiagnostics(catalog.importDiagnostics ?? []));
  return yield* call(applySpecialistList, catalog.specialists, true);
}

function* applySpecialistList(defs: SpecialistDef[], authoritative = false) {
  // The daemon always ships bundled specialists. The live client folds a
  // transport failure into [], so an empty result after initial load is a
  // failed read and must not replace the last-known-good roster or loaded flags.
  if (!authoritative && defs.length === 0 && (yield* selectBundledSpecialistsLoaded.effect())) {
    logger.warn('Ignoring empty specialist list after initial load');
    return false;
  }

  const bundledDefs = defs.filter((def) => def.source === 'bundled');
  const fileDefs = defs.filter((def) => def.source === 'user' || def.source === 'project');
  // The daemon list is authoritative: shipped specialists absent from it must
  // not resurrect (daemon replacement mode). A successful response with only
  // user/project defs means the base set is intentionally empty, so the
  // hardcoded SPECIALISTS fallback only applies to an empty initial load.
  const bundled =
    authoritative || defs.length
      ? bundledDefs.map(toBundledSpecialist)
      : SPECIALISTS.map(bundledFallback);

  yield* put(setBundledSpecialists(bundled));
  yield* put(setBundledSpecialistsLoaded(true));
  yield* put(setOverridesLoaded(true));
  yield* put(setCustomSpecialistsLoaded(true));
  yield* put(setFileSpecialists(fileDefs.map(toFileSpecialist)));
  yield* put(setFileSpecialistsLoaded(true));
  return true;
}

function* refetchSpecialists(context: ListContext) {
  const admission = yield* selectPrincipalActionContext.effect();
  if (!admission) return;
  const generation = ++context.generation;
  try {
    let accepted: boolean;
    if (appClient.specialists.listCatalog) {
      const catalog = yield* call([appClient.specialists, appClient.specialists.listCatalog]);
      if (
        generation !== context.generation ||
        admission !== (yield* selectPrincipalActionContext.effect())
      )
        return;
      accepted = yield* call(applySpecialistCatalog, catalog);
    } else {
      const defs = yield* call([appClient.specialists, appClient.specialists.list]);
      if (
        generation !== context.generation ||
        admission !== (yield* selectPrincipalActionContext.effect())
      )
        return;
      accepted = yield* call(applySpecialistList, defs);
    }
    yield* call(
      publishCatalogRead,
      context,
      accepted ? ('accepted' as const) : ('failed' as const),
    );
  } catch (error) {
    // An obsolete failure cannot invalidate a newer catalog or fail its waiters.
    if (
      generation !== context.generation ||
      admission !== (yield* selectPrincipalActionContext.effect())
    )
      return;
    logger.error('Failed to refetch specialist list', error);
    const hasConfirmations = context.confirmations.size > 0;
    yield* call(publishCatalogRead, context, 'failed' as const);
    // Creation owns its failure notification; ordinary refreshes still report theirs.
    if (!hasConfirmations) {
      const { notify } = yield* call(() => import('$lib/components/patterns/notify'));
      yield* call([notify, notify.error], m.specialists_mutation_refreshFailed_error());
    }
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
  const { notify } = yield* call(() => import('$lib/components/patterns/notify'));
  yield* call([notify, notify.error], errorMessage(error, fallback));
}

/** Reject the per-dispatch promise while publishing its failure stage. */
function* rejectAction(
  action: ReturnType<typeof saveFileSpecialist> | ReturnType<typeof deleteFileSpecialist>,
  error: Error,
) {
  yield* put(action.failure(error));
}

function* requireOwner(admission: string | null) {
  if (
    !admission ||
    admission !== (yield* selectPrincipalActionContext.effect()) ||
    !(yield* selectCanAdministerHost.effect())
  ) {
    throw new Error(m.settings_agentSettings_ownerOnly_description());
  }
}

function* handleSave(context: ListContext, action: ReturnType<typeof saveFileSpecialist>) {
  const [payload] = action.payload;
  const admission = yield* selectPrincipalActionContext.effect();
  let settled = false;
  try {
    yield* call(requireOwner, admission);
    const existing = yield* selectGetFileSpecialist.effect(payload.id, payload.workspaceId);
    if (existing?.importedFrom) {
      throw new Error(m.settings_aiBehavior_importedClaude_readOnly());
    }
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
        ...(payload.workspaceId ? [payload.workspaceId] : []),
      );
    } else {
      yield* call(
        [appClient.specialists, appClient.specialists.create],
        payload.id,
        spec,
        scope,
        payload.workspacePath,
        ...(payload.workspaceId ? [payload.workspaceId] : []),
      );
    }
    // The daemon write succeeded: settle the promise before the list refetch
    // (which handles its own failures) so awaiting callers aren't blocked on it.
    yield* call(requireOwner, admission);
    yield* put(action.success(undefined as never));
    settled = true;
    if (scope === 'project' && payload.workspaceId)
      yield* put(workspaceCatalogRequested(payload.workspaceId));
    else yield* call(refetchSpecialists, context);
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

function* isInSettingsSidebar(id: string, workspaceId?: string) {
  const specialists = yield* selectSpecialists.effect(workspaceId);
  const authenticated = yield* selectGitHubAuthIsAuthenticated.effect();
  return filterSpecialistsByGitHubAuth(specialists, authenticated).some((entry) => entry.id === id);
}

/** Follow accepted global reads even if another creation or subscription supersedes ours. */
function* confirmGlobalSpecialist(
  context: ListContext,
  id: string,
  admission: string,
): SagaGenerator<FileSpecialist> {
  yield* call(requireOwner, admission);
  const updates = channel<CatalogReadOutcome>(buffers.expanding());
  context.confirmations.add(updates);
  const refresh = yield* fork(refetchSpecialists, context);
  try {
    yield* call(requireOwner, admission);
    const { available } = yield* race({
      available: call(function* () {
        while (true) {
          yield* call(requireOwner, admission);
          const outcome = yield* take(updates);
          yield* call(requireOwner, admission);
          if (outcome === 'failed') return undefined;
          const specialist = yield* selectGetFileSpecialist.effect(id);
          if (specialist && (yield* call(isInSettingsSidebar, id))) return specialist;
        }
      }),
      // Bounds both a hung RPC and accepted catalogs that never contain a visible row.
      timeout: delay(30000),
    });
    if (!available) throw new Error(m.specialists_mutation_refreshFailed_error());
    return available;
  } finally {
    context.confirmations.delete(updates);
    updates.close();
    // A subscription may confirm the row while our superseded RPC is still pending.
    yield* cancel(refresh);
  }
}

/** Wait on the existing workspace catalog owner rather than starting another catalog reader. */
function* confirmWorkspaceSpecialist(workspaceId: string, id: string, admission: string) {
  const updates = yield* actionChannel(
    (action: { type: string; payload?: unknown[] }) =>
      (action.type === workspaceCatalogReceived.type ||
        action.type === workspaceCatalogReadFailed.type) &&
      action.payload?.[0] === workspaceId,
    buffers.expanding(),
  );
  try {
    yield* call(requireOwner, admission);
    yield* put(workspaceCatalogRequested(workspaceId));
    const { available } = yield* race({
      available: call(function* () {
        while (true) {
          yield* call(requireOwner, admission);
          const action = yield* take(updates);
          yield* call(requireOwner, admission);
          const specialist = yield* selectGetFileSpecialist.effect(id, workspaceId);
          if (specialist && (yield* call(isInSettingsSidebar, id, workspaceId))) return specialist;
          if (action.type === workspaceCatalogReadFailed.type) return undefined;
        }
      }),
      // Also bounds a missing row or a catalog owner cancelled when leaving its workspace.
      timeout: delay(30000),
    });
    if (!available) throw new Error(m.specialists_mutation_refreshFailed_error());
    return available;
  } finally {
    updates.close();
  }
}

/** Creation owns a durable operation in Redux; existing save callers still settle at the write. */
function* handleCreateFromDraft(
  context: ListContext,
  action: ReturnType<typeof createSpecialistFromDraft>,
) {
  const [draftContext, workspaceId] = action.payload;
  const admission = yield* selectPrincipalActionContext.effect();
  if (!admission || !(yield* selectCanAdministerHost.effect())) {
    yield* put(action.failure(new Error(m.settings_agentSettings_ownerOnly_description())));
    return;
  }
  const creation = yield* selectSpecialistCreation.effect(draftContext);
  const { draft } = creation;
  if (
    creation.status === 'saving' ||
    creation.status === 'refreshing' ||
    !draft.name.trim() ||
    (draft.behaviorPrompt?.length ?? 0) > 50000
  ) {
    yield* put(action.failure(new Error(m.specialists_mutation_saveFailed_error())));
    return;
  }
  let written = creation.status === 'refresh-failed';
  const specialists = yield* selectSpecialists.effect();
  const workspaceSpecialists = workspaceId ? yield* selectSpecialists.effect(workspaceId) : [];
  const reservedIds = yield* selectSpecialistCreationIds.effect();
  const files = yield* selectFileSpecialists.effect();
  const bundled = yield* selectBundledSpecialists.effect();
  const id =
    creation.specialistId ??
    generateUniqueSpecialistId(draft.name.trim(), [
      ...specialists.map((specialist) => specialist.id),
      ...workspaceSpecialists.map((specialist) => specialist.id),
      ...reservedIds,
      ...files.map((specialist) => specialist.id),
      ...bundled.map((specialist) => specialist.id),
      ...SPECIALISTS.map((specialist) => specialist.id),
      ...GITHUB_DEPENDENT_SPECIALIST_IDS,
    ]);
  let settled = false;
  try {
    yield* put(
      setSpecialistCreation(draftContext, {
        draft,
        specialistId: id,
        status: written ? 'refreshing' : 'saving',
      }),
    );
    if (!written) {
      yield* call(
        [appClient.specialists, appClient.specialists.create],
        id,
        {
          id,
          name: draft.name.trim(),
          description: draft.description.trim() || m.settings_aiBehavior_customSpecialistFallback(),
          codingAgent: draft.codingAgent,
          model: draft.model ? splitLegacyCompoundId(draft.model).modelId : undefined,
          reasoningEffort: draft.reasoningEffort,
          behaviorPrompt: draft.behaviorPrompt ?? m.settings_aiBehavior_newPromptTemplate(),
          source: 'user' as const,
        },
        'user' as const,
        undefined,
      );
      yield* call(requireOwner, admission);
      written = true;
      yield* put(
        setSpecialistCreation(draftContext, { draft, specialistId: id, status: 'refreshing' }),
      );
    }
    const available = yield* call(confirmGlobalSpecialist, context, id, admission);
    if (workspaceId) yield* call(confirmWorkspaceSpecialist, workspaceId, id, admission);
    yield* call(requireOwner, admission);
    yield* put(setSpecialistCreation(draftContext, emptySpecialistCreation));
    const folder = yield* selectSpecialistsFolderPath.effect();
    const path =
      available.filePath || (folder ? `${folder}/${id}.md` : `~/.intent/specialists/${id}.md`);
    const { notify } = yield* call(() => import('$lib/components/patterns/notify'));
    yield* call(
      [notify, notify.success],
      m.settings_aiBehavior_createdToast({ name: draft.name.trim() }),
      {
        description: path.replace(/^\/Users\/[^/]+/, '~'),
      },
    );
    yield* put(action.success(id));
    settled = true;
  } catch (error) {
    if (admission !== (yield* selectPrincipalActionContext.effect())) {
      yield* put(setSpecialistCreation(draftContext, emptySpecialistCreation));
      yield* put(
        action.failure(mutationError(error, m.settings_agentSettings_ownerOnly_description())),
      );
      settled = true;
      return;
    }
    const fallback = written
      ? m.specialists_mutation_refreshFailed_error()
      : m.specialists_mutation_saveFailed_error();
    yield* put(
      setSpecialistCreation(draftContext, {
        draft,
        specialistId: id,
        status: written ? 'refresh-failed' : 'save-failed',
        error: errorMessage(error, fallback),
      }),
    );
    yield* call(showMutationError, error, fallback);
    yield* put(action.failure(mutationError(error, fallback)));
    settled = true;
  } finally {
    if (!settled && (yield* cancelled())) {
      const message = written
        ? m.specialists_mutation_refreshFailed_error()
        : m.specialists_mutation_saveFailed_error();
      yield* put(
        setSpecialistCreation(draftContext, {
          draft,
          specialistId: id,
          status: written ? 'refresh-failed' : 'save-failed',
          error: message,
        }),
      );
      yield* put(action.failure(new Error(message)));
    }
  }
}

function* handleDelete(context: ListContext, action: ReturnType<typeof deleteFileSpecialist>) {
  const [ref] = action.payload;
  const admission = yield* selectPrincipalActionContext.effect();
  let settled = false;
  try {
    yield* call(requireOwner, admission);
    const existing = yield* selectGetFileSpecialist.effect(ref.id, ref.workspaceId);
    if (existing?.importedFrom) {
      throw new Error(m.settings_aiBehavior_importedClaude_readOnly());
    }
    yield* call(
      [appClient.specialists, appClient.specialists.delete],
      ref.id,
      ref.scope ?? 'user',
      ref.workspacePath,
      ...(ref.workspaceId ? [ref.workspaceId] : []),
    );
    yield* call(requireOwner, admission);
    yield* put(action.success(undefined as never));
    settled = true;
    if (ref.scope === 'project' && ref.workspaceId)
      yield* put(workspaceCatalogRequested(ref.workspaceId));
    else yield* call(refetchSpecialists, context);
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
 * Single-flight, trailing-coalesced refetch loop (per the
 * event-driven refetch rule in AGENTS.md). A sliding(1) action channel
 * buffers explicit requests and relevant settings deltas: the debounce window folds a burst into one
 * `specialist.list` call, the blocking `call` guarantees no concurrent
 * refetches, and triggers arriving mid-flight collapse into at most one
 * trailing refetch after the current one settles.
 */
function* watchSpecialistRefetches(context: ListContext) {
  const channel = yield* actionChannel(triggersSpecialistRefetch, buffers.sliding(1));
  while (true) {
    yield* take(channel);
    yield* delay(REFETCH_DEBOUNCE_MS);
    // Triggers that arrived during the window are served by this refetch.
    yield* flush(channel);
    yield* call(refetchSpecialists, context);
  }
}

function createSpecialistsChannel(): EventChannel<SpecialistCatalog | SpecialistDef[]> {
  return eventChannel<SpecialistCatalog | SpecialistDef[]>(
    (emit) =>
      appClient.specialists.subscribeCatalog
        ? appClient.specialists.subscribeCatalog(emit)
        : appClient.specialists.subscribe(emit),
    buffers.expanding<SpecialistCatalog | SpecialistDef[]>(),
  );
}

function* watchSpecialistsSubscription(context: ListContext) {
  const channel = createSpecialistsChannel();
  try {
    while (true) {
      const catalog: SpecialistCatalog | SpecialistDef[] = yield* take(channel);
      if (catalog === (END as unknown as SpecialistCatalog)) break;
      ++context.generation;
      const accepted = Array.isArray(catalog)
        ? yield* call(applySpecialistList, catalog)
        : yield* call(applySpecialistCatalog, catalog);
      yield* call(
        publishCatalogRead,
        context,
        accepted ? ('accepted' as const) : ('failed' as const),
      );
    }
  } finally {
    channel.close();
  }
}

function* specialistsSession(admission: string | null) {
  const context: ListContext = { generation: 0, confirmations: new Set() };
  if (admission) yield* fork(watchSpecialistsSubscription, context);
  yield* all([
    takeEvery(createSpecialistFromDraft, handleCreateFromDraft, context),
    takeEvery(saveFileSpecialist, handleSave, context),
    takeEvery(deleteFileSpecialist, handleDelete, context),
    fork(watchSpecialistRefetches, context),
  ]);
}

export function* specialistsSaga() {
  yield* takeLatestFromSelector(
    selectSession,
    function* ({ payload }: SelectorChannelPayload<{ admission: string | null }>) {
      try {
        yield* call(specialistsSession, payload.admission);
      } finally {
        yield* put(specialistSessionEnded());
      }
    },
  );
}
