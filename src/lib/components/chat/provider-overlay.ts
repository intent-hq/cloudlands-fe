export type ProviderOverlayReason = 'hidden' | 'disabled' | 'unavailable' | null;

export interface ProviderOverlayStateInput {
  agentProviderId?: string;
  hiddenProviderIds: string[];
  disabledProviderIds: string[];
  unusableProviderIds: string[];
  canChangeAgentProvider: boolean;
}

export interface ProviderOverlayState {
  reason: ProviderOverlayReason;
  show: boolean;
}

export function resolveProviderOverlayState({
  agentProviderId,
  hiddenProviderIds,
  disabledProviderIds,
  unusableProviderIds,
  canChangeAgentProvider,
}: ProviderOverlayStateInput): ProviderOverlayState {
  if (!agentProviderId) {
    return { reason: null, show: false };
  }

  if (hiddenProviderIds.includes(agentProviderId)) {
    return { reason: 'hidden', show: true };
  }

  if (disabledProviderIds.includes(agentProviderId)) {
    return { reason: 'disabled', show: true };
  }

  if (unusableProviderIds.includes(agentProviderId) && !canChangeAgentProvider) {
    return { reason: 'unavailable', show: true };
  }

  return { reason: null, show: false };
}
