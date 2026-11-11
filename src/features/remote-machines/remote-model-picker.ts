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
import { m } from '$shared/paraglide/messages.js';
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
  profileDefaults: readonly ProviderDefaultConfig[];
  profilesLoadStatus: 'idle' | 'success' | 'failure';
}): RemoteModelSwitchSupport {
  if (input.catalogProfiles.some((profile) => typeof profile.remoteCompatible === 'boolean'))
    return 'supported';
  if (input.defaultRemoteIncompatibility) return 'supported';
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

/**
 * Why a configuration can't run on another machine: account folder, not
 * marked, or other. A refused Default (`isDefault`) is unmarked with machine
 * sign-in off, so either option fixes it.
 */
export function remoteIncompatibilityMessage(
  incompatibility: RemoteIncompatibility,
  backend: string,
  isDefault = false,
): string {
  if (incompatibility.reason === 'account-folder')
    return m.chat_modelPicker_remoteAccountFolder_description({ backend });
  if (incompatibility.reason === 'not-marked')
    return isDefault
      ? m.chat_modelPicker_remoteDefaultRefused_description()
      : m.chat_modelPicker_remoteNotMarked_description();
  return m.chat_modelPicker_remoteIncompatible_description();
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
