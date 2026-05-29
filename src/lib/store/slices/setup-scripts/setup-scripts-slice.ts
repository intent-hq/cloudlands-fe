import { createAction } from "svelte-redux-toolkit/utils/store/create-action";
import { createReducer } from "svelte-redux-toolkit/utils/store/create-reducer";
import {
  createCollection,
  addItemAt,
  getItem,
  getItems,
  removeItem as collectionRemoveItem,
  updateItem,
  type Collection,
} from "svelte-redux-toolkit/utils/collections/collection-utils";
import type { SetupScript, SetupScriptsState } from "./setup-scripts-types";

// ============================================================================
// Constants
// ============================================================================

const MAX_SCRIPTS = 50;
export const SETUP_SCRIPT_BANNER_DISMISSED_KEY = "setup-script-banner-dismissed";

// ============================================================================
// Initial State
// ============================================================================

export const initialState: SetupScriptsState = {
  scripts: createCollection<SetupScript, "id">("id"),
  pendingDeletions: {},
  isBannerDismissedGlobally: false,
  bannerDismissedByWorkspaceId: {},
};

function normalizeWorkspaceIds(workspaceIds: string[]): string[] {
  return [...new Set(workspaceIds.filter((workspaceId) => workspaceId.length > 0))];
}

// ============================================================================
// Actions
// ============================================================================

/** Hydrate scripts from localStorage on init */
export const hydrateScripts = createAction<[scripts: SetupScript[]]>(
  "setupScripts/hydrateScripts"
);

/** Save (create or update) a script. ID and timestamps are generated in the saga. */
export const saveScript = createAction<[script: SetupScript]>(
  "setupScripts/saveScript"
);

/** Record usage of a script */
export const recordScriptUsage = createAction<
  [scriptId: string, lastUsedAt: string, repoPath?: string]
>("setupScripts/recordScriptUsage");

/** Rename a script */
export const renameScript = createAction<[scriptId: string, newName: string]>(
  "setupScripts/renameScript"
);

/** Update script content (also updates lastUsedAt) */
export const updateScriptContent = createAction<
  [scriptId: string, content: string, lastUsedAt: string]
>("setupScripts/updateScriptContent");

/** Optimistic UI removal (pending deletion) */
export const removeScriptFromUI = createAction<[scriptId: string]>(
  "setupScripts/removeScriptFromUI"
);

/** Undo optimistic removal */
export const restoreScriptToUI = createAction<[scriptId: string]>(
  "setupScripts/restoreScriptToUI"
);

/** Permanently delete a script */
export const deleteScript = createAction<[scriptId: string]>(
  "setupScripts/deleteScript"
);

export const hydrateSetupScriptBannerDismissals = createAction<[
  isDismissedGlobally: boolean,
  workspaceIds: string[],
]>("setupScripts/hydrateSetupScriptBannerDismissals");

export const dismissSetupScriptBannerGlobally = createAction(
  "setupScripts/dismissSetupScriptBannerGlobally"
);

export const dismissSetupScriptBannerForWorkspace = createAction<[workspaceId: string]>(
  "setupScripts/dismissSetupScriptBannerForWorkspace"
);

// ============================================================================
// Reducer
// ============================================================================

function trimCollection(
  scripts: Collection<SetupScript, "id">
): Collection<SetupScript, "id"> {
  const items = getItems(scripts);
  if (items.length <= MAX_SCRIPTS) return scripts;
  return createCollection<SetupScript, "id">("id", items.slice(0, MAX_SCRIPTS));
}

export const setupScriptsReducer = createReducer<SetupScriptsState>(initialState)
  .with(hydrateScripts, (state, { payload: [scripts] }) => ({
    ...state,
    scripts: createCollection<SetupScript, "id">("id", scripts),
  }))
  .with(saveScript, (state, { payload: [script] }) => {
    // Check if script already exists (by id)
    const existing = getItem(state.scripts, script.id);
    if (existing) {
      // Update existing
      return {
        ...state,
        scripts: updateItem(state.scripts, script),
      };
    }
    // Add at front, then trim
    const added = addItemAt(state.scripts, 0, script);
    return {
      ...state,
      scripts: trimCollection(added),
    };
  })
  .with(recordScriptUsage, (state, { payload: [scriptId, lastUsedAt, repoPath] }) => {
    const script = getItem(state.scripts, scriptId);
    if (!script) return state;
    const updated: SetupScript = {
      ...script,
      lastUsedAt,
      usageCount: script.usageCount + 1,
      ...(repoPath && !script.repoPath ? { repoPath } : {}),
    };
    return { ...state, scripts: updateItem(state.scripts, updated) };
  })
  .with(renameScript, (state, { payload: [scriptId, newName] }) => {
    const script = getItem(state.scripts, scriptId);
    if (!script) return state;
    const trimmed = newName.trim() || "Custom Script";
    if (script.name === trimmed) return state;
    return {
      ...state,
      scripts: updateItem(state.scripts, { ...script, name: trimmed }),
    };
  })
  .with(updateScriptContent, (state, { payload: [scriptId, content, lastUsedAt] }) => {
    const script = getItem(state.scripts, scriptId);
    if (!script) return state;
    return {
      ...state,
      scripts: updateItem(state.scripts, { ...script, content, lastUsedAt }),
    };
  })
  .with(removeScriptFromUI, (state, { payload: [scriptId] }) => {
    if (state.pendingDeletions[scriptId]) return state;
    return {
      ...state,
      pendingDeletions: { ...state.pendingDeletions, [scriptId]: true as const },
    };
  })
  .with(restoreScriptToUI, (state, { payload: [scriptId] }) => {
    if (!state.pendingDeletions[scriptId]) return state;

    const { [scriptId]: _, ...rest } = state.pendingDeletions;
    return { ...state, pendingDeletions: rest };
  })
  .with(deleteScript, (state, { payload: [scriptId] }) => {

    const { [scriptId]: _, ...rest } = state.pendingDeletions;
    return {
      ...state,
      scripts: collectionRemoveItem(state.scripts, scriptId),
      pendingDeletions: rest,
    };
  })
  .with(hydrateSetupScriptBannerDismissals, (state, { payload: [isDismissedGlobally, workspaceIds] }) => ({
    ...state,
    isBannerDismissedGlobally: isDismissedGlobally,
    bannerDismissedByWorkspaceId: normalizeWorkspaceIds(workspaceIds).reduce<Record<string, true>>(
      (acc, workspaceId) => {
        acc[workspaceId] = true;
        return acc;
      },
      {}
    ),
  }))
  .with(dismissSetupScriptBannerGlobally, (state) => ({
    ...state,
    isBannerDismissedGlobally: true,
  }))
  .with(dismissSetupScriptBannerForWorkspace, (state, { payload: [workspaceId] }) => {
    if (!workspaceId) return state;
    return {
      ...state,
      bannerDismissedByWorkspaceId: {
        ...state.bannerDismissedByWorkspaceId,
        [workspaceId]: true,
      },
    };
  });

