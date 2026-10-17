/**
 * Typed contract for the daemon's `providers.profiles.*` RPCs (PROTOCOL §5.54,
 * prepared provider profiles).
 *
 * A profile is a named configuration of an installed Codex or Claude Code CLI.
 * The daemon mints its opaque id and the `providerRef` that every provider
 * field carries; clients read `providerRef` and never compose it. Reads are
 * masked: a saved `set` value is `"********"` (or `""` for a saved empty
 * string) and no method returns a saved value. Zod validates responses at the
 * wire boundary so a divergent payload fails loudly.
 */

import { z } from 'zod';

export const PROVIDER_PROFILES_LIST_METHOD = 'providers.profiles.list';
export const PROVIDER_PROFILES_CREATE_METHOD = 'providers.profiles.create';
export const PROVIDER_PROFILES_UPDATE_METHOD = 'providers.profiles.update';
export const PROVIDER_PROFILES_DELETE_METHOD = 'providers.profiles.delete';
export const PROVIDER_PROFILES_CHANGED_EVENT = 'providers:profiles-changed';

const EnvEntryReadSchema = z.discriminatedUnion('kind', [
  z.object({ key: z.string().min(1), kind: z.literal('set'), value: z.string() }).passthrough(),
  z.object({ key: z.string().min(1), kind: z.literal('unset') }).passthrough(),
]);

