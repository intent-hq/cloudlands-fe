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
    title: 'Device row polish',
    defaultState: 'versions',
    states: { versions: { props: {}, setup } },
  });
</script>

<script lang="ts">
  import DevicesSettings from './DevicesSettings.svelte';
</script>

<div class="p-4"><DevicesSettings /></div>
