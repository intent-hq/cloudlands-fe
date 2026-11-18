/**
 * Rules of the orchestrator onboarding "Connect {provider}" step. The
 * orchestrator runs no provider, so no test prompt can check the key: a
 * well-formed key or token is saved as a profile and becomes the provider's
 * default; machines use it when an agent starts there.
 */
import { providerRefBaseId, type ProviderProfile } from '$shared/provider-profiles';
import { isSecretWellFormed, type ProfileProvider } from '$lib/provider-profile-kinds';

export type ConnectKind = 'token' | 'apiKey';

/** The first is preselected: Claude's subscription token, Codex's ChatGPT access token. */
export const CONNECT_KINDS: readonly ConnectKind[] = ['token', 'apiKey'];

export type ConnectSecretIssue = 'empty' | 'shape';

export function connectSecretIssue(
  provider: ProfileProvider,
  kind: ConnectKind,
  secret: string,
): ConnectSecretIssue | undefined {
  if (secret.trim() === '') return 'empty';
  return isSecretWellFormed(provider, kind, secret) ? undefined : 'shape';
}

/** The profile this step saved: the active provider is one of `baseProviderId`'s profiles. */
export function savedConnectProfile(
  activeProviderId: string | undefined,
  baseProviderId: string,
  profiles: readonly ProviderProfile[],
): ProviderProfile | undefined {
  if (!activeProviderId || providerRefBaseId(activeProviderId) !== baseProviderId) return undefined;
  if (activeProviderId === baseProviderId) return undefined;
  return profiles.find((profile) => profile.providerRef === activeProviderId);
}

export function canContinueConnect(input: {
  saved: boolean;
  replacing: boolean;
  issue: ConnectSecretIssue | undefined;
  busy: boolean;
}): boolean {
  if (input.busy) return false;
  if (input.saved && !input.replacing) return true;
  return input.issue === undefined;
}

/** `name`, or `name 2`, `name 3`… when a profile of the provider already has it (ignoring case). */
export function uniqueProfileName(name: string, taken: readonly string[]): string {
  const used = new Set(taken.map((item) => item.toLocaleLowerCase()));
  if (!used.has(name.toLocaleLowerCase())) return name;
  for (let n = 2; ; n++) {
    const candidate = `${name} ${n}`;
    if (!used.has(candidate.toLocaleLowerCase())) return candidate;
  }
}
