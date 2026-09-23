<script lang="ts">
  import { onMount } from 'svelte';
  import { store } from '$store/renderer/store';
  import { connectionStatusChanged } from '$store/renderer/slices/daemon-health/daemon-health-slice';
  import {
    connectionsListReceived,
    authRejectedReceived,
  } from '$store/renderer/slices/connections/connections-slice';
  import { guestSessionsListReceived } from '$store/renderer/slices/guest-sessions/guest-sessions-slice';
  import DaemonStoppedOverlay from './DaemonStoppedOverlay.svelte';
  import DaemonUpdatingOverlay from './DaemonUpdatingOverlay.svelte';

  let { state = 'external' }: { state?: string } = $props();
  onMount(() => {
    store.dispatch(connectionStatusChanged('connected'));
    if (state.startsWith('guest-') || state.startsWith('auth-')) {
      const connection = {
        id: 'audit-host',
        label: 'Design team host',
        host: 'development.example.com',
        port: 4321,
        fingerprint: 'AB:CD',
        isLocal: false,
      };
      store.dispatch(
        connectionsListReceived({
          connections: [connection],
          activeId: connection.id,
          windowBackendId: connection.id,
        }),
      );
      if (state.startsWith('guest-')) {
        store.dispatch(
          guestSessionsListReceived({
            sessions: [
              {
                ...connection,
                hosts: [connection.host],
                tcAddress: connection.host,
                hostname: 'Design team host',
                principalId: 'audit-principal',
                login: 'reviewer',
                tokenEncrypted: true,
                workspaces: [],
                updatedAt: 1,
              },
            ],
            openIds: [connection.id],
            connectedIds: [],
          }),
        );
      }
      if (state !== 'guest-offline') {
        store.dispatch(
          authRejectedReceived({
            id: connection.id,
            host: connection.host,
            port: connection.port,
            statusCode: state === 'auth-disabled' ? 403 : 401,
          }),
        );
      }
    }
    store.dispatch(
      connectionStatusChanged(
        'disconnected',
        {
          mode: state === 'startup' || state === 'updating' ? 'sidecar-uds' : 'external-ws',
          target:
            state === 'long-host'
              ? 'workspace-development-server-with-a-very-long-unbroken-hostname.example.internal:4321'
              : 'development.example.com:4321',
        },
        state === 'updating'
          ? { daemonUpdateDisconnectedAt: Date.now() }
          : state === 'startup'
            ? { sidecarStartupFailed: true, reason: 'The intentd executable could not be started.' }
            : state === 'limited'
              ? { connectionLimited: true, connectionLimitRetryAfterMs: 30000 }
              : { reconnectAttempts: 3 },
      ),
    );
    return () => store.dispatch(connectionStatusChanged('connected'));
  });
</script>

<DaemonUpdatingOverlay />
<DaemonStoppedOverlay />
