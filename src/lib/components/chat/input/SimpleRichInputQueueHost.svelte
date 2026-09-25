<script lang="ts">
  import SimpleRichInput from './SimpleRichInput.svelte';
  import QueuedMessageList from '../QueuedMessageList.svelte';

  let {
    streaming = false,
    queueCount = 12,
    width = 360,
  }: { streaming?: boolean; queueCount?: number; width?: number } = $props();
  let value = $state('');
  let lastAction = $state('');
  const messages = $derived(
    Array.from({ length: queueCount }, (_, i) => ({
      id: `queue-${i}`,
      // i18n-ignore (test-only component fixture content)
      content: `Queued message ${i + 1}`,
      queuedAt: '2026-01-01T00:00:00.000Z',
      position: i,
    })),
  );
</script>

<div class="group/panel" style="height: 240px;" style:width="{width}px">
  <SimpleRichInput
    bind:value
    workspace={null}
    isStreaming={streaming}
    isResponding={streaming}
    onsubmit={() => (lastAction = 'sent')}
    onstop={() => (lastAction = 'stopped')}
  >
    {#snippet queueRegion()}
      {#if messages.length > 0}
        <QueuedMessageList {messages} />
      {/if}
    {/snippet}
  </SimpleRichInput>
</div>
<output>{lastAction}</output>
