<script lang="ts">
  import { onDestroy } from 'svelte';
  import EventWakeupBanner from '$lib/components/chat/EventWakeupBanner.svelte';
  import { startRootStoreLifecycle } from '$store/renderer/root-store-lifecycle';
  import { store } from '$store/renderer/store';

  interface Props {
    theme?: 'light' | 'dark';
    width?: number;
    zoom?: number;
  }

  let { theme = 'light', width = 420, zoom = 1 }: Props = $props();
  const disposeStore = startRootStoreLifecycle(store, { startSagas: () => [] });
  onDestroy(disposeStore);

  const metadata = {
    type: 'event_notification' as const,
    eventCount: 6,
    eventTypes: ['agent:idle'],
    events: Array.from({ length: 6 }, (_, index) => ({
      type: 'agent:idle',
      timestamp: `2026-08-15T12:0${index}:00.000Z`,
      data: { agentId: `agent-${index}`, agentName: `Agent ${index}` },
    })),
  };
</script>

<section
  class:dark={theme === 'dark'}
  class:light={theme === 'light'}
  style:width="{width}px"
  style:zoom
  class="bg-background p-4 text-foreground"
>
  <EventWakeupBanner {metadata} asDivider showAgentCards workspace={null} />
</section>
