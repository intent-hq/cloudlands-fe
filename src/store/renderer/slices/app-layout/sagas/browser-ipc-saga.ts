import type { Task } from 'redux-saga';
import { all, join, put, type SagaGenerator } from 'typed-redux-saga';

import { isElectron } from '$lib/electron-bridge';
import {
  isWorkspaceCommandPayload,
  type BrowserCloseTabPayload,
  type BrowserOpenTabPayload,
} from '$shared/ipc/workspace-command-payloads';
import { takeEveryFromElectronChannel } from '../../../utils/ipc-channel';
import {
  selectAllTabs,
  selectPanels,
  selectPendingPanelReveal,
} from '../../panel-layout/panel-layout-selectors';
import {
  closeTab,
  focusPanel,
  openTab,
  openTabInNewRootColumn,
  setActiveTab,
  setPanelPinned,
  updateTabBrowserUrl,
} from '../../panel-layout/panel-layout-slice';
import type { PanelTab } from '../../panel-layout/panel-layout-types';
import { selectPanelOpenMode } from '../../user-preferences/user-preferences-selectors';

let running = false;

function browserTab(url: string): Omit<PanelTab, 'id'> {
  return { type: 'browser', title: 'Browser', browserUrl: url, closable: true };
}

function* pinRevealedPanel(workspaceId: string, requestId: string): SagaGenerator<void> {
  const reveal = yield* selectPendingPanelReveal.effect(workspaceId);
  if (reveal?.requestId !== requestId) return;
  yield* put(setPanelPinned(workspaceId, reveal.panelId, true));
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
  const pin = data.pin === true;

  const position = data.position ?? 'adjacent';
  if (position === 'replace') {
    const tabs = yield* selectAllTabs.effect(workspaceId);
    const existing = tabs.find((tab) => tab.type === 'browser');
    if (existing) {
      yield* put(updateTabBrowserUrl(workspaceId, existing.id, data.url));
      yield* put(setActiveTab(workspaceId, existing.id));
      if (pin) {
        const panels = yield* selectPanels.effect(workspaceId);
        const target = Object.entries(panels).find(([, panel]) =>
          panel.tabs.some((tab) => tab.id === existing.id),
        );
        if (target) {
          yield* put(setActiveTab(workspaceId, existing.id, target[0]));
          const focusAction = focusPanel(workspaceId, target[0]);
          yield* put(focusAction);
          yield* pinRevealedPanel(workspaceId, focusAction.payload.requestId);
        }
      }
      return;
    }
    const openAction = openTab(
      workspaceId,
      browserTab(data.url),
      undefined,
      newTabId,
      undefined,
      undefined,
      allowDuplicate,
    );
    yield* put(openAction);
    if (pin) yield* pinRevealedPanel(workspaceId, openAction.payload.newTabId);
    return;
  }
  if (position === 'adjacent') {
    const panelOpenMode = yield* selectPanelOpenMode.effect();
    const openAction = openTabInNewRootColumn(workspaceId, browserTab(data.url), {
      newTabId,
      allowDuplicate,
      panelOpenMode,
    });
    yield* put(openAction);
    if (pin) yield* pinRevealedPanel(workspaceId, openAction.payload.newTabId);
    return;
  }
  const openAction = openTab(
    workspaceId,
    browserTab(data.url),
    undefined,
    newTabId,
    undefined,
    undefined,
    allowDuplicate,
  );
  yield* put(openAction);
  if (pin) yield* pinRevealedPanel(workspaceId, openAction.payload.newTabId);
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
    ];
    yield* all(tasks.map((task) => join(task)));
  } finally {
    running = false;
  }
}
