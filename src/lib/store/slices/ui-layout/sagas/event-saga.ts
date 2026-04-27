import { call, takeEvery } from "typed-redux-saga";
import { selectIsCollapsed, selectWidthBeforeCollapse } from "../ui-layout-selectors";
import { setCollapsed, toggleSidebar } from "../ui-layout-slice";
import { dispatchWindowEvent } from "$lib/utils/window-events";

function dispatchSidebarEvent(collapsed: boolean, restoreWidth: number): void {
  if (typeof window !== "undefined") {
    dispatchWindowEvent("workspace:toggle-left-sidebar", { collapsed, restoreWidth });
  }
}

export function* eventSaga() {
  yield* takeEvery([toggleSidebar.type, setCollapsed.type], function* () {
    const isCollapsed = yield* selectIsCollapsed.effect();
    const restoreWidth = yield* selectWidthBeforeCollapse.effect();
    yield* call(dispatchSidebarEvent, isCollapsed, restoreWidth);
  });
}