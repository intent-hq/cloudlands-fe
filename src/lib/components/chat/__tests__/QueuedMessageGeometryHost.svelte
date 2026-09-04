<script lang="ts">
  import QueuedMessageList from '../QueuedMessageList.svelte';
  import { CHAT_TRANSCRIPT_OVERFLOW_CLASS } from '../chat-queue-edge-layout';

  interface Props {
    width?: number;
    contentWidth?: number;
    zoom?: number;
    messageCount?: number;
    scrollViewport?: boolean;
    alignWithPrompt?: boolean;
  }

  let {
    width = 240,
    contentWidth = width,
    zoom = 1,
    messageCount = 1,
    scrollViewport = false,
    alignWithPrompt = false,
  }: Props = $props();
  let lastAction = $state('none');
  const messages = $derived(
    Array.from({ length: messageCount }, (_, i) => ({
      id: `queued-geometry-${i}`,
      content:
        i === 0
          ? 'A long queued message must keep exactly the same height when actions appear'
          : `Message ${i + 1}`,
      queuedAt: '2026-01-01T00:00:00.000Z',
      position: i,
    })),
  );
</script>

{#snippet contentColumn()}
  <div class="mx-auto" style:width="{contentWidth}px" data-testid="queued-message-content-column">
    <QueuedMessageList
      {messages}
      onsendnow={(id) => (lastAction = `send:${id}`)}
      onremove={(id) => (lastAction = `remove:${id}`)}
      onedit={async (id, _content, editing) => {
        lastAction = `${editing ? 'edit' : 'save'}:${id}`;
        return { success: true };
      }}
    />
  </div>
{/snippet}

<div
  data-testid="queued-message-geometry-host"
  style="width: {width}px; zoom: {zoom}; container-type: inline-size;"
>
  {#if alignWithPrompt}
    <div class="px-4 sm:px-6" data-testid="queued-message-transcript-lane">
      <div class="relative z-20 mt-6 w-full" data-testid="queued-message-utility-area">
        <QueuedMessageList
          {messages}
          onsendnow={(id) => (lastAction = `send:${id}`)}
          onremove={(id) => (lastAction = `remove:${id}`)}
          onedit={async (id, _content, editing) => {
            lastAction = `${editing ? 'edit' : 'save'}:${id}`;
            return { success: true };
          }}
        />
      </div>
    </div>
    <div class="px-4 sm:px-6">
      <div class="h-px w-full" data-testid="queued-message-prompt-bounds"></div>
    </div>
  {:else if scrollViewport}
    <!-- Mirrors the ChatPanel transcript scroll viewport contract. -->
    <div
      class="max-h-80 {CHAT_TRANSCRIPT_OVERFLOW_CLASS}"
      style="scrollbar-gutter: stable;"
      data-testid="queued-message-scroll-viewport"
    >
      {@render contentColumn()}
    </div>
  {:else}
    {@render contentColumn()}
  {/if}
  <output hidden data-testid="queued-message-last-action">{lastAction}</output>
</div>
