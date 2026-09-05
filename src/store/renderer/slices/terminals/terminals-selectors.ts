import { store } from '../../store';
import { type StoreState } from '$store/renderer/types';
import { emptyWorkspaceState, type TerminalTab } from './terminals-slice';
import { getItem, getItems } from '@augmentcode/themis/utils/collections/collection-utils';
import { terminalDisplayName } from '$lib/utils/terminal-display-name';

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
  return getWsById(state, wsId).height ?? state.terminals.height;
});

export const selectActiveTerminalId = store.createSelector((state, wsId: string | null) => {
  return getActiveWs(state, wsId).activeTerminalId;
});

export const selectTerminals = store.createSelector((state, wsId: string | null) => {
  return getItems(getActiveWs(state, wsId).terminals);
});

/**
 * Selected script tab for the active workspace, validated against the scripts
 * slice: once scripts are initialized for the workspace, a selection pointing
 * at a missing script (deleted, or a stale persisted id) reads as null. While
 * scripts are still hydrating the raw id is returned so a restored script tab
 * isn't dropped before `script.list` lands.
 */
export const selectSelectedScriptId = store.createSelector((state, wsId: string | null) => {
  if (!wsId) return null;
  const selectedScriptId = getWsById(state, wsId).selectedScriptId;
  if (!selectedScriptId) return null;
  const scriptsWs = state.scripts.byWorkspaceId[wsId];
  if (scriptsWs?.initialized && !scriptsWs.scripts[selectedScriptId]) return null;
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

/** Select only user-created terminals, filtering out agent terminals (IDs starting with "agent-") */
export const selectUserTerminals = store.createSelector((state, wsId: string | null) => {
  return getItems(getActiveWs(state, wsId).terminals).filter(
    (terminal) => !terminal.id.startsWith('agent-'),
  );
});

/** Select workspace terminal state by workspace ID (parameterized) */
export const selectWorkspaceTerminalState = store.createSelector((state, wsId: string) => {
  return state.terminals.workspaces[wsId] || emptyWorkspaceState;
});

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
