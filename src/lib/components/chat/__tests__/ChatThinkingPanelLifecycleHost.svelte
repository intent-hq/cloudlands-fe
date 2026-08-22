<script lang="ts">
  import StreamingStatus from '../StreamingStatus.svelte';

  let {
    revealed = false,
    remountKey = 0,
    phase = 'streaming',
    message = 'Streaming from the daemon',
    timestamp = Date.now() - 2_000,
    concurrent = false,
    width = 720,
    zoom = 1,
  }: {
    revealed?: boolean;
    remountKey?: number;
    phase?: string;
    message?: string;
    timestamp?: number;
    concurrent?: boolean;
    width?: number;
    zoom?: number;
  } = $props();
</script>

{#snippet thinkingPanel(id: string)}
  <div class="tab-content-wrapper h-full w-full" class:hidden={!revealed} data-tab-id={id}>
    <div class="panel-content-renderer flex h-full w-full flex-col overflow-hidden">
      <div class="flex min-h-0 min-w-0 flex-1 flex-col" data-testid="chat-thinking-panel">
        <StreamingStatus
          isProcessing
          statusEvents={[{ phase, message, level: 'info', timestamp }]}
          seed={id}
        />
      </div>
    </div>
  </div>
{/snippet}

<section class="panel-content relative overflow-hidden" style:width="{width}px" style:zoom>
  {#key remountKey}
    {@render thinkingPanel('agent-tab-primary')}
  {/key}
  {#if concurrent}
    {@render thinkingPanel('agent-tab-concurrent')}
  {/if}
</section>

<style>
  .tab-content-wrapper {
    overflow: hidden;
  }
  .tab-content-wrapper.hidden {
    display: none;
  }
</style>
