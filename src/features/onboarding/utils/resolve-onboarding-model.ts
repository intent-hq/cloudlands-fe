/**
 * Resolves the effective model to use for the initial onboarding agent.
 *
 * Resolution is provider-availability aware: the returned provider is always
 * one that is installed AND authenticated on the user's machine, so the
 * initial Coordinator agent can actually start. If the caller-preferred
 * provider (specialist codingAgent, active provider, default) is not
 * available, we fall back to the first usable provider.
 *
 * Provider priority (highest → lowest), restricted to usable providers:
 *   1. provider encoded in a specialist user model override (e.g. 'opencode:x')
 *   2. specialist.codingAgent (if the specialist pins one)
 *   3. the currently active provider from Redux (honors onboarding card click)
 *   4. the app's default provider (Auggie)
 *   5. the first usable provider
 *
 * Model selection:
 *   - Providers with a static catalog tier table (auggie, claude-code,
 *     codex, cortex) use the specialist's tier/defaultModel, same as before.
 *   - Providers with dynamic models (opencode) never synthesize a tier model.
 *     We read `selectAvailableModels` and, if empty, trigger
 *     `reloadModelsForProvider` and fetch via `getModelsForProvider`.
 */

import { selectActiveProviderId } from '$store/renderer/slices/provider-settings/provider-settings-selectors';
import {
  selectSpecialists,
  selectEffectiveBehaviorPrompt,
  selectUserOverrides,
} from '$store/renderer/slices/specialists/specialists-selectors';
import {
  selectSelectedModel,
  selectAvailableModels,
} from '$store/renderer/slices/model/model-selectors';
import {
  selectCatalogDefaultProviderId,
  selectProviderModelTiers,
} from '$store/renderer/slices/provider-catalog/provider-catalog-selectors';
import { isModelValidForProvider, splitCompoundModelId } from '$shared/utils/compound-model-id';
import { resolvePreferredDefaultModel } from '$lib/utils/effective-model-resolution';
import { getModelsForProvider } from '$store/renderer/slices/model/model-utils';
import { reloadModelsForProvider } from '$store/renderer/slices/model/model-slice';
import {
  getProviderAvailability,
  type ProviderAvailabilityResult,
  type ProviderStatus,
} from '$features/providers/provider-availability.client';
import type { StoreState } from '$store/renderer/types';
import { createLogger } from '$lib/utils/client-logger';
import { m } from '$shared/paraglide/messages.js';
import { store as appStore } from '$store/renderer/store';

const logger = createLogger('resolve-onboarding-model');
const specialistId = 'spec-writer';

export interface ResolvedModelConfig {
  provider: string;
  model: string;
  behaviorPrompt: string | undefined;
  specialistId: string;
}

function getProviderForModel(model: string, fallbackProvider: string): string {
  return splitCompoundModelId(model).providerId || fallbackProvider;
}

/** Map a provider ID to its status within a ProviderAvailabilityResult. */
function getProviderStatus(
  availability: ProviderAvailabilityResult,
  providerId: string,
): ProviderStatus | undefined {
  const map: Record<string, ProviderStatus | undefined> = {
    auggie: availability.providers.auggie,
    'claude-code': availability.providers.claudeCode,
    codex: availability.providers.codex,
    cortex: availability.providers.cortex,
    opencode: availability.providers.opencode,
    droid: availability.providers.droid,
    grok: availability.providers.grok,
    unsloth: availability.providers.unsloth,
    mock: availability.providers.mock,
    pi: availability.providers.pi,
  };
  return map[providerId];
}

/** A provider is usable if it is installed AND authenticated. */
function isProviderUsable(
  availability: ProviderAvailabilityResult,
  providerId: string,
): boolean {
  const status = getProviderStatus(availability, providerId);
  return !!status && status.available && status.authenticated === true;
}

/**
 * Relaxed gate for the user's explicitly-selected provider. Accepts
 * `authenticated === undefined` (inconclusive probe — e.g. `opencode models`
 * timed out) as long as the CLI is installed. Still rejects explicit
 * `authenticated === false`. Only intended for the user-explicit path, not
 * the auto-pick fallback chain.
 */
function isProviderUserExplicitUsable(status: ProviderStatus | undefined): boolean {
  return !!status && status.available && status.authenticated !== false;
}

/** Compute the ordered list of usable provider IDs. */
function getUsableProviderIds(availability: ProviderAvailabilityResult): string[] {
  const ids: string[] = [];
  if (isProviderUsable(availability, 'auggie')) ids.push('auggie');
  if (isProviderUsable(availability, 'claude-code')) ids.push('claude-code');
  if (isProviderUsable(availability, 'codex')) ids.push('codex');
  if (isProviderUsable(availability, 'opencode')) ids.push('opencode');
  if (isProviderUsable(availability, 'droid')) ids.push('droid');
  if (isProviderUsable(availability, 'grok')) ids.push('grok');
  if (isProviderUsable(availability, 'cortex')) ids.push('cortex');
  if (isProviderUsable(availability, 'pi')) ids.push('pi');
  if (isProviderUsable(availability, 'unsloth')) ids.push('unsloth');
  return ids;
}

