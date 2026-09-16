<script lang="ts">
  import SimpleRichInput from './SimpleRichInput.svelte';
  import QueuedMessageList from '../QueuedMessageList.svelte';

  let { streaming = false }: { streaming?: boolean } = $props();
  let value = $state('');
  let lastAction = $state('');
  const messages = Array.from({ length: 12 }, (_, i) => ({
    id: `queue-${i}`,
    content: `Queued message ${i + 1}`,
    queuedAt: '2026-01-01T00:00:00.000Z',
    position: i,
  }));
</script>

<div class="group/panel" style="height: 240px; width: 360px;">
  <SimpleRichInput
    bind:value
    workspace={null}
    isStreaming={streaming}
    isResponding={streaming}
    onsubmit={() => (lastAction = 'sent')}
    onstop={() => (lastAction = 'stopped')}
  >
    {#snippet queueRegion()}
      <QueuedMessageList {messages} />
    {/snippet}
  </SimpleRichInput>
</div>
<output>{lastAction}</output>
