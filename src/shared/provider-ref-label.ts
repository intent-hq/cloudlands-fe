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

/** Short profile name for a selection chip; `undefined` when no profile applies. */
export function providerRefProfileName(parts: ProviderRefLabelParts): string | undefined {
  switch (parts.kind) {
    case 'profile':
      return parts.name;
    case 'default':
      return parts.name ?? m.chat_modelPicker_defaultProfile_name();
    case 'missing':
      return m.chat_modelPicker_missingProfile_name();
    default:
      return undefined;
  }
}

/**
 * Group label: the bare provider name while it has no profiles, otherwise
 * `<Provider> · <Profile>` (the original configuration reads `Default`, or
 * its catalog `defaultNames` entry once renamed).
 */
export function formatProviderRefLabel(
  providerRef: string,
  baseDisplayName: string,
  profiles: readonly ProviderProfileRefInfo[],
  baseProviderId?: string,
  defaultNames?: ProviderDefaultNames,
): string {
  const profile = providerRefProfileName(
    providerRefLabelParts(providerRef, profiles, baseProviderId, defaultNames),
  );
  return profile
    ? m.chat_modelPicker_profileGroup_label({ provider: baseDisplayName, profile })
    : baseDisplayName;
}
