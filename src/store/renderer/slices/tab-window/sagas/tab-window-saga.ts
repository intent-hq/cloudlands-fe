/**
 * Tab windows (shared/types/tab-window.ts), renderer side.
 *
 * In an app window (the source):
 * - "Open in own window" keeps the tab as a hidden copy marked with the tab
 *   window id (`tabMovedToWindow`), then asks main to open the window. A
 *   failed open puts the tab back.
 * - Main's events keep that copy current, show it again when the tab comes
 *   back, or close it when it was closed in its window.
 * - A reveal of the copy (sidebar, agent focusTab) brings its window up.
 * - When a layout restores, a copy whose window is gone (not restored)
 *   comes back to a panel.
 *
 * In a tab window: read the record from main, show the tab in a one-tab
 * layout, load its workspace, report tab changes, and move the tab back or
 * close it on request. Its workspace deleted closes it for real; the tab
 * leaving its one-tab layout any other way moves it back.
 */
import {
  call,
  delay,
  fork,
  put,
  take,
  takeEvery,
  takeLatest,
  type SagaGenerator,
} from 'typed-redux-saga';
import { invoke, isElectron } from '$lib/electron-bridge';
import { tabWindowsAvailable } from '$lib/tab-window/tab-window-availability';
import { currentTabWindowId } from '$lib/tab-window/tab-window-renderer';
import { setTabWindowRecord } from '$lib/tab-window/tab-window-state';
import { createLogger } from '$lib/utils/client-logger';
import { showWorkspaceSaga } from '$lib/utils/show-workspace';
import { IPC_CHANNELS } from '$shared/ipc-registry';
import { m } from '$shared/paraglide/messages.js';
import {
  canMoveTabToWindow,
  isTabWindowLayoutId,
  tabWindowLayoutId,
  type TabWindowClosedTabEvent,
  type TabWindowGetResult,
  type TabWindowIsOpenResult,
  type TabWindowRecord,
  type TabWindowReturnEvent,
  type TabWindowTab,
  type TabWindowTabUpdatedEvent,
} from '$shared/types/tab-window';
import { takeEveryFromElectronChannel } from '../../../utils/ipc-channel';
import { hydrateBrowserClientsRequested } from '../../browser-clients/browser-clients-slice';
import { routedWorkspaceId } from '../../../utils/routed-workspace-id';
import type { PanelTab } from '../../panel-layout/panel-layout-types';
import { selectHiddenTabs, selectPanels } from '../../panel-layout/panel-layout-selectors';
import {
  closeTab,
  initializeLayout,
  restoreHiddenTab,
  revealHiddenTabAvoidingPanel,
  setRestoreStatus,
  tabMovedToWindow,
  tabReturnedFromWindow,
  updateTabBrowserUrl,
  updateTabFavicon,
  updateTabTitle,
} from '../../panel-layout/panel-layout-slice';
import { hydrateWorkspaceLayout } from '../../panel-layout/sagas/panel-layout-saga';
import {
  workspaceDeleted,
  workspaceLoadRequested,
} from '../../workspace-lifecycle/workspace-lifecycle-slice';
import {
  closeTabWindowTabRequested,
  moveTabBackRequested,
  openTabInOwnWindowRequested,
} from '../tab-window-slice';

const logger = createLogger('TabWindows');
const CHANNELS = IPC_CHANNELS.TAB_WINDOW;

/** How long tab changes in a tab window settle before main hears of them. */
const UPDATE_DEBOUNCE_MS = 250;

const LOSSLESS = {
  bufferPolicy: { kind: 'lossless', rationale: 'A tab moving back or closing must not be lost.' },
} as const;

async function toastError(message: string): Promise<void> {
  try {
    const { notify } = await import('$lib/components/patterns/notify');
    notify.error(message);
  } catch {
    // Toasts are best-effort.
  }
}

function newTabWindowId(): string {
  return crypto.randomUUID();
}

function findPanelTab(panels: Record<string, { tabs: PanelTab[] }>, tabId: string) {
  return Object.values(panels)
    .flatMap((panel) => panel.tabs)
    .find((tab) => tab.id === tabId);
}

// ---------------------------------------------------------------------------
// App window (the window a tab comes from)
// ---------------------------------------------------------------------------

function* openInOwnWindow(
  action: ReturnType<typeof openTabInOwnWindowRequested>,
): SagaGenerator<void> {
  const [layoutId, workspaceId, tabId] = action.payload;
  if (!tabWindowsAvailable() || isTabWindowLayoutId(layoutId)) return;
  const tab = findPanelTab(yield* selectPanels.effect(layoutId), tabId);
  if (!tab) return;
  if (!canMoveTabToWindow(tab)) {
    yield* call(toastError, m.tabWindow_unsavedChanges_error());
    return;
  }
  const tabWindowId = newTabWindowId();
  yield* put(tabMovedToWindow(layoutId, tabId, tabWindowId));
  try {
    yield* call(invoke, CHANNELS.OPEN, {
      tabWindowId,
      workspaceId,
      sourceLayoutId: layoutId,
      tab,
    });
  } catch (error) {
    logger.warn('Could not open a tab window', { error });
    yield* put(tabReturnedFromWindow(layoutId, tab));
    yield* call(toastError, m.tabWindow_openFailed_error());
  }
}

