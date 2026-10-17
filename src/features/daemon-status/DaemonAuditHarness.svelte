<script lang="ts">
  import { onMount, type Snippet } from 'svelte';
  import { store } from '$store/renderer/store';
  import { connectionStatusChanged } from '$store/renderer/slices/daemon-health/daemon-health-slice';
  import {
    connectionsListReceived,
    authRejectedReceived,
  } from '$store/renderer/slices/connections/connections-slice';
  import { guestSessionsListReceived } from '$store/renderer/slices/guest-sessions/guest-sessions-slice';
  import DaemonStoppedOverlay from './DaemonStoppedOverlay.svelte';
  import DaemonUpdatingOverlay from './DaemonUpdatingOverlay.svelte';

  let { state = 'external', children }: { state?: string; children?: Snippet } = $props();
  onMount(() => {
    store.dispatch(connectionStatusChanged('connected'));
    if (state.startsWith('index-')) {
      const phase = state === 'index-finalizing' ? 'finalizing' : 'indexing';
      store.dispatch(
        connectionStatusChanged(
          'connecting',
          { mode: 'external-uds', target: '/tmp/startup-preview.sock' },
          {
            startup: {
              available: state !== 'index-unavailable',
              snapshot: {
                startupStatus: 1,
                attemptId: 'preview',
                phase,
                elapsedMs: 74000,
                phaseElapsedMs: 70000,
                progressAgeMs: state === 'index-unchanged' ? 31000 : 0,
                retryAfterMs: 1000,
                progress: {
                  completedNotes: phase === 'finalizing' ? 1824 : 420,
                  totalNotes: 1824,
                  processedSourceBytes: 40000000,
                  totalSourceBytes: 116000000,
                },
                ...(phase === 'finalizing'
                  ? { finalizingStep: 'committing' as const }
                  : state === 'index-estimate'
                    ? { estimatedRemainingMs: 142000 }
                    : {}),
              },
            },
          },
        ),
      );
      return () => store.dispatch(connectionStatusChanged('connected'));
    }
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

{#if children}
  {@render children()}
{:else}
  <DaemonUpdatingOverlay />
  <DaemonStoppedOverlay />
{/if}
