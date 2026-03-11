import { call, takeEvery } from "typed-redux-saga";
import { toggleSidebar, setCollapsed } from "../sidebar-width-slice";
import { selectIsCollapsed } from "../sidebar-width-selectors";

const COLLAPSED_STORAGE_KEY = "workspace-left-panel-collapsed";

function saveCollapsed(collapsed: boolean): void {
  try {
    localStorage.setItem(COLLAPSED_STORAGE_KEY, collapsed ? "true" : "false");
  } catch {
    // Ignore errors
  }
}

/**
 * Watches for sidebar toggle/collapse changes and persists collapsed state to localStorage.
 * Note: width persistence is handled by ResizablePanel directly.
 */
export function* persistenceSaga() {
  yield* takeEvery(
    [toggleSidebar.type, setCollapsed.type],
    function* () {
      const isCollapsed = yield* selectIsCollapsed.effect();
      yield* call(saveCollapsed, isCollapsed);
    }
  );
}

