import { createSelector } from "../../utils/create-selector";
import type { CommandPaletteAction, PendingSidebarLocate } from "./app-layout-types";

export const selectPendingCommandPaletteAction = createSelector<[], CommandPaletteAction | null>(
  (state) => state.appLayout.pendingCommandPaletteAction,
);

export const selectPendingLocateInSidebar = createSelector<[], PendingSidebarLocate | null>(
  (state) => state.appLayout.pendingLocateInSidebar,
);

