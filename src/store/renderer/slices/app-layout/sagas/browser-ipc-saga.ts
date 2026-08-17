import type { Task } from 'redux-saga';
import { all, call, join, put, type SagaGenerator } from 'typed-redux-saga';

import { invoke, isElectron } from '$lib/electron-bridge';
import { m } from '$shared/paraglide/messages.js';
import {
  isWorkspaceCommandPayload,
  type BrowserCloseTabPayload,
  type BrowserFocusTabPayload,
  type BrowserListTabsRequestPayload,
  type BrowserOpenTabPayload,
} from '$shared/ipc/workspace-command-payloads';
import { takeEveryFromElectronChannel } from '../../../utils/ipc-channel';
import {
  selectAllTabs,
  selectPanelLayoutWorkspaces,
} from '../../panel-layout/panel-layout-selectors';
import {
  closeTab,
  openTab,
  openTabInAdjacentOrSplit,
  setActiveTab,
  updateTabBrowserUrl,
} from '../../panel-layout/panel-layout-slice';
import type { PanelTab } from '../../panel-layout/panel-layout-types';
import { focusBrowserTabRequested } from '../app-layout-slice';

let running = false;

function browserTab(url: string): Omit<PanelTab, 'id'> {
  return { type: 'browser', title: 'Browser', browserUrl: url, closable: true };
}

function* openBrowser(data: BrowserOpenTabPayload | null): SagaGenerator<void> {
  if (!isWorkspaceCommandPayload(data) || typeof data.url !== 'string') return;
  const workspaceId = data.workspaceId;

  // Main pre-generates the tab id so it can lease agent-opened tabs for
  // exact-URL dedupe (monorepo#2541); fall back to renderer generation for
  // payloads without one. allowDuplicate mirrors the agent's explicit opt-out
  // of dedupe so the panel layout's equivalent-tab reuse doesn't override it.
  const newTabId = typeof data.tabId === 'string' && data.tabId.length > 0 ? data.tabId : undefined;
  const allowDuplicate = data.allowDuplicate === true ? true : undefined;

  const position = data.position ?? 'adjacent';
  if (position === 'replace') {
    const tabs = yield* selectAllTabs.effect(workspaceId);
    const existing = tabs.find((tab) => tab.type === 'browser');
    if (existing) {
      yield* put(updateTabBrowserUrl(workspaceId, existing.id, data.url));
      yield* put(setActiveTab(workspaceId, existing.id));
      return;
    }
    yield* put(
      openTab(
        workspaceId,
        browserTab(data.url),
        undefined,
        newTabId,
        undefined,
        undefined,
        allowDuplicate,
      ),
    );
    return;
  }
  if (position === 'adjacent') {
    yield* put(
      openTabInAdjacentOrSplit(workspaceId, browserTab(data.url), undefined, {
        newTabId,
        allowDuplicate,
      }),
    );
    return;
  }
  yield* put(
    openTab(
      workspaceId,
      browserTab(data.url),
      undefined,
      newTabId,
      undefined,
      undefined,
      allowDuplicate,
    ),
  );
}

function* closeBrowser(data: BrowserCloseTabPayload | null): SagaGenerator<void> {
  if (!isWorkspaceCommandPayload(data) || typeof data.tabId !== 'string' || data.tabId.length === 0)
    return;
  const workspaceId = data.workspaceId;

  const tabs = yield* selectAllTabs.effect(workspaceId);
  const existing = tabs.find((tab) => tab.id === data.tabId && tab.type === 'browser');
  if (!existing || existing.closable === false) return;

  yield* put(closeTab(workspaceId, data.tabId));
}

function* focusBrowser(data: BrowserFocusTabPayload | null): SagaGenerator<void> {
  if (!isWorkspaceCommandPayload(data) || typeof data.tabId !== 'string' || data.tabId.length === 0)
    return;
  // Route by the payload's workspaceId so a request for a background
  // workspace (or a non-focused window) still focuses the right layout's
  // tab — the old PanelLayout listener gated on the active layout and
  // answered with its own workspaceId (monorepo#2756 RC2).
  yield* put(focusBrowserTabRequested(data.workspaceId, data.tabId));
}

function* listBrowserTabs(data: BrowserListTabsRequestPayload | null): SagaGenerator<void> {
  if (!isWorkspaceCommandPayload(data)) return;
  const workspaceId = data.workspaceId;
  const requestId = typeof data.requestId === 'string' ? data.requestId : undefined;

  // Only answer for workspaces this window's layout state actually holds.
  // A window that does not hold the requested workspace must never resolve
  // the requestId: an empty wrong-workspace reply poisons main's
  // per-workspace tab cache (monorepo#2756 RC1, #2602).
  const layouts = yield* selectPanelLayoutWorkspaces.effect();
  if (!(workspaceId in layouts)) return;

  const browserTabs = (yield* selectAllTabs.effect(workspaceId))
    .filter((tab) => tab.type === 'browser')
    .map((tab) => ({
      tabId: tab.id,
      url: tab.browserUrl || '',
      title: tab.title || m.layout_panelLayout_browser_fallback(),
      closable: tab.closable !== false,
    }));

  // Echo the requestId back so main resolves the matching pending request
  // (concurrent requests must not consume each other's replies).
  yield* call(invoke, 'browser:list-tabs-response', { tabs: browserTabs, requestId });
}

export function* browserIpcSaga(): SagaGenerator<void> {
  if (!isElectron() || running) return;
  running = true;
  try {
    const tasks: Task[] = [
      yield* takeEveryFromElectronChannel<BrowserOpenTabPayload | null>(
        'browser:open-tab',
        openBrowser,
        {
          bufferPolicy: {
            kind: 'lossless',
            rationale: 'Every requested browser tab must be opened in arrival order.',
          },
        },
      ),
      yield* takeEveryFromElectronChannel<BrowserCloseTabPayload | null>(
        'browser:close-tab',
        closeBrowser,
        {
          bufferPolicy: {
            kind: 'lossless',
            rationale: 'Every requested browser tab close must be applied in arrival order.',
          },
        },
      ),
      yield* takeEveryFromElectronChannel<BrowserFocusTabPayload | null>(
        'browser:focus-tab',
        focusBrowser,
        {
          bufferPolicy: {
            kind: 'lossless',
            rationale: 'Every requested browser tab focus must be applied in arrival order.',
          },
        },
      ),
      yield* takeEveryFromElectronChannel<BrowserListTabsRequestPayload | null>(
        'browser:list-tabs-request',
        listBrowserTabs,
        {
          bufferPolicy: {
            kind: 'lossless',
            rationale: 'Every list request must be answered; main resolves replies by requestId.',
          },
        },
      ),
    ];
    yield* all(tasks.map((task) => join(task)));
  } finally {
    running = false;
  }
}
