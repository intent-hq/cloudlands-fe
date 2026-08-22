<script lang="ts">
  import ChatOperationalRow from '../ChatOperationalRow.svelte';
  import StreamingStatus from '../StreamingStatus.svelte';

  interface Props {
    theme?: 'light' | 'dark';
    width?: number;
    zoom?: number;
    mode?: 'processing' | 'streaming' | 'idle' | 'permission' | 'error';
    phaseMessage?: string | null;
  }

  let {
    theme = 'light',
    width = 720,
    zoom = 1,
    mode = 'processing',
    phaseMessage = 'Sent prompt…',
  }: Props = $props();

  let statusEvents = $derived(
    phaseMessage === null
      ? []
      : [{ phase: 'prompt', message: phaseMessage, level: 'info' as const, timestamp: 1000 }],
  );
</script>

{#snippet leading()}
  <span class="block size-4" data-testid="fixture-tool-icon"></span>
{/snippet}

{#snippet beforeSummary()}
  <span>Read the current file</span>
{/snippet}

{#snippet afterSummary()}
  <span>Run the focused verification</span>
{/snippet}

<section
  class:dark={theme === 'dark'}
  class="bg-background text-foreground"
  style:width="{width}px"
  style:zoom
  data-testid="streaming-typing-operational-host"
>
  <div class="flex min-w-0 flex-col" data-testid="streaming-typing-operational-stack">
    <ChatOperationalRow
      {leading}
      summary={beforeSummary}
      showChevron={false}
      testId="streaming-tool-before"
    />
    <div data-testid="live-streaming-status">
      <StreamingStatus
        isProcessing={mode === 'processing'}
        isStreaming={mode === 'streaming'}
        hasPendingPermission={mode === 'permission'}
        error={mode === 'error' ? 'Provider stopped the response' : null}
        seed="geometry-agent"
        {statusEvents}
      />
    </div>
    <ChatOperationalRow
      {leading}
      summary={afterSummary}
      showChevron={false}
      testId="streaming-tool-after"
    />
  </div>
</section>
