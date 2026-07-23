import { store } from "../../store";
import {
  getDefaultProviderId,
  parseCompoundModelId,
} from "$shared/config/provider-config";
import { selectProviderModels } from "../model/model-selectors";
import { selectSpecialists } from "../specialists/specialists-selectors";
import { selectActiveProviderId } from "./provider-settings-selectors";

/**
 * Map of providerId -> human-readable reason why the provider is "in use"
 * and therefore cannot be disabled.
 *
 * A provider counts as in use when it is explicitly pinned by:
 * - the global default model (the active selection in `model.providerModels`;
 *   compound ids pin their prefix provider, bare ids pin the default provider), or
 * - a specialist's explicit `codingAgent`, or
 * - a specialist's explicit model id (compound ids pin their prefix provider;
 *   bare ids pin the default provider unless an explicit coding agent covers them).
 *
 * Tier-based specialist models (`defaultModelTier`) follow the specialist's
 * effective coding agent: when that agent is the implicit active-provider
 * fallback, it does NOT count as in use — otherwise no provider could ever be
 * disabled.
 */
export const selectProviderInUseReasons = store.createSelector(
  (state): Record<string, string> => {
    const reasons: Record<string, string> = {};
    const addReason = (providerId: string, reason: string) => {
      if (!reasons[providerId]) reasons[providerId] = reason;
    };

    // Only an explicitly selected global model counts as a pin. The
    // UI_INITIAL_MODEL fallback used by selectSelectedModel is implicit and
    // must not permanently block the default provider.
    const activeProviderId = selectActiveProviderId.select(state);
    const globalModel = selectProviderModels.select(state)[activeProviderId];
    if (globalModel) {
      const { providerId } = parseCompoundModelId(globalModel);
      addReason(providerId, `In use by the default model (${globalModel})`);
    }

    for (const specialist of selectSpecialists.select(state)) {
      if (specialist.codingAgent) {
        addReason(
          specialist.codingAgent,
          `In use by specialist "${specialist.name}" (coding agent)`,
        );
      }
      // Explicit model pin. Ignored when a tier is set — tier resolution
      // follows the effective coding agent instead of the pinned model.
      if (!specialist.defaultModelTier && specialist.defaultModel) {
        if (specialist.defaultModel.includes(":")) {
          const { providerId } = parseCompoundModelId(specialist.defaultModel);
          addReason(
            providerId,
            `In use by specialist "${specialist.name}" (${specialist.defaultModel})`,
          );
        } else if (!specialist.codingAgent) {
          // Bare model id with no explicit agent resolves to the default provider.
          addReason(
            getDefaultProviderId(),
            `In use by specialist "${specialist.name}" (${specialist.defaultModel})`,
          );
        }
      }
    }

    return reasons;
  },
);

/** Reason a provider cannot be disabled, or null when it is not in use. */
export const selectProviderInUseReason = store.createSelector(
  (state, providerId: string): string | null => {
    return selectProviderInUseReasons.select(state)[providerId] ?? null;
  },
);
