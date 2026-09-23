<script module lang="ts">
  // protocol-version-ok-file: fixture versions exercise behind-pin rendering, not protocol capability gates.
  import { definePreview } from '$lib/component-catalog/preview-definition';
  import { store as appStore } from '$store/renderer/store';
  import { connectionsListReceived } from '$store/renderer/slices/connections/connections-slice';
  import { selectConnections } from '$store/renderer/slices/connections/connections-selectors';
  import type { ConnectionsListResult } from '$shared/types/connections';

  function setup() {
    const state = appStore.state.connections;
    const previous: ConnectionsListResult = {
      connections: selectConnections.select(appStore.state),
      activeId: state.activeId,
      windowBackendId: state.windowBackendId,
      pinnedVersion: state.pinnedVersion,
      connectedIds: state.connectedIds,
    };
    appStore.dispatch(
      connectionsListReceived({
        activeId: 'local',
        windowBackendId: 'local',
        pinnedVersion: '0.9.1',
        connectedIds: ['local', 'studio'],
        connections: [
          {
            id: 'local',
            label: 'Local',
            host: '',
            port: 0,
            fingerprint: '',
            accent: null,
            isLocal: true,
            status: 'connected',
            intentdVersion: '6.8.0',
          },
          {
            id: 'studio',
            label: 'Studio Mac',
            host: 'studio.invalid',
            port: 5181,
            fingerprint: 'fixture',
            accent: 'indigo',
            isLocal: false,
            status: 'connected',
            intentdVersion: '6.7.0',
            daemonVersion: '0.9.0',
            updateSupported: true,
          },
          {
            id: 'offline',
            label: 'Offline Mac',
            host: 'offline.invalid',
            port: 5181,
            fingerprint: 'fixture',
            accent: 'emerald',
            isLocal: false,
            status: 'disconnected',
            intentdVersion: '6.6.0',
            daemonVersion: '0.9.0',
          },
          {
            id: 'unknown',
            label: 'Unknown version',
            host: 'unknown.invalid',
            port: 5181,
            fingerprint: 'fixture',
            accent: null,
            isLocal: false,
            status: 'connected',
            daemonVersion: '0.9.0',
          },
        ],
      }),
    );
    return () => appStore.dispatch(connectionsListReceived(previous));
  }

  export const preview = definePreview({
    id: 'devices-settings',
    title: 'Device settings',
    defaultState: 'versions',
    states: {
      versions: { props: {}, setup },
      'local-expanded': { props: { expanded: true }, setup },
      'access-disabled': { props: { accessEnabled: false }, setup },
    },
  });
</script>

<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import { appClient, type SettingDefinitionWithValue } from '$lib/client';
  import DevicesSettings from './DevicesSettings.svelte';

  let { expanded = false, accessEnabled = true }: { expanded?: boolean; accessEnabled?: boolean } =
    $props();
  const previous = {
    list: appClient.settings.list,
    update: appClient.settings.update,
    pairingInfo: appClient.server.pairingInfo,
  };
  const definitions = [
    { path: 'server.wsApi.enabled', value: untrack(() => accessEnabled), type: 'boolean' },
    { path: 'server.wsApi.port', value: 5181, type: 'number' },
    { path: 'server.bindAddress', value: ['0.0.0.0'], type: 'string' },
    { path: 'server.tunnel.enabled', value: false, type: 'boolean' },
    { path: 'server.tunnel.only', value: false, type: 'boolean' },
  ].map((entry) => ({
    label: entry.path,
    description: '',
    category: 'server',
    ...entry,
  })) as SettingDefinitionWithValue[];
  appClient.settings.list = async () => definitions;
  appClient.settings.update = async (changes) => {
    for (const change of changes) {
      const entry = definitions.find((entry) => entry.path === change.path);
      if (entry) entry.value = change.value;
    }
    return changes;
  };
  // Synthetic pairing data; this preview never reads a real machine's credentials.
  appClient.server.pairingInfo = async () => ({
    token: 'preview-not-a-real-token',
    certFingerprint: 'AA:BB:CC:DD:EE:FF:00:11:22:33',
    port: 5181,
    path: '/ws',
    localIps: ['192.0.2.10'],
    availableIps: ['192.0.2.10'],
    hostname: 'preview-device',
    tcAddress: 'preview-tailcat-address',
  });
  onDestroy(() => {
    appClient.settings.list = previous.list;
    appClient.settings.update = previous.update;
    appClient.server.pairingInfo = previous.pairingInfo;
  });
</script>

<div class="bg-background p-4"><DevicesSettings localSettingsRequested={expanded ? 1 : 0} /></div>
