/**
 * The model picker of a remote agent (PROTOCOL `methods/nodes.md` →
 * "Switching a remote agent's model"): only the providers and models its
 * machine reported, and only remote-compatible configurations
 * (`methods/provider-profiles.md` → "Remote compatibility").
 *
 * Backends that predate the switch refuse every model change on a remote
 * agent, so the picker stays locked there. Support is detected by the
 * presence of `remoteCompatible` on profile rows: catalog `profiles`, the
 * catalog's `defaultRemoteIncompatibility`, or the Default rows of
 * `providers.profiles.list` (present even without overrides).
 */
import type { ProviderProfileSummary, RemoteIncompatibility } from '$shared/provider-catalog';
import type { ProviderDefaultConfig } from '$shared/provider-profiles';
import { isProviderProfileRef, providerRefBaseId } from '$shared/provider-profiles';
import type { RemoteMachine } from '$shared/types/remote-machines';

export type RemoteModelSwitchSupport = 'supported' | 'unsupported' | 'unknown';

/**
 * Whether the backend lets `agent.setModel` switch a remote agent.
 * `unknown` while nothing read so far tells: no profile rows in the catalog,
 * every Default compatible, and the profile list not read yet.
 */
export function remoteModelSwitchSupport(input: {
  catalogProfiles: readonly ProviderProfileSummary[];
  defaultRemoteIncompatibility?: Record<string, RemoteIncompatibility>;
  defaultRemoteLaunch?: Record<string, string>;
  profileDefaults: readonly ProviderDefaultConfig[];
  profilesLoadStatus: 'idle' | 'success' | 'failure';
}): RemoteModelSwitchSupport {
  if (input.catalogProfiles.some((profile) => typeof profile.remoteCompatible === 'boolean'))
    return 'supported';
  if (input.defaultRemoteIncompatibility || input.defaultRemoteLaunch) return 'supported';
  if (input.profileDefaults.some((config) => typeof config.remoteCompatible === 'boolean'))
    return 'supported';
  // Profile rows without the field come from a daemon that predates it.
  if (input.catalogProfiles.length > 0) return 'unsupported';
  return input.profilesLoadStatus === 'idle' ? 'unknown' : 'unsupported';
}

/**
 * Why `providerRef` can't run on another machine, or null when it can.
 * Unknown reasons count as incompatible (open enum); absent fields count as
 * compatible and placement decides.
 */
export function remoteIncompatibilityFor(
  providerRef: string,
  catalogProfiles: readonly ProviderProfileSummary[],
  defaultRemoteIncompatibility?: Record<string, RemoteIncompatibility>,
): RemoteIncompatibility | null {
  if (isProviderProfileRef(providerRef)) {
    const profile = catalogProfiles.find((row) => row.providerRef === providerRef);
    if (profile?.remoteCompatible !== false) return null;
    return profile.remoteIncompatibility ?? { reason: 'unknown', keys: [] };
  }
  return defaultRemoteIncompatibility?.[providerRef] ?? null;
}

/** The machine report counts as old after a day. */
export const MACHINE_REPORT_STALE_MS = 24 * 60 * 60 * 1000;

export type MachineReportFreshness = 'missing' | 'stale' | 'fresh';

export function machineReportFreshness(
  machine: RemoteMachine | null | undefined,
  now: number,
): MachineReportFreshness {
  if (!machine?.capabilities) return 'missing';
  const observed = machine.observedAt ? Date.parse(machine.observedAt) : Number.NaN;
  if (Number.isFinite(observed) && now - observed > MACHINE_REPORT_STALE_MS) return 'stale';
  return 'fresh';
}

/** Placement treats these as not installed. */
export const MACHINE_PROVIDER_NOT_INSTALLED = new Set(['cli-missing', 'prerequisite-missing']);
const SIGNED_OUT = new Set(['signed-out', 'auth-failed']);

/** The machine reports the provider as signed out (or its sign-in failed). */
function isMachineProviderSignedOut(status: string): boolean {
  return SIGNED_OUT.has(status);
}

/**
 * The machine's own login for `providerRef` is signed out. Profiles bring
 * their own credentials, so only a bare base provider (the Default) counts.
 */
export function isRemoteRefSignedOut(
  machine: RemoteMachine | null | undefined,
  providerRef: string,
): boolean {
  if (isProviderProfileRef(providerRef)) return false;
  const base = providerRefBaseId(providerRef);
  const provider = machine?.capabilities?.providers.find((row) => row.id === base);
  return !!provider && isMachineProviderSignedOut(provider.status);
}

/** What the catalog (and the admin-only profile list) says about each Default. */
export interface DefaultRemoteInput {
  /** Catalog `defaultRemoteLaunch`: `send`, `machine-sign-in` or `refused`. */
  defaultRemoteLaunch?: Record<string, string>;
  /** Older daemons only: the catalog's `defaultRemoteIncompatibility`. */
  defaultRemoteIncompatibility?: Record<string, RemoteIncompatibility>;
  /** Whether each Default saves overrides; absent when unknown. */
  defaultHasOverrides?: Record<string, boolean>;
}

/**
 * The plain Default sends its settings to a remote machine: it is marked
 * (`defaultRemoteLaunch` "send"; an older daemon: not listed as incompatible)
 * and is not known to have nothing to send.
 */
export function defaultRemoteSends(base: string, input: DefaultRemoteInput): boolean {
  const marked = input.defaultRemoteLaunch
    ? input.defaultRemoteLaunch[base] === 'send'
    : !input.defaultRemoteIncompatibility?.[base];
  return marked && input.defaultHasOverrides?.[base] !== false;
}

/**
 * The plain Default runs with the machine's own sign-in: the machine is signed
 * in to the provider or its status is unknown, it is not an E2B sandbox, and
 * the Default is not refused everywhere.
 */
export function defaultRemoteOwnSignIn(
  machine: RemoteMachine,
  base: string,
  input: DefaultRemoteInput,
): boolean {
  if (input.defaultRemoteLaunch?.[base] === 'refused') return false;
  return !machine.cloud && !isRemoteRefSignedOut(machine, base);
}

/**
 * The Remote Ready profile a remote launch of the plain Default uses instead
 * (the daemon's auto-pick): the machine isn't signed in to the provider (an
 * E2B sandbox never is), the Default itself has nothing to send, and the
 * first marked profile of that provider in the saved order. Null otherwise;
 * an explicitly chosen profile is never replaced.
 */
export function remoteAutoPickProfile(
  input: DefaultRemoteInput & {
    machine: RemoteMachine;
    providerRef: string;
    catalogProfiles: readonly ProviderProfileSummary[];
  },
): ProviderProfileSummary | null {
  const { machine, providerRef } = input;
  if (isProviderProfileRef(providerRef)) return null;
  if (defaultRemoteOwnSignIn(machine, providerRef, input)) return null;
  if (defaultRemoteSends(providerRef, input)) return null;
  return (
    input.catalogProfiles.find(
      (profile) => profile.baseProviderId === providerRef && profile.remoteCompatible === true,
    ) ?? null
  );
}
