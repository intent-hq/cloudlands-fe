import type { Task } from 'redux-saga';
import { all, join, put, type SagaGenerator } from 'typed-redux-saga';

import { isElectron } from '$lib/electron-bridge';
import { takeEveryFromElectronChannel } from '../../../utils/ipc-channel';
import { selectAllTabs } from '../../panel-layout/panel-layout-selectors';
import {
  closeTab,
  openTab,
  openTabInAdjacentOrSplit,
  setActiveTab,
  updateTabBrowserUrl,
} from '../../panel-layout/panel-layout-slice';
import type { PanelTab } from '../../panel-layout/panel-layout-types';
import { selectActiveWorkspaceId } from '../../workspace/workspace-selectors';

type BrowserOpenTabEvent = {
  url: string;
  position?: 'adjacent' | 'replace' | 'same';
  workspaceId?: string;
};

type BrowserCloseTabEvent = {
  tabId: string;
  workspaceId?: string;
};

let running = false;

function browserTab(url: string): Omit<PanelTab, 'id'> {
  return { type: 'browser', title: 'Browser', browserUrl: url, closable: true };
}

function* openBrowser(data: BrowserOpenTabEvent | null): SagaGenerator<void> {
  if (typeof data?.url !== 'string') return;
  const activeWorkspaceId = data.workspaceId ? null : yield* selectActiveWorkspaceId.effect();
  const workspaceId = data.workspaceId || activeWorkspaceId;
  if (typeof workspaceId !== 'string' || workspaceId.length === 0) return;

  const position = data.position ?? 'adjacent';
  if (position === 'replace') {
    const tabs = yield* selectAllTabs.effect(workspaceId);
    const existing = tabs.find((tab) => tab.type === 'browser');
    if (existing) {
      yield* put(updateTabBrowserUrl(workspaceId, existing.id, data.url));
      yield* put(setActiveTab(workspaceId, existing.id));
      return;
    }
    yield* put(openTab(workspaceId, browserTab(data.url)));
    return;
  }
  if (position === 'adjacent') {
    yield* put(openTabInAdjacentOrSplit(workspaceId, browserTab(data.url)));
    return;
  }
  yield* put(openTab(workspaceId, browserTab(data.url)));
}

function* closeBrowser(data: BrowserCloseTabEvent | null): SagaGenerator<void> {
  if (typeof data?.tabId !== 'string' || data.tabId.length === 0) return;
  const activeWorkspaceId = data.workspaceId ? null : yield* selectActiveWorkspaceId.effect();
  const workspaceId = data.workspaceId || activeWorkspaceId;
  if (typeof workspaceId !== 'string' || workspaceId.length === 0) return;

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
      yield* takeEveryFromElectronChannel<BrowserOpenTabEvent | null>(
        'browser:open-tab',
        openBrowser,
        {
          bufferPolicy: {
            kind: 'lossless',
            rationale: 'Every requested browser tab must be opened in arrival order.',
          },
        },
      ),
      yield* takeEveryFromElectronChannel<BrowserCloseTabEvent | null>(
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
