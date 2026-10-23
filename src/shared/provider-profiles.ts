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
export const PROVIDER_PROFILES_REORDER_METHOD = 'providers.profiles.reorder';
export const PROVIDER_PROFILES_UPDATE_DEFAULT_METHOD = 'providers.profiles.updateDefault';
export const PROVIDER_PROFILES_CHANGED_EVENT = 'providers:profiles-changed';

const EnvEntryReadSchema = z.discriminatedUnion('kind', [
  z.object({ key: z.string().min(1), kind: z.literal('set'), value: z.string() }).passthrough(),
  z.object({ key: z.string().min(1), kind: z.literal('unset') }).passthrough(),
]);

/**
 * Per-profile activation count on profile reads (coordinator decision, daemon
 * activation work): live provider processes still on earlier settings.
 * Optional and additive; absent on daemons that do not report it.
 */
const ProfileReadActivationSchema = z
  .object({ runningProcesses: z.number().int().nonnegative() })
  .passthrough();

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
    activation: ProfileReadActivationSchema.optional(),
    /** Quota failover may switch to this profile. Absent reads as `false`. */
    backup: z.boolean().optional(),
  })
  .passthrough();

const ProfileActivationSchema = z
  .object({ envChanged: z.boolean(), runningProcesses: z.number().int().nonnegative() })
  .passthrough();

/**
 * The Default configuration of one profile-capable base provider (§5.54
 * "Default configuration overrides"): its display name and masked env
 * overrides. `providerRef` is the bare base id; the name labels it only.
 */
const DefaultConfigSchema = z
  .object({
    baseProviderId: z.string().min(1),
    providerRef: z.string().min(1),
    name: z.string(),
    env: z.array(EnvEntryReadSchema),
    settingsFingerprint: z.string(),
    activation: ProfileReadActivationSchema.optional(),
  })
  .passthrough();

export const ProviderProfilesListResponseSchema = z
  .object({
    profiles: z.array(ProviderProfileSchema),
    /** Absent on daemons without Default configuration overrides. */
    defaults: z.array(DefaultConfigSchema).optional(),
    revision: z.number(),
  })
  .passthrough();
export const ProviderDefaultUpdateResponseSchema = z
  .object({
    defaultConfig: DefaultConfigSchema,
    revision: z.number(),
    activation: ProfileActivationSchema,
  })
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
export const ProviderProfileReorderResponseSchema = z
  .object({ profiles: z.array(ProviderProfileSchema), revision: z.number() })
  .passthrough();

export type EnvEntryRead = z.infer<typeof EnvEntryReadSchema>;
export type ProviderProfile = z.infer<typeof ProviderProfileSchema>;
export type ProviderDefaultConfig = z.infer<typeof DefaultConfigSchema>;
export type ProviderDefaultUpdateResult = z.infer<typeof ProviderDefaultUpdateResponseSchema>;
export type ProfileActivation = z.infer<typeof ProfileActivationSchema>;
export type ProviderProfilesListResult = z.infer<typeof ProviderProfilesListResponseSchema>;
export type ProviderProfileCreateResult = z.infer<typeof ProviderProfileCreateResponseSchema>;
export type ProviderProfileUpdateResult = z.infer<typeof ProviderProfileUpdateResponseSchema>;
export type ProviderProfileDeleteResult = z.infer<typeof ProviderProfileDeleteResponseSchema>;
export type ProviderProfileReorderResult = z.infer<typeof ProviderProfileReorderResponseSchema>;
export type EnvEntryWrite =
  | { key: string; kind: 'set'; value: string }
  | { key: string; kind: 'unset' }
  | { key: string; kind: 'keep' };

export interface ProviderProfileCreateParams {
  baseProviderId: string;
  name: string;
  env?: EnvEntryWrite[];
  backup?: boolean;
}

export interface ProviderProfileUpdateParams {
  profileId: string;
  name?: string;
  env?: EnvEntryWrite[];
  /** Omitted keeps the saved value. */
  backup?: boolean;
}