const ProviderProfileSchema = z
  .object({
    id: z.string().min(1),
    providerRef: z.string().min(1),
    baseProviderId: z.string().min(1),
    name: z.string(),
    env: z.array(EnvEntryReadSchema),
    settingsFingerprint: z.string(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .passthrough();

const ProfileActivationSchema = z
  .object({ envChanged: z.boolean(), runningProcesses: z.number().int().nonnegative() })
  .passthrough();

export const ProviderProfilesListResponseSchema = z
  .object({ profiles: z.array(ProviderProfileSchema), revision: z.number() })
  .passthrough();
export const ProviderProfileCreateResponseSchema = z
  .object({ profile: ProviderProfileSchema, revision: z.number() })
  .passthrough();
export const ProviderProfileUpdateResponseSchema = z
  .object({
    profile: ProviderProfileSchema,
    revision: z.number(),
    activation: ProfileActivationSchema,
  })
  .passthrough();
export const ProviderProfileDeleteResponseSchema = z
  .object({ profileId: z.string().min(1), revision: z.number() })
  .passthrough();

export type EnvEntryRead = z.infer<typeof EnvEntryReadSchema>;
export type ProviderProfile = z.infer<typeof ProviderProfileSchema>;
export type ProfileActivation = z.infer<typeof ProfileActivationSchema>;
export type ProviderProfilesListResult = z.infer<typeof ProviderProfilesListResponseSchema>;
export type ProviderProfileCreateResult = z.infer<typeof ProviderProfileCreateResponseSchema>;
export type ProviderProfileUpdateResult = z.infer<typeof ProviderProfileUpdateResponseSchema>;
export type ProviderProfileDeleteResult = z.infer<typeof ProviderProfileDeleteResponseSchema>;
export type EnvEntryWrite =
  | { key: string; kind: 'set'; value: string }
  | { key: string; kind: 'unset' }
  | { key: string; kind: 'keep' };

export interface ProviderProfileCreateParams {
  baseProviderId: string;
  name: string;
  env?: EnvEntryWrite[];
}

export interface ProviderProfileUpdateParams {
  profileId: string;
  name?: string;
  env?: EnvEntryWrite[];
}

/** One `invalid-params` failure (`data.fieldErrors[]`). */
export interface ProviderProfileFieldError {
  field: string;
  code: string;
  message: string;
}

/** One `provider-profile-in-use` blocker (`data.inUse[]`). */
export type ProviderProfileInUseReason =
  | { kind: 'defaultProvider' }
  | { kind: 'specialistProvider'; specialistId: string; source: string }
  | { kind: 'specialistModelOption'; specialistId: string; source: string; index: number };

/** Serializable classification of a rejected profile mutation. */
export type ProviderProfileFailure =
  | { kind: 'fieldErrors'; fieldErrors: ProviderProfileFieldError[] }
  | { kind: 'inUse'; inUse: ProviderProfileInUseReason[] }
  | { kind: 'notFound' }
  | { kind: 'other' };

const FieldErrorSchema = z.object({
  field: z.string(),
  code: z.string(),
  message: z.string(),
});
const InUseReasonSchema = z.union([
  z.object({ kind: z.literal('defaultProvider') }),
  z.object({
    kind: z.literal('specialistProvider'),
    specialistId: z.string(),
    source: z.string(),
  }),
  z.object({
    kind: z.literal('specialistModelOption'),
    specialistId: z.string(),
    source: z.string(),
    index: z.number(),
  }),
]);

/**
 * Classify a daemon rejection by its documented `data.code`. Only the stable
 * structured fields are kept: never the request, never a value.
 */
export function classifyProviderProfileError(error: unknown): ProviderProfileFailure {
  const data = (error as { data?: unknown } | null | undefined)?.data;
  if (!data || typeof data !== 'object') return { kind: 'other' };
  const { code, fieldErrors, inUse } = data as {
    code?: unknown;
    fieldErrors?: unknown;
    inUse?: unknown;
  };
  if (code === 'invalid-params') {
    const parsed = z.array(FieldErrorSchema).safeParse(fieldErrors);
    if (parsed.success && parsed.data.length > 0) {
      return {
        kind: 'fieldErrors',
        fieldErrors: parsed.data.map(({ field, code, message }) => ({ field, code, message })),
      };
    }
  }
  if (code === 'provider-profile-in-use') {
    const parsed = z.array(InUseReasonSchema).safeParse(inUse);
    if (parsed.success) return { kind: 'inUse', inUse: parsed.data };
  }
  if (code === 'not-found') return { kind: 'notFound' };
  return { kind: 'other' };
}

/** True for a profile-qualified reference (`<baseProviderId>@<profileId>`). */
export function isProviderProfileRef(providerRef: string): boolean {
  return providerRef.includes('@');
}

/**
 * Canonical base provider id of a provider reference (§5.54). A qualified
 * reference only ever uses a canonical base id before its single `@`, so the
 * base is recoverable even after the profile is deleted (icons, base
 * enablement). Never used to build a reference — clients read `providerRef`.
 */
export function providerRefBaseId(providerRef: string): string {
  const at = providerRef.indexOf('@');
  return at < 0 ? providerRef : providerRef.slice(0, at);
}

/** Minimal profile identity shared by the catalog summary and full profile reads. */
export interface ProviderProfileRefInfo {
  providerRef: string;
  baseProviderId: string;
  name: string;
}

/** The saved profile a reference names; `undefined` for bare or missing references. */
export function findProfileByRef<T extends ProviderProfileRefInfo>(
  profiles: readonly T[],
  providerRef: string,
): T | undefined {
  return isProviderProfileRef(providerRef)
    ? profiles.find((profile) => profile.providerRef === providerRef)
    : undefined;
}

/**
 * Insert each base provider's profile references directly after it, in the
 * daemon's stored order. Profiles whose base is absent from `providerIds`
 * (disabled, unavailable) are not offered. Order of `providerIds` is kept.
 */
export function expandProviderIdsWithProfiles(
  providerIds: readonly string[],
  profiles: readonly ProviderProfileRefInfo[],
): string[] {
  if (profiles.length === 0) return [...providerIds];
  const result: string[] = [];
  const seen = new Set<string>();
  const push = (id: string) => {
    if (seen.has(id)) return;
    seen.add(id);
    result.push(id);
  };
  for (const id of providerIds) {
    push(id);
    if (isProviderProfileRef(id)) continue;
    for (const profile of profiles) if (profile.baseProviderId === id) push(profile.providerRef);
  }
  return result;
}

/** How a provider group/selection is labelled once profiles are considered. */
export type ProviderRefLabelParts =
  { kind: 'plain' } | { kind: 'default' } | { kind: 'profile'; name: string } | { kind: 'missing' };

/**
 * Label rule (§5.54 brief): bare provider labels while the base has no
 * profiles; the original configuration reads "Default" once it has any; a
 * qualified reference reads its current profile name (renames update the
 * label only); a reference to a deleted profile is reported as missing.
 */
export function providerRefLabelParts(
  providerRef: string,
  profiles: readonly ProviderProfileRefInfo[],
  baseProviderId = providerRefBaseId(providerRef),
): ProviderRefLabelParts {
  if (isProviderProfileRef(providerRef)) {
    const profile = findProfileByRef(profiles, providerRef);
    return profile ? { kind: 'profile', name: profile.name } : { kind: 'missing' };
  }
  return profiles.some((profile) => profile.baseProviderId === baseProviderId)
    ? { kind: 'default' }
    : { kind: 'plain' };
}

/**
 * `models.list` `providerId` for a `<base>:get-models` channel (§5.54): the
 * requested profile reference when it names a profile of that same base
 * provider, otherwise the base itself. A profile's catalog is served under its
 * own reference, so caches never cross configurations.
 */
export function modelsListProviderId(baseProviderId: string, providerRef: unknown): string {
  return typeof providerRef === 'string' &&
    isProviderProfileRef(providerRef) &&
    providerRefBaseId(providerRef) === baseProviderId
    ? providerRef
    : baseProviderId;
}
