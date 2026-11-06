import { getItems } from '@themislib/themis/utils/collections/collection-utils';
import { m } from '$shared/paraglide/messages.js';
import type { CloudMachineProvider } from '$shared/types/cloud-machines';
import type { RemoteMachine } from '$shared/types/remote-machines';
import { isProviderProfileRef, providerRefBaseId } from '$shared/provider-profiles';
import { store } from '$store/renderer/store';
import { selectLabsRemoteAgentsEnabled } from '$store/renderer/slices/user-preferences/user-preferences-selectors';
import type { StartOnCloud } from '$features/remote-machines/start-on';

type State = typeof store.state;

/** Cloud surfaces show while remote machines do and the backend advertises `cloudMachines: 1`. */
export const selectCloudMachinesVisible = store.createSelector(
  (state) =>
    selectLabsRemoteAgentsEnabled.select(state) &&
    state.remoteMachines?.supported === true &&
    state.cloudMachines?.supported === true,
);

/** The saved E2B provider, or null when E2B is not set up. */
export const selectE2bProvider = store.createSelector(
  (state): CloudMachineProvider | null => state.cloudMachines?.providers.e2b ?? null,
);

/** Live sandboxes, oldest first. */
export const selectCloudSandboxes = store.createSelector((state): RemoteMachine[] =>
  Object.values(state.cloudMachines?.machines ?? {}).sort((a, b) =>
    (a.cloud?.startedAt ?? '').localeCompare(b.cloud?.startedAt ?? ''),
  ),
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
 * The E2B Start On row at provider level: null when E2B is not offered,
 * else whether a new sandbox can start at all (the model check comes after).
 */
export function startOnCloud(state: State): StartOnCloud | null {
  if (!selectCloudMachinesVisible.select(state)) return null;
  const provider = selectE2bProvider.select(state);
  if (!provider) return null;
  return {
    unavailableReason:
      provider.state === 'key-rejected' ? m.cloudMachines_state_keyRejected_label() : null,
  };
}

/**
 * Why `providerRef` can't run on E2B, or null when it can or the app can't
 * tell (the daemon then decides). A sandbox has no login: the configuration
 * must set at least one env variable (an API key or token) and be
 * remote-compatible, and the templates must install its CLI
 * (PROTOCOL `methods/nodes.md` → "Placement on E2B").
 */
export function cloudProfileBlockReason(state: State, providerRef: string): string | null {
  if (!providerRef) return null;
  const provider = selectE2bProvider.select(state);
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
