import { store } from '../../store';
import { splitLegacyCompoundId } from '$shared/utils/legacy-model-id';
import { selectProviderModels } from '../model/model-selectors';
import { selectEffectiveDefaultProviderId } from '../provider-catalog/provider-catalog-selectors';
import { selectSpecialists } from '../specialists/specialists-selectors';
import { selectActiveProviderId } from './provider-settings-selectors';
import { m } from '$shared/paraglide/messages.js';

/**
 * Map of providerId -> human-readable reason why the provider is "in use"
 * and therefore cannot be disabled.
 *
 * A provider counts as in use when it is explicitly pinned by:
 * - the global default model (the active selection in `model.providerModels`,
 *   pinning the default provider — the map key carries provenance), or
 * - a specialist's explicit `codingAgent`, or
 * - a specialist's explicit model id (legacy compound ids pin their prefix
 *   provider; bare ids pin the default provider unless an explicit coding
 *   agent covers them).
 */
export const selectProviderInUseReasons = store.createSelector((state): Record<string, string> => {
  const reasons: Record<string, string> = {};
  const addReason = (providerId: string, reason: string) => {
    if (!reasons[providerId]) reasons[providerId] = reason;
  };

  // Only an explicitly selected global model counts as a pin. The
  // catalog-derived default fallback used by selectSelectedModel is implicit
  // and must not permanently block the default provider. providerModels
  // values are bare ids keyed by provider, so the pinned provider is the
  // default provider itself. ProviderSelector already hides Disable for the
  // default provider; the pin is defense in depth for callers that bypass
  // that UI (e.g. toggles or agent-driven settings proposals).
  const defaultProviderId = selectEffectiveDefaultProviderId.select(state);
  const activeProviderId = selectActiveProviderId.select(state);
  const globalModel = selectProviderModels.select(state)[activeProviderId];
  if (globalModel && activeProviderId) {
    addReason(
      activeProviderId,
      m.settings_providers_inUseDefaultModel_label({ model: globalModel }),
    );
  }

  for (const specialist of selectSpecialists.select(state)) {
    if (specialist.codingAgent) {
      addReason(
        specialist.codingAgent,
        m.settings_providers_inUseSpecialistAgent_label({ name: specialist.name }),
      );
    }
    // Explicit model pin.
    if (specialist.defaultModel) {
      if (specialist.defaultModel.includes(':')) {
        const providerId =
          splitLegacyCompoundId(specialist.defaultModel).providerId ?? defaultProviderId;
        addReason(
          providerId,
          m.settings_providers_inUseSpecialistModel_label({
            name: specialist.name,
            model: specialist.defaultModel,
          }),
        );
      } else if (!specialist.codingAgent) {
        // Bare model id with no explicit agent resolves to the default provider.
        addReason(
          defaultProviderId,
          m.settings_providers_inUseSpecialistModel_label({
            name: specialist.name,
            model: specialist.defaultModel,
          }),
        );
      }
    }
  }

  return reasons;
});

/** Reason a provider cannot be disabled, or null when it is not in use. */
export const selectProviderInUseReason = store.createSelector(
  (state, providerId: string): string | null => {
    return selectProviderInUseReasons.select(state)[providerId] ?? null;
  },
);