/** `providers.profiles.updateDefault`: omitted fields keep the saved value; a blank name restores "Default". */
export interface ProviderDefaultUpdateParams {
  baseProviderId: string;
  name?: string;
  env?: EnvEntryWrite[];
}

/** `providers.profiles.reorder`: the complete new order of one base provider's profiles. */
export interface ProviderProfileReorderParams {
  baseProviderId: string;
  profileIds: string[];
}

/**
 * Apply `orderedIds` to the slots `baseProviderId`'s profiles occupy in
 * `profiles`, leaving other base providers where they are (the daemon's
 * saved-order rule). Returns `undefined` unless `orderedIds` names exactly
 * that base provider's profiles, once each.
 */
export function permuteBaseProfiles<T extends { id: string; baseProviderId: string }>(
  profiles: readonly T[],
  baseProviderId: string,
  orderedIds: readonly string[],
  replacements: readonly T[] = [],
): T[] | undefined {
  const base = profiles.filter((profile) => profile.baseProviderId === baseProviderId);
  const byId = new Map(base.map((profile) => [profile.id, profile]));
  for (const replacement of replacements)
    if (byId.has(replacement.id)) byId.set(replacement.id, replacement);
  if (orderedIds.length !== base.length || new Set(orderedIds).size !== orderedIds.length)
    return undefined;
  if (!orderedIds.every((id) => byId.has(id))) return undefined;
  let next = 0;
  return profiles.map((profile) =>
    profile.baseProviderId === baseProviderId ? byId.get(orderedIds[next++])! : profile,
  );
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

/** Base providers whose Fast mode / service tier lives in `providers.fastMode`. */
const FAST_MODE_PROVIDER_IDS: readonly string[] = ['claude-code', 'codex'];

const PROFILE_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,31}$/;

/**
 * Whether `key` is a valid `providers.fastMode` key: a Fast mode base
 * provider, or a well-formed profile reference of one. Each profile keeps
 * its own entry; the Default profile's value never applies to it.
 */
export function isFastModeSettingKey(key: string): boolean {
  const at = key.indexOf('@');
  if (at < 0) return FAST_MODE_PROVIDER_IDS.includes(key);
  return (
    FAST_MODE_PROVIDER_IDS.includes(key.slice(0, at)) && PROFILE_ID_PATTERN.test(key.slice(at + 1))
  );
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
  | { kind: 'plain' }
  | { kind: 'default'; name?: string }
  | { kind: 'profile'; name: string }
  | { kind: 'missing' };

/** Renamed Default configurations by base provider id (catalog `defaultNames`). */
export type ProviderDefaultNames = Readonly<Record<string, string>>;

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
  defaultNames?: ProviderDefaultNames,
): ProviderRefLabelParts {
  if (isProviderProfileRef(providerRef)) {
    const profile = findProfileByRef(profiles, providerRef);
    return profile ? { kind: 'profile', name: profile.name } : { kind: 'missing' };
  }
  if (!profiles.some((profile) => profile.baseProviderId === baseProviderId))
    return { kind: 'plain' };
  // A renamed Default (catalog `defaultNames`) reads its own name.
  const name = defaultNames?.[baseProviderId];
  return name ? { kind: 'default', name } : { kind: 'default' };
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

/**
 * The `provider-profile-replacement-required` refusal (§5.54, `-32602` with
 * `data: { code, providerRef, reason }`) from a turn, resume or create, or
 * `undefined` for any other error. Wrapped errors are followed via `cause`.
 */
export function providerReplacementFromError(
  error: unknown,
): { providerRef: string; reason: 'profile-missing' | 'provider-disabled' } | undefined {
  for (let current = error, depth = 0; current && depth < 4; depth++) {
    const data = (current as { data?: unknown }).data;
    if (data && typeof data === 'object') {
      const { code, providerRef, reason } = data as Record<string, unknown>;
      if (
        code === 'provider-profile-replacement-required' &&
        typeof providerRef === 'string' &&
        (reason === 'profile-missing' || reason === 'provider-disabled')
      )
        return { providerRef, reason };
    }
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}
