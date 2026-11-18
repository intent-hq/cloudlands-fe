/**
 * Resolves the provider (and any explicit model override) to use for the
 * initial onboarding agent.
 *
 * Resolution is provider-availability aware: the returned provider is always
 * one that is installed AND authenticated on the user's machine, so the
 * initial Developer agent can actually start. If the caller-preferred
 * provider (specialist codingAgent, active provider, default) is not
 * available, we fall back to the first usable provider.
 *
 * On an orchestrator the backend runs and checks no provider CLI, so the raw
 * probe reports none; every enabled catalog provider counts as usable there
 * and its machines decide whether it runs (PROTOCOL provider-profiles.md →
 * "Profiles on an orchestrator"), as everywhere else in the app.
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

import {
  selectActiveProviderId,
  selectAvailableEnabledProviderIds,
} from '$store/renderer/slices/provider-settings/provider-settings-selectors';
import { selectProviderStatusMap } from '$store/renderer/slices/agent-availability/agent-availability-selectors';
import { selectIsOrchestratorBackend } from '$store/renderer/slices/principal/principal-selectors';
import {
  selectSpecialists,
  selectEffectiveBehaviorPrompt,
  selectUserOverrides,
} from '$store/renderer/slices/specialists/specialists-selectors';
import { selectEffectiveDefaultProviderId } from '$store/renderer/slices/provider-catalog/provider-catalog-selectors';
import { splitLegacyCompoundId } from '$shared/utils/legacy-model-id';
import { providerRefBaseId } from '$shared/provider-profiles';
import { DEFAULT_NEW_WORKSPACE_SPECIALIST_ID, getSpecialistById } from '$lib/constants/specialists';
import {
  getProviderStatusFromResult,
  PROVIDER_AVAILABILITY_KEY_TO_ID,
  isProviderAuthenticationReady,
} from '$shared/types/provider-availability';
import {
  getProviderAvailability,
  type ProviderAvailabilityResult,
  type ProviderStatus,
} from '$features/providers/provider-availability.client';
import type { StoreState } from '$store/renderer/types';
import { createLogger } from '$lib/utils/client-logger';
import { m } from '$shared/paraglide/messages.js';

const logger = createLogger('resolve-onboarding-model');

export interface ResolvedModelConfig {
  provider: string;
  /** Explicit override only; undefined ⇒ the daemon resolves the default. */
  model: string | undefined;
  behaviorPrompt: string | undefined;
  /**
   * Developer when the resolved specialist list carries it (or is not loaded
   * yet — the daemon bundles the Developer); `null` (General) when a loaded
   * list does not, since that list is authoritative (daemon replacement mode).
   */
  specialistId: string | null;
  /** Localized display name of the resolved specialist; undefined for General. */
  specialistName: string | undefined;
}

/**
 * Applies the `DEFAULT_NEW_WORKSPACE_SPECIALIST_ID` contract: the Developer
 * id only when a non-empty resolved list contains it, or when nothing has
 * loaded yet; otherwise General (`null`).
 */
function resolveOnboardingSpecialistId(specialists: readonly { id: string }[]): string | null {
  if (specialists.length === 0) return DEFAULT_NEW_WORKSPACE_SPECIALIST_ID;
  return specialists.some((s) => s.id === DEFAULT_NEW_WORKSPACE_SPECIALIST_ID)
    ? DEFAULT_NEW_WORKSPACE_SPECIALIST_ID
    : null;
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

/** The status fields the resolver gates on. */
type ProviderReadinessStatus = Pick<ProviderStatus, 'available' | 'authenticated'>;

/** A provider is usable if it is installed AND authenticated. */
function isProviderUsable(availability: ProviderAvailabilityResult, providerId: string): boolean {
  const status = getProviderStatusFromResult(availability, providerId);
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
  status: ProviderReadinessStatus | undefined,
  providerId: string,
): boolean {
  return (
    !!status && status.available && isProviderAuthenticationReady(providerId, status.authenticated)
  );
}

/** Compute the ordered list of usable provider IDs. */
function getUsableProviderIds(availability: ProviderAvailabilityResult): string[] {
  return Object.values(PROVIDER_AVAILABILITY_KEY_TO_ID).filter(
    (providerId) => providerId !== 'mock' && isProviderUsable(availability, providerId),
  );
}

/** Per-provider status, and the auto-pick candidates in priority order. */
interface ProviderReadiness {
  status: (providerId: string) => ProviderReadinessStatus | undefined;
  usable: string[];
}

async function readProviderReadiness(state: StoreState): Promise<ProviderReadiness> {
  if (selectIsOrchestratorBackend.select(state)) {
    // No local probe: it reports nothing on an orchestrator. Every catalog
    // provider is available with no sign-in verdict; the enabled ones are
    // the auto-pick candidates. A profile reads as its provider.
    const statusMap = selectProviderStatusMap.select(state);
    return {
      status: (providerId) => statusMap[providerRefBaseId(providerId)],
      usable: selectAvailableEnabledProviderIds
        .select(state)
        .filter((providerId) => providerId !== 'mock'),
    };
  }
  const availability = await getProviderAvailability();
  return {
    status: (providerId) => getProviderStatusFromResult(availability, providerId),
    usable: getUsableProviderIds(availability),
  };
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
 * Given the current Redux state, resolve the provider, behavior prompt, and
 * any explicit model override for the initial onboarding Developer agent.
 * Returns a provider that is guaranteed to be available + authenticated on
 * the user's machine (on an orchestrator: enabled, for its machines to run).
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
  const specialists = selectSpecialists.select(state);
  const specialistId = resolveOnboardingSpecialistId(specialists);
  const specialist = specialistId ? specialists.find((s) => s.id === specialistId) : undefined;
  // The prompt is fixed at creation; never start the agent from a placeholder.
  if (specialist?.promptUnavailable) {
    throw new Error(m.specialists_catalogLoading_error());
  }
  const specialistName = specialistId
    ? (specialist?.name ?? getSpecialistById(specialistId)?.name ?? specialistId)
    : undefined;
  const behaviorPrompt = specialistId
    ? selectEffectiveBehaviorPrompt.select(state, specialistId) || undefined
    : undefined;
  const specialistOverride = specialistId
    ? selectUserOverrides.select(state).modelOverrides[specialistId]
    : undefined;
  if (specialistId === null) {
    logger.info('Developer specialist absent from the resolved list; falling back to General');
  }

  const readiness = await readProviderReadiness(state);

  if (userPick?.model) {
    // Normalize a legacy compound pick at this boundary: the bare model leg
    // is what the create request submits; the provider leg comes from the
    // pick, else the compound prefix, else the default provider.
    const pickedModel = splitLegacyCompoundId(userPick.model).modelId || userPick.model;
    const pickedProvider =
      userPick.provider || getProviderForModel(userPick.model, defaultProviderId);
    const pickedStatus = readiness.status(pickedProvider);
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
      specialistName,
    };
  }

  const usable = readiness.usable;

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
    const activeStatus = readiness.status(activeProvider);
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
    specialistName,
  };
}
