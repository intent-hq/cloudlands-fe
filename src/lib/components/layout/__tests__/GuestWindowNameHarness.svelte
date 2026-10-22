<script lang="ts">
  import DaemonStatusIndicator from '../DaemonStatusIndicator.svelte';
  import { store } from '$store/renderer/store';
  import { connectionsListReceived } from '$store/renderer/slices/connections/connections-slice';
  import { guestSessionsListReceived } from '$store/renderer/slices/guest-sessions/guest-sessions-slice';

  let {
    hostname = null,
    backendId = 'guest-window',
  }: {
    hostname?: string | null;
    backendId?: string;
  } = $props();

  $effect(() => {
    store.dispatch(
      connectionsListReceived({
        connections: [
          {
            id: 'local',
            label: 'Local machine',
            host: null,
            port: null,
            fingerprint: null,
            isLocal: true,
          },
        ],
        activeId: 'local',
        windowBackendId: backendId,
      }),
    );
    store.dispatch(
      guestSessionsListReceived({
        sessions: [
          {
            id: 'guest-window',
            label: 'remote.example',
            hostname,
            host: 'remote.example',
            hosts: ['remote.example'],
            port: 443,
            fingerprint: 'AA:BB',
            tcAddress: null,
            principalId: 'guest-principal',
            login: 'guest',
            tokenEncrypted: true,
            workspaces: [],
            updatedAt: 1,
          },
        ],
        openIds: ['guest-window'],
        connectedIds: ['guest-window'],
      }),
    );
  });
</script>

<div class="p-6"><DaemonStatusIndicator /></div>
