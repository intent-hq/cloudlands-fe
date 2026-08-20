import { put, takeEvery, type SagaGenerator } from 'typed-redux-saga';

import { m } from '$shared/paraglide/messages.js';
import type { PanelTab } from '../../panel-layout/panel-layout-types';
import {
  selectHiddenTabs,
  selectPanels,
  selectPendingPanelReveal,
} from '../../panel-layout/panel-layout-selectors';
import {
  focusPanel,
  openTabInNewRootColumn,
  restoreHiddenTab,
  setActiveTab,
  setPanelPinned,
} from '../../panel-layout/panel-layout-slice';
import {
  selectPanelOpenMode,
  selectPanelStackDirection,
} from '../../user-preferences/user-preferences-selectors';
import { ensureAgentSessionLoaded } from '../../workspace-agents/workspace-agents-slice';
import { selectAgentSession } from '../../agent-session/agent-session-selectors';
import { focusBrowserTabRequested, openAgentTabRequested } from '../app-layout-slice';

function* pinRevealedPanel(workspaceId: string, requestId: string): SagaGenerator<void> {
  const reveal = yield* selectPendingPanelReveal.effect(workspaceId);
  if (reveal?.requestId !== requestId) return;
  yield* put(setPanelPinned(workspaceId, reveal.panelId, true));
}

function* openAgentTab(action: ReturnType<typeof openAgentTabRequested>): SagaGenerator<void> {
  const [workspaceId, detail] = action.payload;
  if (!workspaceId || !detail?.agentId) return;

  yield* put(ensureAgentSessionLoaded(workspaceId, detail.agentId));
  const agent = yield* selectAgentSession.effect(detail.agentId);
  const tab: Omit<PanelTab, 'id'> = {
    type: 'agent',
    title: agent?.name || m.layout_tabTypes_agent_title(),
    agentId: detail.agentId,
    workspaceId,
    closable: true,
  };
  const panelOpenMode = yield* selectPanelOpenMode.effect();

  const targetWorkspaceId = detail.panelLayoutId ?? workspaceId;
  const openAction = openTabInNewRootColumn(targetWorkspaceId, tab, {
    ...(detail.openInNewColumn
      ? {
          availableCanvasWidth: detail.availablePanelCanvasWidth,
          adaptiveFirstChat: detail.adaptiveFirstChat,
        }
      : { sourcePanelId: detail.sourcePanelId }),
    force: true,
    panelOpenMode,
    panelStackDirection: yield* selectPanelStackDirection.effect(),
  });
  yield* put(openAction);
  if (detail.pin === true) {
    yield* pinRevealedPanel(targetWorkspaceId, openAction.payload.newTabId);
  }
}

function* focusBrowserTab(
  action: ReturnType<typeof focusBrowserTabRequested>,
): SagaGenerator<void> {
  const [workspaceId, tabId, pin] = action.payload;
  if (!workspaceId || !tabId) return;
  let panels = yield* selectPanels.effect(workspaceId);
  let target = Object.entries(panels).find(([, panel]) =>
    panel.tabs.some((tab) => tab.id === tabId && tab.type === 'browser'),
  );
  if (!target) {
    // A hidden (user-closed) agent-owned tab: focusTab is the explicit
    // reveal path (monorepo#2857) — restore it into a panel, then focus.
    const hiddenTabs = yield* selectHiddenTabs.effect(workspaceId);
    if (!hiddenTabs.some((tab) => tab.id === tabId && tab.type === 'browser')) return;
    yield* put(restoreHiddenTab(workspaceId, tabId));
    panels = yield* selectPanels.effect(workspaceId);
    target = Object.entries(panels).find(([, panel]) =>
      panel.tabs.some((tab) => tab.id === tabId && tab.type === 'browser'),
    );
    if (!target) return;
  }

  const [panelId] = target;
  yield* put(setActiveTab(workspaceId, tabId, panelId));
  const focusAction = focusPanel(workspaceId, panelId);
  yield* put(focusAction);
  if (pin === true) {
    yield* pinRevealedPanel(workspaceId, focusAction.payload.requestId);
  }
}

export function* appLayoutNavigationSaga(): SagaGenerator<void> {
  yield* takeEvery(openAgentTabRequested, openAgentTab);
  yield* takeEvery(focusBrowserTabRequested, focusBrowserTab);
}