/** The source layout is restored here before a tab goes in or out of it. */
function* ensureLayout(layoutId: string): SagaGenerator<void> {
  try {
    yield* call(hydrateWorkspaceLayout, layoutId);
  } catch (error) {
    logger.debug('Could not restore the layout a tab window tab belongs to', { error });
  }
}

function* onTabReturned(event: TabWindowReturnEvent | null): SagaGenerator<void> {
  if (!event?.tab?.id) return;
  yield* call(ensureLayout, event.sourceLayoutId);
  yield* put(tabReturnedFromWindow(event.sourceLayoutId, event.tab as PanelTab));
  if (event.reveal && routedWorkspaceId() !== event.workspaceId) {
    yield* call(showWorkspaceSaga, event.workspaceId);
  }
}

function* onTabUpdated(event: TabWindowTabUpdatedEvent | null): SagaGenerator<void> {
  if (!event?.tab?.id) return;
  const { sourceLayoutId: layoutId } = event;
  const tab = event.tab as PanelTab;
  const hidden = (yield* selectHiddenTabs.effect(layoutId)).find((t) => t.id === tab.id);
  if (!hidden?.tabWindowId) return;
  if (typeof tab.title === 'string' && tab.title !== hidden.title) {
    yield* put(updateTabTitle(layoutId, tab.id, tab.title));
  }
  if (tab.browserUrl && tab.browserUrl !== hidden.browserUrl) {
    yield* put(
      updateTabBrowserUrl(layoutId, tab.id, tab.browserUrl, tab.browserRequestedUrl ?? null),
    );
  }
  if (tab.faviconUrl && tab.faviconUrl !== hidden.faviconUrl) {
    yield* put(updateTabFavicon(layoutId, tab.id, tab.faviconUrl));
  }
}

function* onTabClosedInWindow(event: TabWindowClosedTabEvent | null): SagaGenerator<void> {
  if (!event?.tabId) return;
  yield* call(ensureLayout, event.sourceLayoutId);
  yield* put(closeTab(event.sourceLayoutId, event.tabId, undefined, undefined, { destroy: true }));
}

/**
 * The hidden copy of a tab is in a tab window that is gone: closed for real
 * (destroy the copy) or not open (show it here again, without moving focus
 * to it from wherever the user is).
 */
function* settleOrphan(layoutId: string, tab: PanelTab): SagaGenerator<boolean> {
  if (!tab.tabWindowId) return false;
  let status: TabWindowIsOpenResult;
  try {
    status = yield* call(invoke<TabWindowIsOpenResult>, CHANNELS.IS_OPEN, {
      tabWindowId: tab.tabWindowId,
    });
  } catch {
    return false;
  }
  if (status.open) return false;
  if (status.closed) {
    yield* put(closeTab(layoutId, tab.id, undefined, undefined, { destroy: true }));
  } else {
    yield* put(tabReturnedFromWindow(layoutId, tab));
  }
  return true;
}

/** A reveal of a hidden tab that is in its own window brings that window up instead. */
function* onRevealHidden(
  action: ReturnType<typeof restoreHiddenTab> | ReturnType<typeof revealHiddenTabAvoidingPanel>,
): SagaGenerator<void> {
  const { wsId, tabId } = action.payload;
  const tab = (yield* selectHiddenTabs.effect(wsId)).find((t) => t.id === tabId);
  if (!tab?.tabWindowId) return;
  try {
    const result = yield* call(invoke<{ focused: boolean }>, CHANNELS.FOCUS, {
      tabWindowId: tab.tabWindowId,
    });
    if (result?.focused) return;
  } catch (error) {
    logger.debug('Could not bring a tab window up', { error });
  }
  yield* call(settleOrphan, wsId, tab);
}

function* onLayoutSettled(action: ReturnType<typeof setRestoreStatus>): SagaGenerator<void> {
  const [layoutId, status] = action.payload;
  if (status !== 'restored' || isTabWindowLayoutId(layoutId)) return;
  for (const tab of yield* selectHiddenTabs.effect(layoutId)) {
    if (tab.tabWindowId) yield* call(settleOrphan, layoutId, tab);
  }
}

