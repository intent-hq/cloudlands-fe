/**
 * Display labels for provider references (§5.54 named profiles). Identity is
 * always the daemon's `providerRef`; names only ever label it, so a rename
 * changes these strings and nothing else.
 */
import { m } from '$shared/paraglide/messages.js';
import {
  providerRefLabelParts,
  type ProviderDefaultNames,
  type ProviderProfileRefInfo,
  type ProviderRefLabelParts,
} from '$shared/provider-profiles';

/**
 * Short profile name for a selection chip; `undefined` when no profile applies.
 * A reference the catalog can't name reads "Removed profile" only once its
 * profiles have loaded (`profilesLoaded`); before that it is unknown, not
 * removed, so no profile name applies.
 */
export function providerRefProfileName(
  parts: ProviderRefLabelParts,
  profilesLoaded = true,
): string | undefined {
  switch (parts.kind) {
    case 'profile':
      return parts.name;
    case 'default':
      return parts.name ?? m.chat_modelPicker_defaultProfile_name();
    case 'missing':
      return profilesLoaded ? m.chat_modelPicker_missingProfile_name() : undefined;
    default:
      return undefined;
  }
}

/**
 * Group label: the bare provider name while it has no profiles, otherwise
 * `<Provider> · <Profile>` (the original configuration reads `Default`, or
 * its catalog `defaultNames` entry once renamed). While the profiles are
 * still loading (`profilesLoaded` false) an unknown reference reads as the
 * bare provider name instead of a removed profile.
 */
export function formatProviderRefLabel(
  providerRef: string,
  baseDisplayName: string,
  profiles: readonly ProviderProfileRefInfo[],
  baseProviderId?: string,
  defaultNames?: ProviderDefaultNames,
  profilesLoaded = true,
): string {
  const profile = providerRefProfileName(
    providerRefLabelParts(providerRef, profiles, baseProviderId, defaultNames),
    profilesLoaded,
  );
  return profile
    ? m.chat_modelPicker_profileGroup_label({ provider: baseDisplayName, profile })
    : baseDisplayName;
}
