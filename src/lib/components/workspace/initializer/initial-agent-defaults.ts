/**
 * How New Workspace picks the initial agent's provider and default model when
 * the agent changes. Shared with the workspace suggestion card so both forms
 * land on the same provider and name the same model.
 */
import { isProviderDisabledInSettings } from '$lib/components/chat/input/model-picker-utils';
import type { SpecialistDef } from '$lib/client/app-client';
import {
  findProfileByRef,
  isProviderProfileRef,
  providerRefBaseId,
} from '$shared/provider-profiles';
import {
  isProviderReadyInResult,
  type ProviderAvailabilityResult,
} from '$shared/types/provider-availability';

/** A specialist's daemon-resolved defaults in one provider's context (PROTOCOL §5.11). */
export type ResolvedSpecialist = Pick<
  SpecialistDef,
  'model' | 'modelOptions' | 'reasoningEffort' | 'resolvedModel' | 'resolvedReasoningEffort'
>;

export interface ProviderAvailabilityContext {
  /** `null` while the availability check is still loading. */
  availability: ProviderAvailabilityResult | null;
  enabledProviders: Readonly<Record<string, boolean>>;
  profiles: Parameters<typeof findProfileByRef>[0];
}

/**
 * Whether the initial agent can start on a provider: ready and turned on. A
 * named profile (§5.54) is available while it is saved and its base provider
 * is ready; readiness is keyed by the base provider.
 */
export function isInitialAgentProviderAvailable(
  providerId: string,
  { availability, enabledProviders, profiles }: ProviderAvailabilityContext,
): boolean {
  if (isProviderProfileRef(providerId) && !findProfileByRef(profiles, providerId)) return false;
  return (
    isProviderReadyInResult(availability, providerRefBaseId(providerId)) &&
    !isProviderDisabledInSettings({ ...enabledProviders }, providerId)
  );
}

/** Catalog providers the initial agent can start on; empty until availability loads. */
export function availableInitialAgentProviders(
  catalogEntries: ReadonlyArray<{ id: string }>,
  context: ProviderAvailabilityContext,
): Array<{ id: string }> {
  if (!context.availability) return [];
  return catalogEntries
    .filter((provider) => isInitialAgentProviderAvailable(provider.id, context))
    .map((provider) => ({ id: provider.id }));
}

/**
 * The provider New Workspace starts a newly picked agent on: the active (else
 * the daemon's default) provider while it is turned on and available, else the
 * first available one (`''` when there is none yet).
 */
export function defaultInitialAgentProvider({
  activeProviderId,
  defaultProviderId,
  availableProviders,
  ...context
}: ProviderAvailabilityContext & {
  activeProviderId: string;
  defaultProviderId: string;
  availableProviders: ReadonlyArray<{ id: string }>;
}): string {
  const preferred = activeProviderId || defaultProviderId;
  return !isProviderDisabledInSettings({ ...context.enabledProviders }, preferred) &&
    (!context.availability || isInitialAgentProviderAvailable(preferred, context))
    ? preferred
    : (availableProviders[0]?.id ?? '');
}

/**
 * The model New Workspace names for an agent it starts without an explicit
 * model: the daemon-computed `resolvedModel` preview in the provider's
 * context (`undefined` ⇒ provider CLI default, "Provider default"). With no
 * specialist (General), the provider's configured model; the global
 * selection can belong to a different active provider.
 */
export function initialAgentDefaultModel({
  specialist,
  provider,
  providerView,
  specialists,
  configuredModels,
  activeProviderId,
  selectedModel,
}: {
  specialist: string | null;
  provider: string;
  /** `specialist.list(provider)` previews, once fetched. */
  providerView: Readonly<Record<string, ResolvedSpecialist>> | undefined;
  specialists: ReadonlyArray<{ id: string; resolvedModel?: string }>;
  configuredModels: Readonly<Record<string, string>>;
  activeProviderId: string;
  selectedModel: string | undefined;
}): string | undefined {
  if (!specialist) {
    return (
      configuredModels[provider] || (provider === activeProviderId ? selectedModel : undefined)
    );
  }
  if (providerView) return providerView[specialist]?.resolvedModel;
  return specialists.find((s) => s.id === specialist)?.resolvedModel;
}
