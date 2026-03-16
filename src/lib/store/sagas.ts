/**
 * Root sagas registry.
 * Each saga is registered here and managed by the saga manager.
 * Sagas are started/stopped via the RunSaga component.
 */

import { agentFontSettingsSaga } from "./slices/agent-font-settings/sagas/agent-font-settings-saga";
import { noteFontSettingsSaga } from "./slices/note-font-settings/sagas/note-font-settings-saga";
import { codeFontSettingsSaga } from "./slices/code-font-settings/sagas/code-font-settings-saga";
import { editorSettingsSaga } from "./slices/editor-settings/sagas/editor-settings-saga";
import { openActionSaga } from "./slices/open-action/sagas/open-action-saga";
import { sidebarWidthSaga } from "./slices/sidebar-width/sagas/sidebar-width-saga";
import { tabScrollSaga } from "./slices/tab-scroll/sagas/tab-scroll-saga";
import { terminalOverlaySaga } from "./slices/terminal-overlay/sagas/terminal-overlay-saga";
import { notificationSettingsSaga } from "./slices/notification-settings/sagas/notification-settings-saga";
import { noteSpellcheckSettingsSaga } from "./slices/note-spellcheck-settings/sagas/note-spellcheck-settings-saga";
import { workspaceSettingsSaga } from "./slices/workspace-settings/sagas/workspace-settings-saga";
import { betaUpdatesSaga } from "./slices/beta-updates/sagas/beta-updates-saga";
import { noteReadTrackingSaga } from "./slices/note-read-tracking/sagas/note-read-tracking-saga";
import { installedEditorsSaga } from "./slices/installed-editors/sagas/installed-editors-saga";
import { permissionSaga } from "./slices/permission/sagas/permission-saga";
import { pipSaga } from "./slices/pip/sagas/pip-saga";
import { featureCodesSaga } from "./slices/feature-codes/sagas/feature-codes-saga";
import { modelSaga } from "./slices/model/sagas/model-saga";
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
  betaUpdatesSaga,
  agentFontSettingsSaga,
  noteFontSettingsSaga,
  codeFontSettingsSaga,
  editorSettingsSaga,
  openActionSaga,
  sidebarWidthSaga,
  tabScrollSaga,
  terminalOverlaySaga,
  notificationSettingsSaga,
  noteSpellcheckSettingsSaga,
  noteReadTrackingSaga,
  installedEditorsSaga,
  permissionSaga,
  featureCodesSaga,
  modelSaga,
  pipSaga,
  workspaceSettingsSaga,
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

