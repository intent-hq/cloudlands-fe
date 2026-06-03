import { store } from "../../store";
import type { CommandPaletteAction, PendingSidebarLocate } from "./app-layout-types";

export const selectPendingCommandPaletteAction = store.createSelector<[], CommandPaletteAction | null>(
  (state) => state.appLayout.pendingCommandPaletteAction,
);

export const selectPendingLocateInSidebar = store.createSelector<[], PendingSidebarLocate | null>(
  (state) => state.appLayout.pendingLocateInSidebar,
);

