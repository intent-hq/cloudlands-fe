<script lang="ts">
  import EventWakeupBanner from '$lib/components/chat/EventWakeupBanner.svelte';

  let { zoom = 1 }: { zoom?: number } = $props();
  const metadata = {
    type: 'event_notification' as const,
    eventCount: 1,
    eventTypes: ['agent:idle'],
    events: [
      {
        type: 'agent:idle',
        data: { agentName: 'Fixture agent', completionReport: 'Done' },
        timestamp: '2026-09-01T09:10:00.000Z',
      },
    ],
  };
</script>

<section style:width="360px" style:zoom>
  <EventWakeupBanner {metadata} asDivider suppressTopGap showAgentCards={false} workspace={null} />
</section>