/**
 * Pick a usable provider following the documented priority. Emits warnings
 * when the preferred provider is unusable and we have to fall back.
 */
function resolveUsableProvider(
  usable: string[],
  preferred: {
    specialistOverrideProvider?: string;
    specialistCodingAgent?: string;
    activeProvider: string;
    defaultProvider: string;
  },
): string | undefined {
  if (usable.length === 0) return undefined;

  const tryUse = (candidate: string | undefined, reason: string): string | undefined => {
    if (!candidate) return undefined;
    if (usable.includes(candidate)) return candidate;
    logger.warn('Preferred provider not usable, falling back', {
      reason,
      preferred: candidate,
      usable,
    });
    return undefined;
  };

  return (
    tryUse(preferred.specialistOverrideProvider, 'specialist-model-override') ??
    tryUse(preferred.specialistCodingAgent, 'specialist-coding-agent') ??
    tryUse(preferred.activeProvider, 'active-provider') ??
    tryUse(preferred.defaultProvider, 'default-provider') ??
    usable[0]
  );
}

/**
 * Resolve a model for a provider whose models are dynamic (i.e. no static
 * catalog tier table — e.g. opencode). Reads from Redux when the provider
 * matches the active one; if the list is empty we fetch fresh via
 * getModelsForProvider and dispatch reloadModelsForProvider so the store
 * stays in sync for the rest of the UI.
 */
async function resolveDynamicProviderModel(
  state: StoreState,
  provider: string,
  activeProvider: string,
): Promise<string | undefined> {
  const storeModel = selectSelectedModel.select(state, provider);

  if (provider === activeProvider) {
    // Only trust entries that actually belong to this provider — right after
    // a provider switch the flat `availableModels` list can still hold the
    // previous provider's catalog until reloadModelsForProvider resolves, and
    // resolving against it would return another provider's model id.
    const defaultProviderId = selectCatalogDefaultProviderId.select(state);
    const fromStore = selectAvailableModels
      .select(state)
      .map((m) => m.value)
      .filter((value) => isModelValidForProvider(value, provider, defaultProviderId));
    const picked = resolvePreferredDefaultModel(fromStore, storeModel);
    if (picked) return picked;
  }

  try {
    const fetched = await getModelsForProvider(provider);
    const values = fetched.map((m) => m.value);
    if (values.length > 0) {
      // Nudge the store to reload models for the active provider so later
      // UI reads (ModelPicker, agent cards) stay consistent with our pick.
      if (provider === activeProvider) {
        try {
          appStore.dispatch(reloadModelsForProvider());
        } catch (err) {
          logger.debug('reloadModelsForProvider dispatch failed (non-fatal)', { error: err });
        }
      }
      return resolvePreferredDefaultModel(values, storeModel) ?? values[0];
    }
  } catch (err) {
    logger.warn('Failed to fetch models for dynamic provider', { provider, error: err });
  }

  return undefined;
}

/**
 * Given the current Redux state, resolve the model, provider, and behavior
 * prompt for the initial onboarding "Coordinator" agent. Returns a provider
 * that is guaranteed to be available + authenticated on the user's machine.
 *
 * `userSelectedModel` is an explicit pick from the onboarding prompt-step
 * model picker: it wins outright (provider follows the compound id, bare ids
 * belong to the default provider) under the same user-explicit gate as a
 * provider-card click — relaxed auth, never silently switched away from.
 */
