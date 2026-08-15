import { put, takeEvery, type SagaGenerator } from 'typed-redux-saga';

import { m } from '$shared/paraglide/messages.js';
import type { PanelTab } from '../../panel-layout/panel-layout-types';
import {
  openTab,
  openTabInAdjacentOrSplit,
  openTabInNewRootColumn,
} from '../../panel-layout/panel-layout-slice';
import { ensureAgentSessionLoaded } from '../../workspace-agents/workspace-agents-slice';
import { selectAgentSession } from '../../agent-session/agent-session-selectors';
import { openAgentTabRequested } from '../app-layout-slice';

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

export function* appLayoutNavigationSaga(): SagaGenerator<void> {
  yield* takeEvery(openAgentTabRequested, openAgentTab);
}
