/**
 * Resolves the provider (and any explicit model override) to use for the
 * initial onboarding agent.
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
 *   4. the settings-derived effective default provider (when designated)
 *   5. the first usable non-opt-in provider
 *
 * Model selection is daemon-owned (single resolver, PROTOCOL §5.11): the
 * returned `model` is set only for an explicit specialist user override that
 * matches the resolved provider. Otherwise it is undefined and the daemon
 * applies its resolved default (specialist frontmatter > settings chain >
 * provider CLI default) at creation time.
 */

import { selectActiveProviderId } from '$store/renderer/slices/provider-settings/provider-settings-selectors';
import {
  selectSpecialists,
  selectEffectiveBehaviorPrompt,
  selectUserOverrides,
} from '$store/renderer/slices/specialists/specialists-selectors';
import { selectEffectiveDefaultProviderId } from '$store/renderer/slices/provider-catalog/provider-catalog-selectors';
import { splitLegacyCompoundId } from '$shared/utils/legacy-model-id';
import { isProviderAuthenticationReady } from '$shared/types/provider-availability';
import {
  getProviderAvailability,
  type ProviderAvailabilityResult,
  type ProviderStatus,
} from '$features/providers/provider-availability.client';
import type { StoreState } from '$store/renderer/types';
import { createLogger } from '$lib/utils/client-logger';
import { m } from '$shared/paraglide/messages.js';

const logger = createLogger('resolve-onboarding-model');
const specialistId = 'spec-writer';

export interface ResolvedModelConfig {
  provider: string;
  /** Explicit override only; undefined ⇒ the daemon resolves the default. */
  model: string | undefined;
  behaviorPrompt: string | undefined;
  specialistId: string;
}

/** An explicit prompt-step picker pick: bare model id + its provider leg. */
export interface OnboardingUserModelPick {
  model: string;
  /** Provider the pick belongs to; absent for legacy persisted picks without one. */
  provider?: string;
}

/**
 * Legacy boundary: attribute a persisted pre-triple compound id (specialist
 * override / old persisted pick) to its prefix, else the fallback provider.
 */
function getProviderForModel(model: string, fallbackProvider: string): string {
  return splitLegacyCompoundId(model).providerId || fallbackProvider;
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
    antigravity: availability.providers.antigravity,
  };
  return map[providerId];
}

/** A provider is usable if it is installed AND authenticated. */
function isProviderUsable(availability: ProviderAvailabilityResult, providerId: string): boolean {
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
function isProviderUserExplicitUsable(
  status: ProviderStatus | undefined,
  providerId: string,
): boolean {
  return (
    !!status && status.available && isProviderAuthenticationReady(providerId, status.authenticated)
  );
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
  if (isProviderUsable(availability, 'antigravity')) ids.push('antigravity');
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
    usable.find((providerId) => providerId !== 'antigravity')
  );
}

/**
 * Given the current Redux state, resolve the provider, behavior prompt, and
 * any explicit model override for the initial onboarding "Coordinator" agent.
 * Returns a provider that is guaranteed to be available + authenticated on
 * the user's machine.
 *
 * `userPick` is an explicit pick from the onboarding prompt-step model
 * picker: it wins outright under the same user-explicit gate as a
 * provider-card click — relaxed auth, never silently switched away from. The
 * pick carries its own provider leg (bare model id + provider from the
 * picker); a legacy persisted pick without one attributes to its compound
 * prefix, else the default provider.
 */
export async function resolveOnboardingModel(
  state: StoreState,
  userPick?: OnboardingUserModelPick,
): Promise<ResolvedModelConfig> {
  const activeProvider = selectActiveProviderId.select(state);
  const defaultProviderId = selectEffectiveDefaultProviderId.select(state);
  const specialist = selectSpecialists.select(state).find((s) => s.id === specialistId);
  const behaviorPrompt = selectEffectiveBehaviorPrompt.select(state, specialistId) || undefined;
  const specialistOverride = selectUserOverrides.select(state).modelOverrides[specialistId];

  const availability = await getProviderAvailability();

  if (userPick?.model) {
    // Normalize a legacy compound pick at this boundary: the bare model leg
    // is what the create request submits; the provider leg comes from the
    // pick, else the compound prefix, else the default provider.
    const pickedModel = splitLegacyCompoundId(userPick.model).modelId || userPick.model;
    const pickedProvider =
      userPick.provider || getProviderForModel(userPick.model, defaultProviderId);
    const pickedStatus = getProviderStatus(availability, pickedProvider);
    if (!isProviderUserExplicitUsable(pickedStatus, pickedProvider)) {
      throw new Error(
        m.onboarding_resolveModel_providerUnavailable_error({ provider: pickedProvider }),
      );
    }
    logger.info('Using user-selected onboarding model', {
      model: pickedModel,
      provider: pickedProvider,
      authenticated: pickedStatus?.authenticated,
    });
    return {
      provider: pickedProvider,
      model: pickedModel,
      behaviorPrompt,
      specialistId,
    };
  }

  const usable = getUsableProviderIds(availability);

  const overrideProvider = specialistOverride
    ? getProviderForModel(specialistOverride, defaultProviderId)
    : undefined;

  // When the user explicitly selected a provider (a non-empty
  // `providers.active` — the only writers are the user's own picks), honor
  // their choice with a relaxed auth gate: `authenticated === undefined`
  // means the probe (e.g. `opencode models`) was inconclusive on a slow
  // machine, but the CLI is installed and the user told us what they want.
  // Only explicit `authenticated === false` is still a hard rejection. If
  // the explicit pick fails even the relaxed gate, throw — never silently
  // switch to a different provider behind the user's back. An unset active
  // provider ('') is never explicit and takes the auto-pick chain below.
  const userExplicit = activeProvider !== '';
  let provider: string | undefined;

  if (userExplicit) {
    const activeStatus = getProviderStatus(availability, activeProvider);
    if (isProviderUserExplicitUsable(activeStatus, activeProvider)) {
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
      // Fall back to the specialist's declared pin, else the settings-derived
      // default — which may be '' (honestly unresolved). Never fabricate a
      // provider the user/settings did not designate.
      logger.warn('No usable provider found for onboarding, falling back to defaults', {
        activeProvider,
        defaultProviderId,
      });
      provider = specialist?.codingAgent ?? defaultProviderId;
    }
  }

  // Model resolution is daemon-owned: only an explicit specialist user
  // override that matches the resolved provider is submitted (as its bare
  // model leg — the override may be a persisted legacy compound). Everything
  // else (frontmatter model/tier, settings chain, provider CLI default) is
  // resolved by the daemon at creation time.
  let resolvedModel: string | undefined;
  if (specialistOverride && overrideProvider === provider) {
    resolvedModel = splitLegacyCompoundId(specialistOverride).modelId || specialistOverride;
    logger.info('Using specialist model override', { specialistId, override: specialistOverride });
  }

  return {
    provider,
    model: resolvedModel,
    behaviorPrompt,
    specialistId,
  };
}
