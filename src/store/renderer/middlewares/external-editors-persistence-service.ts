/**
 * External-editors persistence service — restores the localStorage + settings
 * persistence that the removed `external-editors/sagas/persistence-saga`
 * performed. With no saga listening, Open-In action choices and hidden-editor
 * preferences never persisted across relaunches.
 *
 * This reconnects the path WITHOUT re-adding a saga and WITHOUT changing any
 * call site:
 *   - On creation it hydrates hidden editor IDs from daemon settings once
 *     (silently ignoring errors).
 *   - After `setOpenAction` it writes the choice to localStorage.
 *   - After `toggleHiddenEditor` it writes the updated set to daemon settings.
 *
 * Storage keys and payload shape match the reference saga (see deleted
 * `external-editors/sagas/persistence-saga.ts` at 95d908a2~1) so persisted
 * state remains cross-compatible with the pre-port app.
 *
 * Dependency-light per src/store/renderer/AGENTS.md: imports only safe-storage,
 * AppClient seam, configured store, and slice actions — no selectors and no
 * store module.
 */
import type { StoreMiddleware } from "@augmentcode/ag-redux-toolkit/types";
import { safeLocalStorage } from "$lib/utils/safe-storage";
import { appClient } from "$lib/client";
import { store as appStore } from "$store/renderer/store";
import type { StoreState } from "../types";
import {
  normalizeHiddenEditorIds,
  setHiddenEditorIds,
  setOpenAction,
  toggleHiddenEditor,
} from "../slices/external-editors/external-editors-slice";

const STORAGE_KEY = "open-combo-button-last-action";
const HIDDEN_OPEN_IN_EDITORS_KEY = "hiddenOpenInEditors";

let hydrated = false;

/** Hydrate hidden editor IDs from daemon settings (fire-once on first dispatch). */
async function hydrateHiddenEditorIds(): Promise<void> {
  if (hydrated) return;
  hydrated = true;
  try {
    const result = await appClient.settings.get(HIDDEN_OPEN_IN_EDITORS_KEY);
    if (result?.value !== undefined && result.value !== null) {
      const normalized = normalizeHiddenEditorIds(result.value);
      appStore.dispatch(setHiddenEditorIds(normalized));
    }
  } catch {
    // Ignore load errors; hidden editors default to visible.
  }
}

/** Persist hidden editor IDs to daemon settings (fire-and-forget). */
function persistHiddenEditorIds(state: StoreState): void {
  const hiddenEditorIds = state.externalEditors.hiddenEditorIds;
  void appClient.settings
    .update([{ path: HIDDEN_OPEN_IN_EDITORS_KEY, value: hiddenEditorIds }])
    .catch(() => {
      // Ignore save errors.
    });
}

export function createExternalEditorsPersistenceMiddleware(): StoreMiddleware {
  return () => (next) => (action) => {
    // Hydrate on first dispatch
    if (!hydrated) {
      void hydrateHiddenEditorIds();
    }

    const result = next(action);

    if (action && typeof action.type === "string") {
      const payload = Array.isArray(action.payload) ? action.payload : [];

      switch (action.type) {
        case setOpenAction.type: {
          const openAction = payload[0];
          if (typeof openAction === "string") {
            safeLocalStorage.setItem(STORAGE_KEY, openAction);
          }
          break;
        }
        case toggleHiddenEditor.type:
          persistHiddenEditorIds(appStore.state);
          break;
      }
    }

    return result;
  };
}
