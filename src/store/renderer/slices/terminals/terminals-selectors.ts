import { store } from '../../store';
import { type StoreState } from '$store/renderer/types';
import {
  DEFAULT_TERMINAL_PLACEMENT,
  emptyWorkspaceState,
  type TerminalPlacement,
  type TerminalTab,
} from './terminals-slice';
import { getItem, getItems } from '@themislib/themis/utils/collections/collection-utils';
import { terminalDisplayName } from '$lib/utils/terminal-display-name';

export const selectTerminalCreationOutcome = store.createSelector(
  (state, consumerId: string, workspaceId: string, resourceId: string) => {
    const outcome = getItem(state.terminals.creationOutcomes, consumerId);
    return outcome?.workspaceId === workspaceId && outcome.resourceId === resourceId
      ? outcome
      : undefined;
  },
);

function getActiveWs(state: StoreState, wsId: string | null | undefined) {
  if (!wsId) return emptyWorkspaceState;
  return state.terminals.workspaces[wsId] || emptyWorkspaceState;
}

function getWsById(state: StoreState, wsId: string) {
  return state.terminals.workspaces[wsId] || emptyWorkspaceState;
}

function isSetupTerminal(terminal: TerminalTab): boolean {
  return (terminal.customName || terminal.name) === 'Setup';
}

/** Overlay height for a workspace; workspaces that were never resized read the fallback. */
export const selectTerminalOverlayHeight = store.createSelector((state, wsId: string) => {
  return state.terminals.workspaceHeights[wsId] ?? state.terminals.height;
});

export const selectActiveTerminalId = store.createSelector((state, wsId: string | null) => {
  return getActiveWs(state, wsId).activeTerminalId;
});

export const selectTerminals = store.createSelector((state, wsId: string | null) => {
  return getItems(getActiveWs(state, wsId).terminals);
});

/** A known selected ID survives partial pages and archive retirement. */
export const selectSelectedScriptId = store.createSelector((state, wsId: string | null) => {
  if (!wsId) return null;
  const selectedScriptId = getWsById(state, wsId).selectedScriptId;
  if (!selectedScriptId) return null;
  return selectedScriptId;
});

export const selectIsTerminalOverlayOpenForWorkspace = store.createSelector(
  (state, wsId: string) => {
    return getWsById(state, wsId).isOpen;
  },
);

export const selectActiveTerminalIdForWorkspace = store.createSelector((state, wsId: string) => {
  return getWsById(state, wsId).activeTerminalId;
});

export const selectTerminalsForWorkspace = store.createSelector((state, wsId: string) => {
  return getItems(getWsById(state, wsId).terminals);
});

export const selectWorkspaceSetupTerminal = store.createSelector((state, wsId: string) => {
  return getItems(getWsById(state, wsId).terminals).find(isSetupTerminal);
});

/** Select workspace terminal state by workspace ID (parameterized) */
export const selectWorkspaceTerminalState = store.createSelector((state, wsId: string) => {
  return state.terminals.workspaces[wsId] || emptyWorkspaceState;
});

/**
 * Surface a terminal (`id` = terminal id) or script output (`id` = script id)
 * was last shown on in the workspace; unknown ids read as `'overlay'`.
 * In-memory placements win; before the workspace's first terminal load the
 * boot-hydrated entry (not yet consumed) answers so an early click on a
 * script does not fall back to the overlay default.
 */
export const selectTerminalPlacement = store.createSelector(
  (state, wsId: string, id: string): TerminalPlacement => {
    return (
      getWsById(state, wsId).placements[id] ??
      state.terminals.workspacePlacements[wsId]?.[id] ??
      DEFAULT_TERMINAL_PLACEMENT
    );
  },
);

/**
 * Stored placements hydrated at boot that the workspace has not consumed yet
 * (its first `loadWorkspaceTerminals` has not run); `undefined` afterwards.
 */
export const selectHydratedWorkspacePlacements = store.createSelector(
  (state, wsId: string): Record<string, TerminalPlacement> | undefined => {
    return state.terminals.workspacePlacements[wsId];
  },
);

export const selectTerminalDisplayName = store.createSelector(
  (state, wsId: string | null, termId: string): string => {
    const ws = getActiveWs(state, wsId);
    const term = getItem(ws.terminals, termId);
    // Display resolution is customName || localized daemon name || fallback;
    // the stored wire `name` stays raw — localization is render-time only.
    // Read languagePreference (even though terminalDisplayName() doesn't take
    // it directly) so the cached selector's path-tracking sees it as a
    // dependency: m.*() output changes when the locale changes, and without
    // this Themis selector's memoization has no state path to invalidate on.
    void state.userPreferences?.languagePreference;
    return terminalDisplayName(term ?? {});
  },
);
