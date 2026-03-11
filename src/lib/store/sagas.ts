/**
 * Root sagas registry.
 * Each saga is registered here and managed by the saga manager.
 * Sagas are started/stopped via the RunSaga component.
 */

import { openActionSaga } from "./slices/open-action/sagas/open-action-saga";
import { sidebarWidthSaga } from "./slices/sidebar-width/sagas/sidebar-width-saga";
import { tabScrollSaga } from "./slices/tab-scroll/sagas/tab-scroll-saga";
import { terminalOverlaySaga } from "./slices/terminal-overlay/sagas/terminal-overlay-saga";
import { zoomSaga } from "./slices/zoom/sagas/zoom-saga";

// eslint-disable-next-line @typescript-eslint/no-empty-function
function* noopSaga() {}

/**
 * All registered sagas.
 * Add new sagas here as slices are migrated.
 *
 * Note: Saga names referenced in Store.svelte (streamingSaga, workspaceSaga, etc.)
 * will be added here as their respective stores are migrated.
 */
export const sagas = {
  openActionSaga,
  sidebarWidthSaga,
  tabScrollSaga,
  terminalOverlaySaga,
  zoomSaga,
  // Placeholder sagas for Store.svelte references — will be replaced with real implementations
  streamingSaga: noopSaga,
  workspaceSaga: noopSaga,
  gitSaga: noopSaga,
  fileTrackingSaga: noopSaga,
  notesSaga: noopSaga,
  agentsSaga: noopSaga,
  messagesSaga: noopSaga,
  contextSaga: noopSaga,
  browserSaga: noopSaga,
  mcpSaga: noopSaga,
  diffsSaga: noopSaga,
  settingsSaga: noopSaga,
  authSaga: noopSaga,
  uiSaga: noopSaga,
  layoutSaga: noopSaga,
  terminalsSaga: noopSaga,
  autoUpdateSaga: noopSaga,
  workspaceInitializerSaga: noopSaga,
} as const;

export type SagaName = keyof typeof sagas;