export async function resolveOnboardingModel(
  state: StoreState,
  userSelectedModel?: string,
): Promise<ResolvedModelConfig> {
  const activeProvider = selectActiveProviderId.select(state);
  const defaultProviderId = selectCatalogDefaultProviderId.select(state);
  const specialist = selectSpecialists.select(state).find((s) => s.id === specialistId);
  const behaviorPrompt = selectEffectiveBehaviorPrompt.select(state, specialistId) || undefined;
  const specialistOverride = selectUserOverrides.select(state).modelOverrides[specialistId];

  const availability = await getProviderAvailability();

  if (userSelectedModel) {
    const pickedProvider = getProviderForModel(userSelectedModel, defaultProviderId);
    const pickedStatus = getProviderStatus(availability, pickedProvider);
    if (!isProviderUserExplicitUsable(pickedStatus)) {
      throw new Error(
        m.onboarding_resolveModel_providerUnavailable_error({ provider: pickedProvider }),
      );
    }
    logger.info('Using user-selected onboarding model', {
      model: userSelectedModel,
      provider: pickedProvider,
      authenticated: pickedStatus?.authenticated,
    });
    return {
      provider: pickedProvider,
      model: userSelectedModel,
      behaviorPrompt,
      specialistId,
    };
  }

  const usable = getUsableProviderIds(availability);

  const overrideProvider = specialistOverride
    ? getProviderForModel(specialistOverride, defaultProviderId)
    : undefined;

  // When the user explicitly selected a provider different from the default
  // (i.e. clicked a non-Auggie provider card in onboarding), honor their
  // choice with a relaxed auth gate: `authenticated === undefined` means the
  // probe (e.g. `opencode models`) was inconclusive on a slow machine, but
  // the CLI is installed and the user told us what they want. Only explicit
  // `authenticated === false` is still a hard rejection. If the explicit
  // pick fails even the relaxed gate, throw — never silently switch to a
  // different provider behind the user's back.
  const userExplicit = activeProvider !== defaultProviderId;
  let provider: string | undefined;

  if (userExplicit) {
    const activeStatus = getProviderStatus(availability, activeProvider);
    if (isProviderUserExplicitUsable(activeStatus)) {
      provider = activeProvider;
      logger.info('Honoring user-explicit provider selection', {
        activeProvider,
        authenticated: activeStatus?.authenticated,
      });
    } else {
      throw new Error(
        m.onboarding_resolveModel_providerUnavailable_error({ provider: activeProvider }),
      );
    }
  } else {
    provider = resolveUsableProvider(usable, {
      specialistOverrideProvider: overrideProvider,
      specialistCodingAgent: specialist?.codingAgent,
      activeProvider,
      defaultProvider: defaultProviderId,
    });

    if (!provider) {
      // No usable provider at all AND the user did not explicitly pick one.
      // Fall back to the defaults so the caller gets a well-formed object;
      // this preserves the Auggie-only backwards-compatible path.
      logger.warn('No usable provider found for onboarding, falling back to defaults', {
        activeProvider,
        defaultProviderId,
      });
      provider = specialist?.codingAgent ?? defaultProviderId;
    }
  }

  let resolvedModel: string | undefined;

  // 1. Specialist user override — honor only if it matches the resolved provider
  // (which already respects its encoded provider when that provider is usable).
  const providerTiers = selectProviderModelTiers.select(state, provider);

  if (specialistOverride && overrideProvider === provider) {
    resolvedModel = specialistOverride;
    logger.info('Using specialist model override', { specialistId, override: specialistOverride });
  } else if (specialist?.defaultModelTier && providerTiers) {
    // 2. Specialist tier → provider tier model
    const baseModel = providerTiers[specialist.defaultModelTier];
    resolvedModel = provider !== defaultProviderId ? `${provider}:${baseModel}` : baseModel;
  } else if (specialist?.defaultModel && providerTiers) {
    // 3. Specialist explicit default (only for tier-backed providers; for
    // dynamic providers we never copy a tier-style default across providers).
    const defaultModelProvider = getProviderForModel(specialist.defaultModel, defaultProviderId);
    if (defaultModelProvider === provider) {
      resolvedModel = specialist.defaultModel;
    }
  }

  const storeModel = selectSelectedModel.select(state, provider);

  // 4. Fallback: provider-specific model discovery.
  if (!resolvedModel) {
    if (providerTiers) {
      // Tier-backed provider: prefer the user's selected/preferred model
      // if it matches the active provider's loaded list, otherwise pick
      // the smart tier as a safe default for the Coordinator role.
      const fromStore =
        provider === activeProvider
          ? selectAvailableModels.select(state).map((m) => m.value)
          : [];
      resolvedModel = resolvePreferredDefaultModel(fromStore, storeModel);
      if (!resolvedModel) {
        const smart = providerTiers.smart;
        resolvedModel = provider !== defaultProviderId ? `${provider}:${smart}` : smart;
      }
    } else {
      // Dynamic-model provider (e.g. opencode). Never synthesize a tier model.
      resolvedModel = await resolveDynamicProviderModel(state, provider, activeProvider);
    }
  }

  // 5. Validate tier-backed results against the live model list when we can.
  if (
    resolvedModel &&
    providerTiers &&
    provider === activeProvider
  ) {
    const availableModels = selectAvailableModels.select(state);
    if (availableModels.length > 0) {
      const values = availableModels.map((m) => m.value);
      if (!values.includes(resolvedModel)) {
        const fallback = resolvePreferredDefaultModel(values, storeModel) ?? storeModel;
        logger.warn('Resolved model not in available list, using store default', {
          resolvedModel,
          fallback,
          provider,
          availableCount: values.length,
        });
        resolvedModel = fallback;
      }
    }
  }

  const finalModel = resolvedModel || storeModel;

  // Never return an empty model for a non-Auggie provider: downstream
  // `workspace.service.ts` would treat it as "no model" and fall back to
  // `DEFAULT_AGENT_MODEL = 'opus4.6'`, producing an invalid compound like
  // `{ provider: 'opencode', model: 'opus4.6' }` that fails at spawn time.
  if (!finalModel && provider !== defaultProviderId) {
    throw new Error(m.onboarding_resolveModel_noModel_error({ provider }));
  }

  return {
    provider,
    model: finalModel,
    behaviorPrompt,
    specialistId,
  };
}
