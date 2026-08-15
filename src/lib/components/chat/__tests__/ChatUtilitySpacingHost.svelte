<script lang="ts">
  import QueuedMessageList from '../QueuedMessageList.svelte';
  import type { QueuedMessage } from '$shared/types';

  interface Props {
    queueCount?: number;
    compact?: boolean;
    expanded?: boolean;
    streaming?: boolean;
    actionsVisible?: boolean;
    theme?: 'light' | 'dark';
  }

  let {
    queueCount = 0,
    compact = false,
    expanded = false,
    streaming = false,
    actionsVisible = false,
    theme = 'light',
  }: Props = $props();
  const messages = $derived.by((): QueuedMessage[] =>
    Array.from({ length: queueCount }, (_, position) => ({
      id: `queued-${position}`,
      content: `Queued message ${position + 1}`,
      queuedAt: '2026-08-15T00:00:00.000Z',
      position,
    })),
  );
</script>

<div class="{theme} bg-background p-3 text-foreground" data-testid="utility-host">
  <div
    class="flex min-h-96 w-full flex-col {compact ? 'pb-3' : 'pb-2'}"
    data-testid="utility-column"
    data-streaming={streaming}
  >
    <div class="h-12" data-testid="transcript-tail">Transcript tail</div>
    <div class="mt-auto" data-testid="transcript-utility-stack">
      <div class="w-full {compact ? 'mt-6' : 'mt-8'}" data-testid="subscription-utility-area">
        <section class="overflow-hidden rounded-lg border border-border/60 bg-card/80 shadow-sm">
          <button
            type="button"
            class="w-full px-3 py-2 text-left"
            data-testid="subscription-summary"
          >
            Event subscriptions
          </button>
          {#if expanded}
            <div class="border-t border-border/40 px-3 py-2" data-testid="subscription-body">
              Expanded subscription details
            </div>
          {/if}
        </section>
      </div>
      {#if queueCount > 0}
        <div class="mt-6 {actionsVisible ? 'group' : ''}" data-testid="queued-message-utility-area">
          <QueuedMessageList {messages} disabled={streaming} />
        </div>
      {/if}
    </div>
    <div class="min-h-px" data-testid="scroll-anchor"></div>
  </div>
</div>
