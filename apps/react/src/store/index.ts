import '@tanstack/react-start/client-only';
import { ReactStore } from '@themislib/themis/react-store';
import type { StoreState } from '@themislib/themis/types';
import { catalogReducer } from './catalog/catalog-slice';
import { uiHighlightReducer } from '../../../../src/store/renderer/slices/ui-highlight/ui-highlight-slice';
import { autoUpdateReducer } from '../../../../src/store/renderer/slices/auto-update/auto-update-slice';
import { uiLayoutReducer } from '../../../../src/store/renderer/slices/ui-layout/ui-layout-slice';
import { userPreferencesReducer } from '../../../../src/store/renderer/slices/user-preferences/user-preferences-slice';
import { daemonHealthReducer } from '../../../../src/store/renderer/slices/daemon-health/daemon-health-slice';
import { directoryPickerReducer } from '../../../../src/store/renderer/slices/directory-picker/directory-picker-slice';
import { connectionsReducer } from '../../../../src/store/renderer/slices/connections/connections-slice';
import { principalReducer } from '../../../../src/store/renderer/slices/principal/principal-slice';
import { hostExecutionReducer } from '../../../../src/store/renderer/slices/host-execution/host-execution-slice';
import { workspaceEventsReducer } from '../../../../src/store/renderer/slices/workspace-events/workspace-events-slice';
import { workspaceReducer } from '../../../../src/store/renderer/slices/workspace/workspace-slice';
import { workspaceLifecycleReducer } from '../../../../src/store/renderer/slices/workspace-lifecycle/workspace-lifecycle-slice';
import { providerCatalogReducer } from '../../../../src/store/renderer/slices/provider-catalog/provider-catalog-slice';
import { providerModelsReducer } from '../../../../src/store/renderer/slices/provider-models/provider-models-slice';
import { modelReducer } from '../../../../src/store/renderer/slices/model/model-slice';
import { providerSettingsReducer } from '../../../../src/store/renderer/slices/provider-settings/provider-settings-slice';
import { agentAvailabilityReducer } from '../../../../src/store/renderer/slices/agent-availability/agent-availability-slice';
import { backgroundAgentSettingsReducer } from '../../../../src/store/renderer/slices/background-agent-settings/background-agent-settings-slice';
import { linkTooltipReducer } from './link-tooltip/link-tooltip-slice';

export const store = new ReactStore({
  catalog: catalogReducer,
  uiHighlight: uiHighlightReducer,
  autoUpdate: autoUpdateReducer,
  uiLayout: uiLayoutReducer,
  userPreferences: userPreferencesReducer,
  daemonHealth: daemonHealthReducer,
  directoryPicker: directoryPickerReducer,
  linkTooltip: linkTooltipReducer,
  connections: connectionsReducer,
  principal: principalReducer,
  hostExecution: hostExecutionReducer,
  workspaceEvents: workspaceEventsReducer,
  workspace: workspaceReducer,
  workspaceLifecycle: workspaceLifecycleReducer,
  providerCatalog: providerCatalogReducer,
  providerModels: providerModelsReducer,
  model: modelReducer,
  providerSettings: providerSettingsReducer,
  agentAvailability: agentAvailabilityReducer,
  backgroundAgentSettings: backgroundAgentSettingsReducer,
});
export type AppState = StoreState<typeof store>;
