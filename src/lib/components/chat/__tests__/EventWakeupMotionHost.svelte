<script lang="ts">
  import { onDestroy } from 'svelte';
  import EventWakeupBanner from '$lib/components/chat/EventWakeupBanner.svelte';
  import { startRootStoreLifecycle } from '$store/renderer/root-store-lifecycle';
  import { store } from '$store/renderer/store';

  const disposeStore = startRootStoreLifecycle(store, { startSagas: () => [] });
  onDestroy(disposeStore);

  type Scenario =
    'one' | 'two' | 'four' | 'five' | 'duplicate' | 'unknown' | 'attention' | 'failure' | 'motion';

  interface Props {
    scenario?: Scenario;
    count?: number;
    reverse?: boolean;
  }

  let { scenario = 'motion', count = 4, reverse = false }: Props = $props();
  const event = (type: string, index: number, data: Record<string, unknown> = {}) => ({
    type,
    timestamp: `2026-08-16T03:0${index}:00.000Z`,
    data,
  });

  const events = $derived.by(() => {
    if (scenario === 'one') return [event('agent:idle', 0, { agentName: 'Alpha' })];
    if (scenario === 'two')
      return [
        event('agent:idle', 0, { agentName: 'Alpha' }),
        event('agent:failed', 1, { agentName: 'Beta' }),
      ];
    if (scenario === 'duplicate')
      return [
        event('agent:idle', 0, { agentName: 'Alpha' }),
        event('agent:idle', 1, { agentName: 'Alpha' }),
      ];
    if (scenario === 'unknown') return [event('custom:unknown', 0)];
    if (scenario === 'attention')
      return [event('agent:status-changed', 0, { agentName: 'Alpha', status: 'waiting' })];
    if (scenario === 'failure') return [event('agent:failed', 0, { agentName: 'Alpha' })];
    const length = scenario === 'five' ? 5 : scenario === 'four' ? 4 : count;
    const rows = Array.from({ length }, (_, index) =>
      event('agent:completed', index, { agentName: `Agent ${index}` }),
    );
    return reverse ? rows.reverse() : rows;
  });
  const metadata = $derived({
    type: 'event_notification' as const,
    eventCount: events.length,
    eventTypes: events.map((current) => current.type),
    events,
  });
</script>

<section class="w-[320px] bg-background p-2 text-foreground">
  <EventWakeupBanner {metadata} asDivider showAgentCards={false} />
</section>
