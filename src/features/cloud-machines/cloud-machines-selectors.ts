import { getItems } from '@themislib/themis/utils/collections/collection-utils';
import { m } from '$shared/paraglide/messages.js';
import { DEFAULT_CLOUD_MACHINE_ID, type CloudMachineProvider } from '$shared/types/cloud-machines';
import type { RemoteMachine } from '$shared/types/remote-machines';
import { isProviderProfileRef, providerRefBaseId } from '$shared/provider-profiles';
import { store } from '$store/renderer/store';
import {
  selectLabsCloudMachinesEnabled,
  selectLabsRemoteAgentsEnabled,
} from '$store/renderer/slices/user-preferences/user-preferences-selectors';
import { selectWorkspaceById } from '$store/renderer/slices/workspace/workspace-selectors';
import type { StartOnCloud } from '$features/remote-machines/start-on';

type State = typeof store.state;

/**
 * E2B setup, the sandbox list and the Start On row show while the Labs
 * "E2B cloud machines" and "Remote agents" flags are on and the backend
 * advertises `cloudMachines: 1`. Agents already on E2B render without it.
 */
export const selectCloudMachinesVisible = store.createSelector(
  (state) =>
    selectLabsCloudMachinesEnabled.select(state) &&
    selectLabsRemoteAgentsEnabled.select(state) &&
    state.remoteMachines?.supported === true &&
    state.cloudMachines?.supported === true,
);

/** `cloudMachineEntries: 1`: entries are named and listed under Nodes. */
export const selectCloudEntriesSupported = store.createSelector(
  (state) => state.cloudMachines?.entries === true,
);

function savedEntries(state: State): CloudMachineProvider[] {
  return Object.values(state.cloudMachines?.providers ?? {}).sort(
    (a, b) => a.configuredAt.localeCompare(b.configuredAt) || a.name.localeCompare(b.name),
  );
}

/** The saved E2B entries, oldest first; empty when E2B is not set up. */
export const selectCloudEntries = store.createSelector(savedEntries);

/** Live sandboxes, oldest first. */
export const selectCloudSandboxes = store.createSelector((state): RemoteMachine[] =>
  Object.values(state.cloudMachines?.machines ?? {}).sort((a, b) =>
    (a.cloud?.startedAt ?? '').localeCompare(b.cloud?.startedAt ?? ''),
  ),
);

/** Paused sandboxes, which no live link counts. */
export const selectPausedCloudSandboxCount = store.createSelector(
  (state) =>
    Object.values(state.cloudMachines?.machines ?? {}).filter(
      (machine) => machine.cloud?.state === 'paused',
    ).length,
);

export interface SandboxAgentLink {
  workspaceId: string;
  agentId: string;
}

/**
 * The agent a sandbox runs, to open from its row; null when its workspace is
 * unknown here. A session missing from the store keeps the link: list reads
 * skip delegated and background agents. The row drops it while a deletion is
 * pending (see `CloudSandboxList`); the app can't tell an agent deleted
 * earlier, since a deletion removes its session.
 */
function sandboxAgentLink(state: State, machine: RemoteMachine): SandboxAgentLink | null {
  const cloud = machine.cloud;
  if (!cloud?.agentId || !cloud.workspaceId) return null;
  if (!selectWorkspaceById.select(state, cloud.workspaceId)) return null;
  return { workspaceId: cloud.workspaceId, agentId: cloud.agentId };
}

/** Per sandbox list: each workspace's name (null when unknown) and each row's agent link. */
export const selectSandboxListContext = store.createSelector(
  (
    state,
    sandboxes: readonly RemoteMachine[],
  ): {
    workspaceNames: Record<string, string | null>;
    agentLinks: Record<string, SandboxAgentLink | null>;
  } => {
    const workspaceNames: Record<string, string | null> = {};
    const agentLinks: Record<string, SandboxAgentLink | null> = {};
    for (const machine of sandboxes) {
      const id = machine.cloud?.workspaceId;
      if (id && !(id in workspaceNames)) {
        const workspace = selectWorkspaceById.select(state, id);
        workspaceNames[id] = workspace?.title || workspace?.name || null;
      }
      agentLinks[machine.id] = sandboxAgentLink(state, machine);
    }
    return { workspaceNames, agentLinks };
  },
);

export const selectCloudSandboxReadAt = store.createSelector(
  (state) => state.cloudMachines?.readAt ?? {},
);

export const selectCloudOperations = store.createSelector(
  (state) => state.cloudMachines?.pending ?? {},
);

export const selectCloudFailures = store.createSelector(
  (state) => state.cloudMachines?.failures ?? {},
);

export const selectCloudValidated = store.createSelector(
  (state) => state.cloudMachines?.validated ?? null,
);

/**
 * The E2B Start On rows, one per entry: null when E2B is not offered, else
 * whether each entry can start a new sandbox at all (the model check comes after).
 */
export function startOnCloud(state: State): StartOnCloud | null {
  if (!selectCloudMachinesVisible.select(state)) return null;
  const entries = savedEntries(state);
  if (entries.length === 0) return null;
  const named = state.cloudMachines?.entries === true;
  return entries.map((entry) => ({
    cloudMachineId: entry.id,
    // One entry still called "E2B" needs no name; otherwise "E2B · <name>".
    label:
      named && (entries.length > 1 || entry.name.trim().toLowerCase() !== 'e2b')
        ? m.cloudMachines_startOn_entry_label({ name: entry.name })
        : m.cloudMachines_startOn_label(),
    unavailableReason:
      entry.state === 'key-rejected' ? m.cloudMachines_state_keyRejected_label() : null,
  }));
}

/**
 * Why `providerRef` can't run on E2B, or null when it can or the app can't
 * tell (the daemon then decides). A sandbox has no login: the configuration
 * must set at least one env variable (an API key or token) and be
 * remote-compatible, and the templates must install its CLI
 * (PROTOCOL `methods/nodes.md` → "Placement on E2B").
 */
export function cloudProfileBlockReason(
  state: State,
  providerRef: string,
  entry: CloudMachineProvider | null = state.cloudMachines?.providers[DEFAULT_CLOUD_MACHINE_ID] ??
    null,
): string | null {
  if (!providerRef) return null;
  const provider = entry;
  const base = providerRefBaseId(providerRef);
  if (provider && provider.agentProviders.length > 0 && !provider.agentProviders.includes(base))
    return m.cloudMachines_startOn_providerMissing();
  const profiles = state.providerSettings?.profiles;
  if (isProviderProfileRef(providerRef)) {
    const profile = profiles
      ? getItems(profiles.items).find((row) => row.providerRef === providerRef)
      : undefined;
    if (!profile) return null;
    if (profile.remoteCompatible === false) return m.cloudMachines_startOn_needsProfile();
    return profile.env.some((entry) => entry.kind === 'set')
      ? null
      : m.cloudMachines_startOn_needsProfile();
  }
  const defaults = profiles?.defaults?.[base];
  if (!defaults)
    return profiles?.loadStatus === 'success' ? m.cloudMachines_startOn_needsProfile() : null;
  if (defaults.remoteCompatible === false) return m.cloudMachines_startOn_needsProfile();
  return defaults.env.some((entry) => entry.kind === 'set')
    ? null
    : m.cloudMachines_startOn_needsProfile();
}
