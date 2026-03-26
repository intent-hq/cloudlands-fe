/**
 * Root sagas registry.
 * Each saga is registered here and managed by the saga manager.
 * Sagas are started/stopped via the RunSaga component.
 */

import { providerSettingsSaga } from "./slices/provider-settings/sagas/provider-settings-saga";
import { backgroundAgentSettingsSaga } from "./slices/background-agent-settings/sagas/background-agent-settings-saga";
import { externalEditorsSaga } from "./slices/external-editors/sagas/external-editors-saga";
import { tabStateSaga } from "./slices/tab-state/sagas/tab-state-saga";
import { terminalsSaga } from "./slices/terminals/sagas/terminals-saga";
import { userPreferencesSaga } from "./slices/user-preferences/sagas/user-preferences-saga";
import { workspaceSettingsSaga } from "./slices/workspace-settings/sagas/workspace-settings-saga";
import { noteReadTrackingSaga } from "./slices/note-read-tracking/sagas/note-read-tracking-saga";
import { permissionSaga } from "./slices/permission/sagas/permission-saga";
import { pipSaga } from "./slices/pip/sagas/pip-saga";
import { featureCodesSaga } from "./slices/feature-codes/sagas/feature-codes-saga";
import { gitOperationsSaga } from "./slices/git-operations/sagas/git-operations-saga";
import { knownReposSaga } from "./slices/known-repos/sagas/known-repos-saga";
import { deepLinksSaga } from "./slices/deep-links/sagas/deep-links-saga";
import { modelSaga } from "./slices/model/sagas/model-saga";
import { specialistsSaga } from "./slices/specialists/sagas/specialists-saga";
import { systemStatusSaga } from "./slices/system-status/sagas/system-status-saga";
import { uiLayoutSaga } from "./slices/ui-layout/sagas/ui-layout-saga";
import { uiSaga } from "./slices/ui-notifications/sagas/ui-notifications-saga";
import { workspaceOperationsSaga } from "./slices/workspace-operations/sagas/workspace-operations-saga";
import { workspaceSaga } from "./slices/workspace/sagas/workspace-saga";
import { workspaceAgentsSaga } from "./slices/workspace-agents/sagas/workspace-agents-saga";
import { authSaga } from "./slices/auth/sagas/auth-saga";
import { autoUpdateSaga } from "./slices/auto-update/sagas/auto-update-saga";
import { appLayoutSaga } from "./slices/app-layout/sagas/app-layout-saga";

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
  externalEditorsSaga,
  uiLayoutSaga,
  tabStateSaga,
  terminalsSaga,
  noteReadTrackingSaga,
  permissionSaga,
  featureCodesSaga,
  knownReposSaga,
  deepLinksSaga,
  modelSaga,
  specialistsSaga,
  systemStatusSaga,
  pipSaga,
  userPreferencesSaga,
  workspaceOperationsSaga,
  workspaceSettingsSaga,
  // Placeholder sagas for Store.svelte references — will be replaced with real implementations
  streamingSaga: noopSaga,
  workspaceSaga,
  gitSaga: gitOperationsSaga,
  fileTrackingSaga: noopSaga,
  notesSaga: noopSaga,
  agentsSaga: workspaceAgentsSaga,
  messagesSaga: noopSaga,
  contextSaga: noopSaga,
  browserSaga: noopSaga,
  mcpSaga: noopSaga,
  diffsSaga: noopSaga,
  settingsSaga: noopSaga,
  authSaga,
  uiSaga,
  layoutSaga: appLayoutSaga,
  autoUpdateSaga,
  workspaceInitializerSaga: noopSaga,
} as const;

// SagaName is defined in ./types.ts as an explicit string literal union to
// avoid a transitive import chain that pulls renderer-only modules into the
// main-process typecheck.  Re-export it here for backward compatibility.
export type { SagaName } from './types';

// Compile-time assertion: ensure the keys of `sagas` match `SagaName` exactly.
// If a saga is added/removed from the object above without updating the
// SagaName union in types.ts, one of these lines will produce a type error.
import type { SagaName as _SagaName } from './types';
type _AssertSagasExtendsName = Record<_SagaName, unknown> extends Record<keyof typeof sagas, unknown> ? true : never;
type _AssertNameExtendsSagas = Record<keyof typeof sagas, unknown> extends Record<_SagaName, unknown> ? true : never;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _assertSync: _AssertSagasExtendsName & _AssertNameExtendsSagas = true;

