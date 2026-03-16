import { createSelector } from "../../utils/create-selector";
import { getPipKey, type PipWindowState } from "./pip-slice";

/** Select whether a tab has an open PiP window */
export const selectHasPipWindow = createSelector(
  (state, workspaceId: string, tabId: string): boolean => {
    const key = getPipKey(workspaceId, tabId);
    return key in state.pip.openPipWindows;
  }
);

/** Select the PiP window state for a tab */
export const selectPipWindow = createSelector(
  (state, workspaceId: string, tabId: string): PipWindowState | undefined => {
    const key = getPipKey(workspaceId, tabId);
    return state.pip.openPipWindows[key];
  }
);

/** Select all PiP windows for a workspace */
export const selectPipWindowsForWorkspace = createSelector(
  (state, workspaceId: string): PipWindowState[] => {
    const windows = state.pip.openPipWindows;
    const prefix = `${workspaceId}:`;
    const result: PipWindowState[] = [];
    for (const key of Object.keys(windows)) {
      if (key.startsWith(prefix)) {
        result.push(windows[key]);
      }
    }
    return result;
  }
);

/** Select all open PiP windows */
export const selectAllPipWindows = createSelector((state): PipWindowState[] => {
  return Object.values(state.pip.openPipWindows);
});

