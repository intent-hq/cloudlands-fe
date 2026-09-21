<script lang="ts">
  import { store as appStore } from '$store/renderer/store';
  import { connectionsListReceived } from '$store/renderer/slices/connections/connections-slice';
  import {
    connectionStatusChanged,
    systemStatusSuccess,
  } from '$store/renderer/slices/daemon-health/daemon-health-slice';
  import { selectDaemonConnectionGeneration } from '$store/renderer/slices/daemon-health/daemon-health-selectors';
  import DaemonStatusIndicator from '../DaemonStatusIndicator.svelte';

  let {
    remote = false,
    bottom = false,
    left = false,
  } = $props<{
    remote?: boolean;
    bottom?: boolean;
    left?: boolean;
  }>();

  // No root lifecycle or sagas: synthetic records cannot open a real connection.
  appStore.init();
  appStore.dispatch(
    connectionsListReceived({
      connections: [
        { id: 'local', label: 'Local', host: null, port: null, fingerprint: null, isLocal: true },
        {
          id: 'fixture-remote',
          label: 'Studio fixture',
          host: 'studio.example',
          port: 4180,
          fingerprint: null,
          isLocal: false,
          accent: 'blue',
          deviceIcon: 'laptop',
        },
      ],
      // svelte-ignore state_referenced_locally - initial fixture state only
      activeId: remote ? 'fixture-remote' : 'local',
      // svelte-ignore state_referenced_locally - initial fixture state only
      windowBackendId: remote ? 'fixture-remote' : 'local',
    }),
  );
  appStore.dispatch(connectionStatusChanged('connected', { mode: 'sidecar-uds' }));
  appStore.dispatch(
    systemStatusSuccess(
      {
        running: true,
        listenMode: 'uds',
        transports: ['uds'],
        port: null,
        clients: 2,
        agents: 1,
        maxAgents: 8,
        version: '0.9.1',
        uptimeSeconds: 5400,
        cpuPercent: 3.2,
        memoryBytes: 157286400,
        fingerprint: null,
        protocolVersion: '2.5', // protocol-version-ok: synthetic wire fixture
        host: { os: 'macos', arch: 'aarch64', hasDisplay: true, locality: 'local' },
      },
      new Date().toISOString(),
      selectDaemonConnectionGeneration.select(appStore.state),
    ),
  );
</script>

<div class="min-h-screen bg-background text-foreground">
  <div
    data-testid="daemon-status-fixture"
    class="fixed"
    style:top={bottom ? undefined : '24px'}
    style:bottom={bottom ? '24px' : undefined}
    style:left={left ? '24px' : undefined}
    style:right={left ? undefined : '24px'}
  >
    <DaemonStatusIndicator />
  </div>
</div>