function* sourceWindowSaga(): SagaGenerator<void> {
  yield* takeEvery(openTabInOwnWindowRequested, openInOwnWindow);
  yield* takeEvery([restoreHiddenTab, revealHiddenTabAvoidingPanel], onRevealHidden);
  yield* takeEvery(setRestoreStatus, onLayoutSettled);
  if (!isElectron()) return;
  yield* takeEveryFromElectronChannel<TabWindowReturnEvent | null>(
    CHANNELS.RETURN_TAB,
    onTabReturned,
    LOSSLESS,
  );
  yield* takeEveryFromElectronChannel<TabWindowTabUpdatedEvent | null>(
    CHANNELS.TAB_UPDATED,
    onTabUpdated,
    { bufferPolicy: { kind: 'sliding', limit: 50, rationale: 'Only the latest tab state matters.' } },
  );
  yield* takeEveryFromElectronChannel<TabWindowClosedTabEvent | null>(
    CHANNELS.CLOSED_TAB,
    onTabClosedInWindow,
    LOSSLESS,
  );
}

// ---------------------------------------------------------------------------
// Tab window
// ---------------------------------------------------------------------------

/** The panel id of a tab window's one panel. */
const TAB_WINDOW_PANEL_ID = 'tab-window-panel';

function syncedFields(tab: TabWindowTab): string {
  return JSON.stringify([tab.title, tab.browserUrl, tab.browserRequestedUrl, tab.faviconUrl]);
}

function* closeForReal(): SagaGenerator<void> {
  try {
    yield* call(invoke, CHANNELS.CLOSE_TAB);
  } catch (error) {
    logger.warn('Could not close the tab window tab', { error });
  }
}

/** Report tab changes to main, and move the tab back when it left the layout. */
function* watchTab(record: TabWindowRecord, layoutId: string): SagaGenerator<void> {
  let reported = syncedFields(record.tab);
  let leaving = false;
  yield* takeLatest(
    (action: { type: string }) => action.type.startsWith('panelLayout/'),
    function* () {
      yield* delay(UPDATE_DEBOUNCE_MS);
      const tab = findPanelTab(yield* selectPanels.effect(layoutId), record.tab.id);
      if (!tab) {
        // The tab left this window's layout (its own close, or a cleanup
        // that runs here too). Move it back rather than close it: nothing is
        // lost, and the source window's own state decides what stays.
        if (leaving) return;
        leaving = true;
        try {
          yield* call(invoke, CHANNELS.MOVE_BACK);
        } catch (error) {
          logger.warn('Could not move the tab back', { error });
        }
        return;
      }
      const fields = syncedFields(tab);
      if (fields === reported) return;
      reported = fields;
      try {
        yield* call(invoke, CHANNELS.UPDATE, { tab });
      } catch (error) {
        logger.debug('Could not report a tab window change', { error });
      }
    },
  );
}

function* tabWindowSagaFor(tabWindowId: string): SagaGenerator<void> {
  let record: TabWindowRecord | null = null;
  try {
    record = (yield* call(invoke<TabWindowGetResult>, CHANNELS.GET)).record;
  } catch (error) {
    logger.warn('Could not read the tab window', { error });
  }
  if (!record || record.tabWindowId !== tabWindowId) {
    setTabWindowRecord(null);
    return;
  }
  const layoutId = tabWindowLayoutId(tabWindowId);
  yield* put(
    initializeLayout(layoutId, {
      root: { type: 'panel', panelId: TAB_WINDOW_PANEL_ID },
      panels: {
        [TAB_WINDOW_PANEL_ID]: {
          id: TAB_WINDOW_PANEL_ID,
          tabs: [record.tab as PanelTab],
          activeTabId: record.tab.id,
        },
      },
      focusedPanelId: TAB_WINDOW_PANEL_ID,
    }),
  );
  setTabWindowRecord(record);
  yield* put(workspaceLoadRequested(record.workspaceId));
  // A browser tab is live only once this renderer knows its own client id
  // (the registry host); it learns it with the client list.
  if (record.tab.type === 'browser') yield* put(hydrateBrowserClientsRequested(record.workspaceId));
  yield* fork(watchTab, record, layoutId);
  yield* takeEvery(moveTabBackRequested, function* () {
    try {
      yield* call(invoke, CHANNELS.MOVE_BACK);
    } catch (error) {
      logger.warn('Could not move the tab back', { error });
    }
  });
  yield* takeEvery(closeTabWindowTabRequested, closeForReal);
  const workspaceId = record.workspaceId;
  // Its workspace was deleted: the tab has nothing to go back to.
  yield* take(
    (action: { type: string; payload?: unknown }) =>
      action.type === workspaceDeleted.type &&
      Array.isArray(action.payload) &&
      action.payload[0] === workspaceId,
  );
  yield* call(closeForReal);
}

export function* tabWindowSaga(): SagaGenerator<void> {
  const tabWindowId = currentTabWindowId();
  if (tabWindowId) yield* call(tabWindowSagaFor, tabWindowId);
  else yield* call(sourceWindowSaga);
}
