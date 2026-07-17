/**
 * External-editors persistence service — restores the localStorage persistence
 * that the removed `external-editors/sagas/persistence-saga` performed. With no
 * saga listening, Open-In action choices and hidden-editor preferences never
 * persisted across relaunches.
 *
 * This reconnects the path WITHOUT re-adding a saga and WITHOUT changing any
 * call site:
 *   - On first dispatch it hydrates hidden editor IDs from localStorage once
 *     (silently ignoring errors).
 *   - After `setOpenAction` it writes the choice to localStorage.
 *   - After `toggleHiddenEditor` it writes the updated set to localStorage.
 *
 * Storage keys match the app-settings-schema (see
 * `src/shared/app-settings-schema.ts` openIn.hiddenEditors definition) so
 * persisted state remains compatible with settings UI and other persistence
 * paths.
 *
 * Dependency-light per src/store/renderer/AGENTS.md: imports only safe-storage,
 * configured store, and slice actions — no AppClient, no selectors, no store
 * module.
 */
import type { StoreMiddleware } from "@augmentcode/ag-redux-toolkit/types";
import { safeLocalStorage } from "$lib/utils/safe-storage";
import { store as appStore } from "$store/renderer/store";
import type { StoreState } from "../types";
import {
  normalizeHiddenEditorIds,
  setHiddenEditorIds,
  setOpenAction,
  toggleHiddenEditor,
} from "../slices/external-editors/external-editors-slice";

const STORAGE_KEY = "open-combo-button-last-action";
const HIDDEN_EDITORS_STORAGE_KEY = "legacy-settings:hiddenOpenInEditors";

let hydrated = false;

/** Hydrate hidden editor IDs from localStorage (fire-once on first dispatch). */
function hydrateHiddenEditorIds(): void {
  if (hydrated) return;
  hydrated = true;
  try {
    const stored = safeLocalStorage.getItem(HIDDEN_EDITORS_STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      const normalized = normalizeHiddenEditorIds(parsed);
      appStore.dispatch(setHiddenEditorIds(normalized));
    }
  } catch {
    // Ignore load errors; hidden editors default to visible.
  }
}

/** Persist hidden editor IDs to localStorage. */
function persistHiddenEditorIds(state: StoreState): void {
  const hiddenEditorIds = state.externalEditors.hiddenEditorIds;
  try {
    safeLocalStorage.setItem(HIDDEN_EDITORS_STORAGE_KEY, JSON.stringify(hiddenEditorIds));
  } catch {
    // Ignore save errors.
  }
}

export function createExternalEditorsPersistenceMiddleware(): StoreMiddleware {
  return () => (next) => (action) => {
    // Hydrate on first dispatch
    if (!hydrated) {
      hydrateHiddenEditorIds();
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
