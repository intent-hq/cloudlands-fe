import { call, takeEvery } from "typed-redux-saga";
import { toggleSidebar, setCollapsed } from "../sidebar-width-slice";
import { selectIsCollapsed, selectWidthBeforeCollapse } from "../sidebar-width-selectors";

/**
 * Dispatches a DOM CustomEvent when sidebar toggle/collapse state changes.
 * This notifies ResizablePanel to update its visual state.
 */
function dispatchSidebarEvent(collapsed: boolean, restoreWidth: number): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent("workspace:toggle-left-sidebar", {
        detail: { collapsed, restoreWidth },
      })
    );
  }
}

/**
 * Watches for sidebar toggle/collapse actions and dispatches DOM events.
 */
export function* eventSaga() {
  yield* takeEvery(
    [toggleSidebar.type, setCollapsed.type],
    function* () {
      const isCollapsed = yield* selectIsCollapsed.effect();
      const restoreWidth = yield* selectWidthBeforeCollapse.effect();
      yield* call(dispatchSidebarEvent, isCollapsed, restoreWidth);
    }
  );
}

