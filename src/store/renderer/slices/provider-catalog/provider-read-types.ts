import type { HostExecutionProjectionState } from '../host-execution/host-execution-projections';
import type { ProviderCatalogState } from './provider-catalog-types';
import type { ProviderModelsState } from '../provider-models/provider-models-types';
import type { ProviderSettingsState } from '../provider-settings/provider-settings-types';
import type { AgentAvailabilityState } from '../agent-availability/agent-availability-types';
import type { ModelState } from '../model/model-types';
import type { AgentSession } from '$shared/types/agent-session';

/** State read by the canonical projections; neither renderer's Store is imported. */
export type ProviderReadState = HostExecutionProjectionState & {
  providerCatalog: ProviderCatalogState;
  providerModels: ProviderModelsState;
  providerSettings: ProviderSettingsState;
  agentAvailability: AgentAvailabilityState;
  model: ModelState;
  agentSessions?: { byAgentId: Record<string, AgentSession> };
  sidebarNav?: { onboardingActive: boolean };
  userPreferences: HostExecutionProjectionState['userPreferences'] & {
    providerSetupHydratedBackendId?: string | null;
    hasCompletedProviderSetup?: boolean;
  };
};

/** Factories consume Store-bound selectors without assuming either renderer's extra state. */
export type ReadSelector<F extends (state: never, ...args: never[]) => unknown, State> = F extends (
  state: never,
  ...args: infer A
) => infer R
  ? import('@themislib/themis/saga').SelectorChannelSelector<R, A, State>
  : never;
