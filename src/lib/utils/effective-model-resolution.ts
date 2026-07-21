/**
 * Dependency-light effective-model resolution shared by the Home-screen picker
 * display (InitialAgentPicker) and the workspace-creation submit path
 * (CompactWorkspaceInitializer), so the agent is created with exactly the
 * model the picker displayed.
 */
import {
  getDefaultModelForProvider,
  getDefaultProviderId,
  PROVIDER_MODEL_TIERS,
  resolvePreferredModel,
  type ModelTier,
} from '$shared/config/provider-config';
import { MODEL_DEFAULTS } from '$shared/constants/agent-services';

export interface EffectiveSpecialistModelInput {
  /** Selected specialist ID — null means General/no specialist */
  specialistId: string | null;
  /** Provider currently selected in the form */
  selectedProvider: string;
  /** Model values available for the loaded provider */
  availableModelValues: string[];
  /** Global model-store selection, used as the no-specialist fallback preference */
  globalSelectedModel?: string;
  /** Effective coding agent for the specialist (from selectEffectiveCodingAgent) */
  effectiveCodingAgent?: string;
  /** Effective model for the specialist (from selectEffectiveModel) */
  effectiveModel?: string;
  /** Merged specialist info used for local tier/default-model fallbacks */
  specialistInfo?: { defaultModelTier?: ModelTier; defaultModel?: string };
}

/**
 * Resolve the preferred default model from the available models list.
 * Uses the globally selected model first if available, then falls back to
 * UI_MODEL_PREFERENCE order, then the first available model.
 *
 * This is the single source of truth for "what model should we use when
 * the user hasn't explicitly picked one and there's no specialist".
 */
export function resolvePreferredDefaultModel(
  availableModelValues: string[],
  globalSelectedModel?: string,
): string | undefined {
  if (globalSelectedModel && availableModelValues.includes(globalSelectedModel)) {
    return globalSelectedModel;
  }

  const preferred = resolvePreferredModel(MODEL_DEFAULTS.UI_MODEL_PREFERENCE, availableModelValues);
  if (preferred) return preferred;

  return availableModelValues[0];
}

/**
 * Resolve the effective default model for a specialist.
 *
 * When the form's selected provider matches the specialist's effective coding
 * agent from Redux, the Redux-resolved effective model wins — this mirrors
 * Settings > Agents exactly (file specialist `model` respected). When the user
 * changed the provider within the form, fall back to local tier resolution,
 * then the specialist's hardcoded default model, then the preferred default
 * from the available models.
 */
export function resolveEffectiveModelForSpecialist(
  input: EffectiveSpecialistModelInput,
): string | undefined {
  const {
    specialistId,
    selectedProvider,
    availableModelValues,
    globalSelectedModel,
    effectiveCodingAgent,
    effectiveModel,
    specialistInfo,
  } = input;
  const valuesSet = new Set(availableModelValues);

  if (specialistId) {
    // If the form's provider matches the specialist's effective coding agent,
    // use the Redux-resolved model directly — this mirrors Settings > Agents exactly.
    if (
      selectedProvider === effectiveCodingAgent &&
      effectiveModel &&
      valuesSet.has(effectiveModel)
    ) {
      return effectiveModel;
    }

    // User changed provider within the form — resolve the specialist's model
    // tier against the locally-selected provider.
    if (specialistInfo?.defaultModelTier && selectedProvider in PROVIDER_MODEL_TIERS) {
      const baseModel = getDefaultModelForProvider(
        selectedProvider,
        specialistInfo.defaultModelTier,
      );
      const defaultProviderId = getDefaultProviderId();
      const resolvedModel =
        selectedProvider !== defaultProviderId ? `${selectedProvider}:${baseModel}` : baseModel;
      // Validate the tier-resolved model exists in the available models.
      // PROVIDER_MODEL_TIERS may have hardcoded model names that don't match
      // the actual models returned by the provider (e.g. opencode CLI).
      if (valuesSet.has(resolvedModel)) {
        return resolvedModel;
      }
      // Tier model not available — fall through to fallback below
    }

    // Fallback to hardcoded defaultModel (custom specialists, etc.)
    if (specialistInfo?.defaultModel) {
      return specialistInfo.defaultModel;
    }
  }

  return resolvePreferredDefaultModel(availableModelValues, globalSelectedModel);
}

/**
 * Resolve the model to use when creating the initial agent from the Home
 * screen: an explicit user override always wins; otherwise use the same
 * effective-model resolution the picker displays. A degenerate persisted
 * state (overridden flag set with no model) falls through to the
 * specialist/default resolution instead of returning undefined.
 */
export function resolveSubmitModel(
  input: EffectiveSpecialistModelInput & {
    modelWasOverridden: boolean;
    overriddenModel?: string;
  },
): string | undefined {
  if (input.modelWasOverridden && input.overriddenModel) return input.overriddenModel;
  return resolveEffectiveModelForSpecialist(input);
}
