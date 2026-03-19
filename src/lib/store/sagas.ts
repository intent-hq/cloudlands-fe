/**
 * Root sagas registry.
 * Each saga is registered here and managed by the saga manager.
 * Sagas are started/stopped via the RunSaga component.
 */

import { providerSettingsSaga } from "./slices/provider-settings/sagas/provider-settings-saga";
import { backgroundAgentSettingsSaga } from "./slices/background-agent-settings/sagas/background-agent-settings-saga";
import { fontSettingsSaga } from "./slices/font-settings/sagas/font-settings-saga";
import { externalEditorsSaga } from "./slices/external-editors/sagas/external-editors-saga";
import { tabStateSaga } from "./slices/tab-state/sagas/tab-state-saga";
import { terminalOverlaySaga } from "./slices/terminal-overlay/sagas/terminal-overlay-saga";
import { notificationSettingsSaga } from "./slices/notification-settings/sagas/notification-settings-saga";
import { userPreferencesSaga } from "./slices/user-preferences/sagas/user-preferences-saga";
import { workspaceSettingsSaga } from "./slices/workspace-settings/sagas/workspace-settings-saga";
import { noteReadTrackingSaga } from "./slices/note-read-tracking/sagas/note-read-tracking-saga";
import { permissionSaga } from "./slices/permission/sagas/permission-saga";
import { pipSaga } from "./slices/pip/sagas/pip-saga";
import { featureCodesSaga } from "./slices/feature-codes/sagas/feature-codes-saga";
import { modelSaga } from "./slices/model/sagas/model-saga";
import { specialistsSaga } from "./slices/specialists/sagas/specialists-saga";
import { uiLayoutSaga } from "./slices/ui-layout/sagas/ui-layout-saga";

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
  providerSettingsSaga,
  backgroundAgentSettingsSaga,
  fontSettingsSaga,
  externalEditorsSaga,
  uiLayoutSaga,
  tabStateSaga,
  terminalOverlaySaga,
  notificationSettingsSaga,
  noteReadTrackingSaga,
  permissionSaga,
  featureCodesSaga,
  modelSaga,
  specialistsSaga,
  pipSaga,
  userPreferencesSaga,
  workspaceSettingsSaga,
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

