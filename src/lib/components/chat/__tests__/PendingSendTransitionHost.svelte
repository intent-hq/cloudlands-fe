<script lang="ts">
  // Mirrors ChatPanel's pending-send wiring: prepare registers a pending
  // transition before the transcript row exists; the row is appended later
  // (or never, for the expiry path); onDestroy cancels everything.
  import { onDestroy } from 'svelte';
  import {
    captureMessageSendOrigin,
    createMessageSendLaunchBubble,
  } from '../message-send-transition';
  import { createPendingSendTransitions } from '../pending-send-transitions';
  import { USER_MESSAGE_SURFACE_CLASS, USER_MESSAGE_TEXT_CLASS } from '../user-message-surface';

  interface Props {
    panelId: string;
    text?: string;
  }

  let { panelId, text = 'A message sent from the composer' }: Props = $props();
  let scrollContainer = $state<HTMLDivElement>();
  let composer: HTMLDivElement;
  let messages = $state<Array<{ id: string; text: string }>>([]);
  let sendCount = 0;
  let lastKey = '';

  let pendingSendMessageIds = $state.raw<Set<string>>(new Set());

  const sendTransitions = createPendingSendTransitions({
    getScrollContainer: () => scrollContainer,
    setRowHidden: (key, hidden) => {
      const next = new Set(pendingSendMessageIds);
      if (hidden) next.add(key);
      else next.delete(key);
      pendingSendMessageIds = next;
    },
  });

  onDestroy(() => sendTransitions.cancelAll());

  function prepare(): void {
    lastKey = `${panelId}-${sendCount++}`;
    const origin = captureMessageSendOrigin(composer);
    sendTransitions.add(lastKey, {
      origin,
      launchBubble: createMessageSendLaunchBubble(origin, text, panelId),
      followBottom: true,
    });
  }

  function appendRow(): void {
    messages = [...messages, { id: lastKey, text }];
  }
</script>

<div data-testid="send-transition-host" data-panel-id={panelId}>
  <div
    bind:this={scrollContainer}
    class="h-64 overflow-y-auto bg-background p-3 text-foreground"
    data-testid="send-scroll"
  >
    {#each messages as message (message.id)}
      <div
        class="mb-4"
        data-send-app-message-id={message.id}
        class:invisible={pendingSendMessageIds.has(message.id)}
      >
        <div class={USER_MESSAGE_SURFACE_CLASS} data-testid="user-message-surface">
          <span class={USER_MESSAGE_TEXT_CLASS}>{message.text}</span>
        </div>
      </div>
    {/each}
  </div>
  <div bind:this={composer} class="bg-background p-3" data-testid="send-composer">
    <div class="min-h-12 rounded-lg border border-border px-3 py-2" data-testid="message-input">
      {text}
    </div>
    <button type="button" onclick={prepare} data-testid="prepare-button">Prepare</button>
    <button type="button" onclick={appendRow} data-testid="append-row-button">Append row</button>
  </div>
</div>
