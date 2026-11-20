/**
 * Tab windows (shared/types/tab-window.ts): the requests the UI makes. The
 * layout changes are panel-layout actions (`tabMovedToWindow`,
 * `tabReturnedFromWindow`); the saga talks to main.
 */
import { createAction } from '@themislib/themis/utils/store/create-action';

/** Move a tab of this window to a window of its own (tab menu, Cmd/Ctrl+Shift+Enter). */
export const openTabInOwnWindowRequested = createAction<
  [layoutId: string, workspaceId: string, tabId: string]
>('tabWindow/openTabInOwnWindowRequested');

/** The tab window's tab goes back to the window it came from (header button, shortcut, Cmd+W). */
export const moveTabBackRequested = createAction('tabWindow/moveTabBackRequested');

/** Close the tab window's tab for real (header "Close tab", its workspace is gone). */
export const closeTabWindowTabRequested = createAction('tabWindow/closeTabWindowTabRequested');
