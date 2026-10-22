/**
 * Scripts selectors — workspace-scoped.
 */

import { store } from '../../store';
import { createDefaultRuntimeState } from '$features/scripts/types';
import { isLiveScriptStatus } from '$features/scripts/utils/script-status';
import type { ScriptOperationState, ScriptListEntry } from './scripts-types';
import { emptyOutputBuffer, emptyWorkspaceState } from './scripts-slice';
import type { StoreState } from '$store/renderer/types';
import { getItem } from '@themislib/themis/utils/collections/collection-utils';
import {
  selectCanManageWorkspace,
  selectWorkspaceParticipationContext,
  selectWorkspaceGuestManagerContext,
} from '../workspace/workspace-selectors';

/** Remember the guest scope while identity refresh is pending; cached output must fail closed. */
export const selectUsesGuestScriptScope = store.createSelector((state, workspaceId: string) => {
  if (
    selectCanManageWorkspace.select(state, workspaceId) &&
    selectWorkspaceParticipationContext.select(state, workspaceId)
  )
    return false;
  const snapshot = state.principal?.snapshot;
  return (
    snapshot?.capabilities.workspaceGuestRoles === true &&
    (snapshot.capabilities.hostMembership
      ? snapshot.principal.hostRole === 'guest'
      : !snapshot.principal.isAdministrator)
  );
});

export const selectCanReadScriptDefinition = store.createSelector(
  (state, workspaceId: string, script: { purpose?: string } | null | undefined): boolean =>
    !selectUsesGuestScriptScope.select(state, workspaceId) ||
    (!!selectWorkspaceGuestManagerContext.select(state, workspaceId) &&
      script?.purpose === 'saved'),
);

function visibleScript(
  state: StoreState,
  wsId: string | null | undefined,
  script: ScriptListEntry | undefined,
) {
  return !!wsId && !!script && selectCanReadScriptDefinition.select(state, wsId, script);
}

function getWs(state: StoreState, wsId: string | null | undefined) {
  if (!wsId) return emptyWorkspaceState;
  return state.scripts.byWorkspaceId[wsId] ?? emptyWorkspaceState;
}

/** Scripts initialized state (active workspace). */
export const selectScriptsInitialized = store.createSelector(
  (state, wsId: string | null): boolean => {
    const ws = getWs(state, wsId);
    return ws.initialized;
  },
);

/** Normal list membership excludes definitions recovered only for output viewers. */
export const selectScriptEntries = store.createSelector(
  (state, wsId: string | null): ScriptListEntry[] => {
    const ws = getWs(state, wsId);
    if (ws.activeScriptIds) {
      return ws.activeScriptIds.flatMap((id) =>
        visibleScript(state, wsId, ws.scripts[id]) ? [ws.scripts[id]] : [],
      );
    }
    return Object.values(ws.scripts).filter(
      (script) => !script.archivedAt && visibleScript(state, wsId, script),
    );
  },
);

/** Live scripts — running or restarting (active workspace). */
export const selectRunningScripts = store.createSelector(
  (state, wsId: string | null): ScriptListEntry[] => {
    return selectScriptEntries
      .select(state, wsId)
      .filter((s) => isLiveScriptStatus((s.runtime ?? createDefaultRuntimeState()).status));
  },
);

/** Get a specific script by ID (active workspace). */
export const selectScriptById = store.createSelector(
  (state, wsId: string | null, scriptId: string) => {
    const ws = getWs(state, wsId);
    return visibleScript(state, wsId, ws.scripts[scriptId]) ? ws.scripts[scriptId] : null;
  },
);

/** Get runtime state for a specific script (active workspace). */
export const selectScriptRuntime = store.createSelector(
  (state, wsId: string | null, scriptId: string) => {
    return selectScriptById.select(state, wsId, scriptId)?.runtime ?? createDefaultRuntimeState();
  },
);

