<script module lang="ts">
  import { definePreview } from '$lib/component-catalog/preview-definition';

  export const preview = definePreview({
    id: 'labs-settings',
    title: 'Labs settings',
    defaultState: 'default',
    states: {
      default: { props: {} },
      mixed: { props: { enabled: ['remoteAgents', 'tabGroups'] } },
      desktop: { props: { desktop: true, enabled: ['remoteAgents', 'browserAccess'] } },
    },
  });
</script>

<script lang="ts">
  import { onDestroy } from 'svelte';
  import { store as appStore } from '$store/renderer/store';
  import { WINDOW_CHANNELS } from '$shared/ipc/channels';
  import { machineRailStateReceived } from '$store/renderer/slices/machine-rail/machine-rail-slice';
  import {
    setLabsBrowserAccessEnabled,
    setLabsPlainFolderWorkspacesEnabled,
    setLabsRemoteAgentsEnabled,
    setLabsTabGroupsEnabled,
  } from '$store/renderer/slices/user-preferences/user-preferences-slice';
  import LabsSettings from './LabsSettings.svelte';

  type Lab = 'remoteAgents' | 'plainFolders' | 'tabGroups' | 'browserAccess';

  let { enabled = [], desktop = false }: { enabled?: Lab[]; desktop?: boolean } = $props();

  const setters = {
    remoteAgents: setLabsRemoteAgentsEnabled,
    plainFolders: setLabsPlainFolderWorkspacesEnabled,
    tabGroups: setLabsTabGroupsEnabled,
    browserAccess: setLabsBrowserAccessEnabled,
  } as const;
  const previousPreferences = appStore.state.userPreferences;
  const previousRail = appStore.state.machineRail;
  const previousApi = window.electronAPI;

  for (const [lab, set] of Object.entries(setters)) {
    appStore.dispatch(set(enabled.includes(lab as Lab)));
  }
  if (desktop) {
    appStore.dispatch(machineRailStateReceived({ ...previousRail, enabled: true }));
    // A non-mock version makes the desktop-only rows render; the dock lab reads it once.
    window.electronAPI = {
      ...previousApi,
      versions: { electron: '39.0.0' },
      invoke: async (channel: string) =>
        channel === WINDOW_CHANNELS.GET_DOCK_LAB ? { enabled: false } : undefined,
      on: () => 'labs-preview',
      offById: () => {},
    } as unknown as typeof window.electronAPI;
  }

  onDestroy(() => {
    appStore.dispatch(setLabsRemoteAgentsEnabled(previousPreferences.labsRemoteAgentsEnabled));
    appStore.dispatch(
      setLabsPlainFolderWorkspacesEnabled(previousPreferences.labsPlainFolderWorkspacesEnabled),
    );
    appStore.dispatch(setLabsTabGroupsEnabled(previousPreferences.labsTabGroupsEnabled));
    appStore.dispatch(setLabsBrowserAccessEnabled(previousPreferences.labsBrowserAccessEnabled));
    if (desktop) {
      appStore.dispatch(machineRailStateReceived(previousRail));
      window.electronAPI = previousApi;
    }
  });
</script>

<div class="mx-auto flex w-full max-w-4xl flex-col gap-6 bg-background px-6 py-6">
  <LabsSettings />
</div>
