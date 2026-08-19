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
  openTab,
  openTabInAdjacentOrSplit,
  openTabInNewRootColumn,
  openTabInRightmostColumnRequested,
  restoreHiddenTab,
  setActiveTab,
} from '../../panel-layout/panel-layout-slice';
import { ensureAgentSessionLoaded } from '../../workspace-agents/workspace-agents-slice';
import { selectAgentSession } from '../../agent-session/agent-session-selectors';
import { focusBrowserTabRequested, openAgentTabRequested } from '../app-layout-slice';

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
  const targetWorkspaceId = detail.panelLayoutId ?? workspaceId;
  const openAction = detail.targetPanelId
    ? openTab(targetWorkspaceId, tab, detail.targetPanelId, undefined, true)
    : detail.openInAdjacentPanel
      ? openTabInAdjacentOrSplit(targetWorkspaceId, tab, detail.sourcePanelId, { force: true })
      : detail.openInNewColumn
        ? openTabInNewRootColumn(targetWorkspaceId, tab, {
            availableCanvasWidth: detail.availablePanelCanvasWidth,
            adaptiveFirstChat: detail.adaptiveFirstChat,
            force: true,
            sourcePanelId: detail.sourcePanelId,
          })
        : openTabInRightmostColumnRequested(targetWorkspaceId, tab, { force: true });
  yield* put(openAction);
}

function* focusBrowserTab(
  action: ReturnType<typeof focusBrowserTabRequested>,
): SagaGenerator<void> {
  const [workspaceId, tabId] = action.payload;
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
}

export function* appLayoutNavigationSaga(): SagaGenerator<void> {
  yield* takeEvery(openAgentTabRequested, openAgentTab);
  yield* takeEvery(focusBrowserTabRequested, focusBrowserTab);
}
