import { createSelector } from "../../utils/create-selector";
import type { CommandPaletteAction, PendingSidebarLocate } from "./app-layout-slice";

export const selectPendingCommandPaletteAction = createSelector<[], CommandPaletteAction | null>(
  (state) => state.appLayout.pendingCommandPaletteAction,
);

export const selectPendingLocateInSidebar = createSelector<[], PendingSidebarLocate | null>(
  (state) => state.appLayout.pendingLocateInSidebar,
);

