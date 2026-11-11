<script module lang="ts">
  import { definePreview } from '$lib/component-catalog/preview-definition';
  import { store } from '$store/renderer/store';
  import { connectionsListReceived } from '$store/renderer/slices/connections/connections-slice';
  import { selectConnections } from '$store/renderer/slices/connections/connections-selectors';
  import type { ConnectionRecord } from '$shared/types/connections';

  const local: ConnectionRecord = {
    id: 'local',
    label: 'This machine',
    host: null,
    port: null,
    fingerprint: null,
    isLocal: true,
    status: 'connected',
  };

  function remote(
    id: string,
    label: string,
    extra: Partial<ConnectionRecord> = {},
  ): ConnectionRecord {
    return {
      id,
      label,
      host: '192.0.2.10',
      port: 5179,
      fingerprint: 'AA:BB',
      isLocal: false,
      status: 'connected',
      ...extra,
    };
  }

  const several: ConnectionRecord[] = [
    local,
    remote('build-box', 'Build box', { accent: 'emerald', deviceIcon: 'server' }),
    remote('studio', 'Studio Mac', { accent: 'violet', deviceIcon: 'macStudio' }),
    remote('cloud', 'Cloud VM', { accent: null, deviceIcon: 'cloudVm' }),
  ];

  const many: ConnectionRecord[] = [
    local,
    ...Array.from({ length: 16 }, (_, i) =>
      remote(`m-${i}`, `Machine ${i + 1}`, {
        accent: (['blue', 'violet', 'emerald', 'teal'] as const)[i % 4],
      }),
    ),
  ];

  function seed(connections: ConnectionRecord[], current: string) {
    return () => {
      const before = store.state;
      const previous = selectConnections.select(before);
      store.dispatch(
        connectionsListReceived({ connections, activeId: current, windowBackendId: current }),
      );
      return () =>
        store.dispatch(
          connectionsListReceived({
            connections: previous,
            activeId: before.connections.activeId,
            windowBackendId: before.connections.windowBackendId,
          }),
        );
    };
  }

  export const preview = definePreview({
    id: 'connection-rail',
    title: 'Connection rail',
    defaultState: 'several',
    states: {
      'local-only': { props: {}, setup: seed([local], 'local') },
      several: { props: {}, setup: seed(several, 'build-box') },
      many: { props: {}, setup: seed(many, 'm-3') },
    },
    captureReadiness: { selector: '[data-testid="connection-rail"]' },
  });
</script>

<script lang="ts">
  import ConnectionRail from './ConnectionRail.svelte';
</script>

<div class="flex h-[420px] w-full bg-background pt-2 pb-2 pl-2 text-foreground">
  <ConnectionRail />
  <div class="mr-2 flex-1 rounded-xl border border-border bg-sidebar shadow-sm"></div>
</div>