/** Get the raw-chunk output buffer for a specific script (active workspace). */
export const selectScriptOutput = store.createSelector(
  (state, wsId: string | null, scriptId: string) => {
    const ws = getWs(state, wsId);
    return selectCanReadScriptDefinition.select(state, wsId ?? '', ws.scripts[scriptId])
      ? (ws.outputBuffers[scriptId] ?? emptyOutputBuffer)
      : emptyOutputBuffer;
  },
);

/** Formatted retained output belongs to a single mounted viewer lifetime. */
export const selectScriptRetainedOutput = store.createSelector(
  (state, wsId: string, scriptId: string, viewerId: string) => {
    const output = getWs(state, wsId).retainedOutputs?.[viewerId];
    return output?.scriptId === scriptId &&
      selectCanReadScriptDefinition.select(state, wsId, getWs(state, wsId).scripts[scriptId])
      ? output
      : undefined;
  },
);

/** Scripts data for a specific workspace (parameterized). */
export const selectWorkspaceScriptsInitialized = store.createSelector(
  (state, wsId: string): boolean => getWs(state, wsId).initialized,
);

export const selectWorkspaceScriptEntries = store.createSelector(
  (state, wsId: string): ScriptListEntry[] => {
    const ws = getWs(state, wsId);
    if (ws.activeScriptIds) {
      return ws.activeScriptIds.flatMap((id) =>
        visibleScript(state, wsId, ws.scripts[id]) ? [ws.scripts[id]] : [],
      );
    }
    return Object.values(ws.scripts).filter(
      (script) => !script.archivedAt && visibleScript(state, wsId, script),
    );
  },
);

export const selectWorkspaceScriptOperations = store.createSelector(
  (state, wsId: string): Record<string, ScriptOperationState> => {
    const ws = getWs(state, wsId);
    if (!ws.detectionOperation?.pending) return ws.operations;
    // Every row shares detection's reservation, including newly hydrated rows.
    return {
      ...ws.operations,
      ...Object.fromEntries(Object.keys(ws.scripts).map((id) => [id, ws.detectionOperation!])),
    };
  },
);

export const selectScriptDetectionOperation = store.createSelector(
  (state, wsId: string): ScriptOperationState | undefined => getWs(state, wsId).detectionOperation,
);

export const selectScriptWorkflowOutcome = store.createSelector(
  (state, consumerId: string, workspaceId: string, resourceId: string) => {
    const outcomes = getWs(state, workspaceId).workflowOutcomes;
    const outcome = outcomes ? getItem(outcomes, consumerId) : undefined;
    return outcome?.workspaceId === workspaceId && outcome.resourceId === resourceId
      ? outcome
      : undefined;
  },
);

/** Get runtime for a script in a specific workspace (parameterized). */
export const selectWorkspaceScriptRuntime = store.createSelector(
  (state, wsId: string, scriptId: string) => {
    return selectScriptById.select(state, wsId, scriptId)?.runtime ?? createDefaultRuntimeState();
  },
);

/** Loaded script rows; output viewers retain their selected IDs separately. */
export const selectAllWorkspaceScriptEntries = store.createSelector(
  (state, wsId: string): ScriptListEntry[] =>
    Object.values(getWs(state, wsId).scripts).filter((script) =>
      visibleScript(state, wsId, script),
    ),
);

/** Request-owned event journal; absence means the request was invalidated. */
export const selectScriptReadJournal = store.createSelector(
  (state, wsId: string, requestId: string) => getWs(state, wsId).pendingReads?.[requestId],
);

/** Deletion is available only for a known, stopped definition without an in-flight mutation. */
export const selectCanDeleteScript = store.createSelector(
  (state, wsId: string, scriptId: string): boolean => {
    const script = selectScriptById.select(state, wsId, scriptId);
    return (
      !!script &&
      !isLiveScriptStatus(script.runtime?.status) &&
      !getWs(state, wsId).detectionOperation?.pending &&
      !getWs(state, wsId).operations[scriptId]?.pending
    );
  },
);

export const selectScriptListPageState = store.createSelector((state, wsId: string | null) => ({
  nextCursor: getWs(state, wsId).nextCursor,
  loading: getWs(state, wsId).loading,
  error: getWs(state, wsId).loadError,
}));
