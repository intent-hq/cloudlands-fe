<script lang="ts">
  import StreamingStatus from '../StreamingStatus.svelte';

  interface Props {
    theme?: 'light' | 'dark';
    width?: number;
    zoom?: number;
    preceding?: 'assistant' | 'event' | 'none';
    longError?: boolean;
    failedAt?: boolean;
    resetKey?: number;
  }

  let {
    theme = 'light',
    width = 720,
    zoom = 1,
    preceding = 'assistant',
    longError = false,
    failedAt = false,
    resetKey = 0,
  }: Props = $props();
  let retryCount = $state(0);
  const error = $derived(
    longError
      ? `JSON-RPC error -32603: ${'unbroken-provider-payload-'.repeat(24)}`
      : 'Provider stopped the response',
  );
</script>

<section
  class:dark={theme === 'dark'}
  class="bg-background text-foreground"
  style:width="{width}px"
  style:zoom
  data-testid="failed-response-geometry-host"
  data-retry-count={retryCount}
>
  <div class="flex min-w-0 flex-col" data-testid="failed-response-transcript">
    {#if preceding === 'assistant'}
      <div class="type-body min-w-0" data-testid="preceding-surface">
        Ordinary assistant response content
      </div>
    {:else if preceding === 'event'}
      <div
        class="type-caption min-w-0 rounded-md border border-border bg-card px-2 py-1"
        data-testid="preceding-surface"
      >
        Background event attribution
      </div>
    {/if}
    <div class="mb-16 min-w-0" data-testid="failed-response-wrapper">
      {#key resetKey}
        <StreamingStatus
          {error}
          failedAt={failedAt ? '2026-08-21T12:00:00.000Z' : null}
          onRetry={() => (retryCount += 1)}
          class={preceding === 'none' ? 'mt-0' : undefined}
        />
      {/key}
    </div>
    <div class="h-px" data-testid="following-surface"></div>
  </div>
</section>
