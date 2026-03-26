import type { Workspace } from "$shared/types";
import { createSelector } from "../../utils/create-selector";
import { defaultPanelVisibility, type PanelVisibilityState } from "./workspace-slice";

export const selectActiveWorkspaceId = createSelector((state) => {
  return state.workspace.activeWorkspaceId;
});

// ---------------------------------------------------------------------------
// Workspace entity selectors
// ---------------------------------------------------------------------------

/**
 * Select a workspace entity by ID from Redux.
 * Returns undefined if not stored yet.
 */
export const selectWorkspaceById = createSelector<[wsId: string], Workspace | undefined>(
  (state, wsId) => {
    return state.workspace.byWorkspaceId[wsId];
  }
);

/**
 * Select the active workspace entity from Redux.
 * Resolves `activeWorkspaceId` against `byWorkspaceId`.
 * Returns undefined if no active workspace or if it hasn't been hydrated yet.
 */
export const selectActiveWorkspace = createSelector<[], Workspace | undefined>((state) => {
  const wsId = state.workspace.activeWorkspaceId;
  if (!wsId) return undefined;
  return state.workspace.byWorkspaceId[wsId];
});

// ---------------------------------------------------------------------------
// Panel visibility selectors
// ---------------------------------------------------------------------------

/**
 * Select the full panel visibility state for a workspace.
 * Returns defaultPanelVisibility when no state has been set yet.
 */
export const selectPanelVisibility = createSelector<[wsId: string], PanelVisibilityState>(
  (state, wsId) => {
    return state.workspace.panelVisibility.byWorkspaceId[wsId] ?? defaultPanelVisibility;
  }
);

/**
 * Select a single panel visibility flag for a workspace.
 */
export const selectPanelVisibilityFlag = createSelector<
  [wsId: string, key: keyof PanelVisibilityState],
  boolean
>((state, wsId, key) => {
  const vis = state.workspace.panelVisibility.byWorkspaceId[wsId];
  return vis ? vis[key] : defaultPanelVisibility[key];
});