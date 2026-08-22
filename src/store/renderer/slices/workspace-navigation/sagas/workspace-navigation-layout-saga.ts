import { put, takeEvery, type SagaGenerator } from 'typed-redux-saga';

import { m } from '$shared/paraglide/messages.js';
import { openAgentTabRequested } from '../../app-layout/app-layout-slice';
import { openTabInRightmostColumnRequested } from '../../panel-layout/panel-layout-slice';
import type { PanelTab } from '../../panel-layout/panel-layout-types';
import {
  hydrateWorkspaceNavigation,
  type WorkspaceNavigationWorkspaceState,
} from '../workspace-navigation-slice';

function hydratedNoteId(state: WorkspaceNavigationWorkspaceState): string | null {
  if (state.mainPanel?.type !== 'notes') return null;
  const noteId = state.mainPanel.selectedNoteId;
  return typeof noteId === 'string' && noteId.length > 0 ? noteId : null;
}

function* applyHydratedLayout(
  action: ReturnType<typeof hydrateWorkspaceNavigation>,
): SagaGenerator<void> {
  const [workspaceId, state] = action.payload;
  if (!workspaceId || !state) return;

  const noteId = hydratedNoteId(state);
  if (noteId) {
    const tab: Omit<PanelTab, 'id'> = {
      type: 'note',
      title: noteId === 'spec' ? m.layout_shared_spec_title() : noteId,
      noteId,
      workspaceId,
      closable: true,
    };
    yield* put(openTabInRightmostColumnRequested(workspaceId, tab));
  }

  const drawer = state.drawer;
  if (!drawer?.open || drawer.type !== 'agent' || !drawer.itemId) return;
  yield* put(
    openAgentTabRequested(workspaceId, {
      agentId: drawer.itemId,
      openInAdjacentPanel: noteId !== null,
    }),
  );
}

export function* workspaceNavigationLayoutSaga(): SagaGenerator<void> {
  yield* takeEvery(hydrateWorkspaceNavigation, applyHydratedLayout);
}
