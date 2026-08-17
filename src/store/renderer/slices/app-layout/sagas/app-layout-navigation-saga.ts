import { put, takeEvery, type SagaGenerator } from 'typed-redux-saga';

import { m } from '$shared/paraglide/messages.js';
import type { PanelTab } from '../../panel-layout/panel-layout-types';
import {
  focusPanel,
  openTab,
  openTabInAdjacentOrSplit,
  openTabInNewRootColumn,
  setActiveTab,
} from '../../panel-layout/panel-layout-slice';
import { selectPanels } from '../../panel-layout/panel-layout-selectors';
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

  if (detail.openInNewColumn) {
    yield* put(
      openTabInNewRootColumn(detail.panelLayoutId ?? workspaceId, tab, {
        availableCanvasWidth: detail.availablePanelCanvasWidth,
        adaptiveFirstChat: detail.adaptiveFirstChat,
        force: true,
      }),
    );
    return;
  }
  if (detail.openInAdjacentPanel) {
    yield* put(openTabInAdjacentOrSplit(workspaceId, tab, detail.sourcePanelId, { force: true }));
    return;
  }
  yield* put(openTab(workspaceId, tab, detail.sourcePanelId, undefined, true));
}

function* focusBrowserTab(
  action: ReturnType<typeof focusBrowserTabRequested>,
): SagaGenerator<void> {
  const [wsId, tabId] = action.payload;
  if (!wsId || !tabId) return;

  const panels = yield* selectPanels.effect(wsId);
  for (const [panelId, panel] of Object.entries(panels)) {
    // Only browser tabs may be activated: focusTab is a browser-only action,
    // so an arbitrary supplied id matching an agent/note/terminal tab must
    // not bring that unrelated tab to the front.
    if (panel.tabs.some((tab) => tab.id === tabId && tab.type === 'browser')) {
      yield* put(focusPanel(wsId, panelId));
      yield* put(setActiveTab(wsId, tabId, panelId));
      return;
    }
  }
}

export function* appLayoutNavigationSaga(): SagaGenerator<void> {
  yield* takeEvery(openAgentTabRequested, openAgentTab);
  yield* takeEvery(focusBrowserTabRequested, focusBrowserTab);
}
