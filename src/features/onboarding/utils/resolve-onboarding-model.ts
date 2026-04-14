/**
 * Resolves the effective model to use for the initial onboarding agent.
 *
 * Checks (in order): specialist user override → specialist default tier →
 * specialist default model → preferred default from available models → store default.
 *
 * Provider resolution intentionally starts from the app's default provider (Auggie),
 * not the active provider card. Onboarding may activate a non-default provider while
 * checking/installing it, but the initial agent should follow the same normal
 * provider priority and prefer Auggie unless a specialist or explicit model override
 * asks for another provider.
 */

import { selectActiveProviderId } from '$lib/store/slices/provider-settings/provider-settings-selectors';
import {
  selectSpecialists,
  selectEffectiveBehaviorPrompt,
  selectUserOverrides,
} from '$lib/store/slices/specialists/specialists-selectors';
import {
  selectSelectedModel,
  selectAvailableModels,
} from '$lib/store/slices/model/model-selectors';
import {
  PROVIDER_MODEL_TIERS,
  getDefaultModelForProvider,
  getDefaultProviderId,
  parseCompoundModelId,
} from '$shared/config/provider-config';
import { resolvePreferredDefaultModel } from '$lib/utils/provider-model-selection';
import type { StoreState } from '$lib/store/types';
import { createLogger } from '$lib/utils/client-logger';

const logger = createLogger('resolve-onboarding-model');
const specialistId = 'spec-writer';

export interface ResolvedModelConfig {
  provider: string;
  model: string;
  behaviorPrompt: string | undefined;
  specialistId: string;
}

function getProviderForModel(model: string, fallbackProvider: string): string {
  return model.includes(':') ? parseCompoundModelId(model).providerId : fallbackProvider;
}

/**
 * Given the current Redux state, resolve the model, provider, and behavior
 * prompt for the initial onboarding "Coordinator" agent.
 */
export function resolveOnboardingModel(state: StoreState): ResolvedModelConfig {
  const activeProvider = selectActiveProviderId.select(state);
  const defaultProviderId = getDefaultProviderId();
  const specialist = selectSpecialists.select(state).find((s) => s.id === specialistId);
  let provider = specialist?.codingAgent ?? defaultProviderId;
  let storeModel = selectSelectedModel.select(state, provider);

  const behaviorPrompt = selectEffectiveBehaviorPrompt.select(state, specialistId) || undefined;

  let resolvedModel: string | undefined;

  // 1. Check specialist user override
  const specialistOverride = selectUserOverrides.select(state).modelOverrides[specialistId];
  if (specialistOverride) {
    resolvedModel = specialistOverride;
    provider = getProviderForModel(specialistOverride, provider);
    logger.info('Using specialist model override', { specialistId, override: specialistOverride });
  } else {
    // 2. Check specialist default tier / default model
    if (specialist?.defaultModelTier && provider in PROVIDER_MODEL_TIERS) {
      const baseModel = getDefaultModelForProvider(provider, specialist.defaultModelTier);
      resolvedModel = provider !== defaultProviderId ? `${provider}:${baseModel}` : baseModel;
    } else if (specialist?.defaultModel) {
      resolvedModel = specialist.defaultModel;
      provider = getProviderForModel(specialist.defaultModel, provider);
    }
  }

  storeModel = selectSelectedModel.select(state, provider);

  // 3. Fall back to preferred default from available models
  if (!resolvedModel) {
    const availableValues =
      provider === activeProvider ? selectAvailableModels.select(state).map((m) => m.value) : [];
    resolvedModel = resolvePreferredDefaultModel(availableValues, storeModel) ?? storeModel;
    provider = getProviderForModel(resolvedModel, provider);
  }

  // 4. Validate resolved model only against the active provider's model list.
  // The model slice stores the currently active provider's models, so using it to
  // validate Auggie while Claude Code is active would incorrectly reject Auggie.
  const availableModels = provider === activeProvider ? selectAvailableModels.select(state) : [];
  if (resolvedModel && availableModels.length > 0) {
    const availableModelValues = availableModels.map((m) => m.value);
    if (!availableModelValues.includes(resolvedModel)) {
      logger.warn('Tier-resolved model not in available list, using store default', {
        resolvedModel,
        fallback: storeModel,
        provider,
        availableCount: availableModelValues.length,
      });
      resolvedModel = storeModel;
      provider = getProviderForModel(resolvedModel, provider);
    }
  }

  return {
    provider,
    model: resolvedModel || storeModel,
    behaviorPrompt,
    specialistId,
  };
}
