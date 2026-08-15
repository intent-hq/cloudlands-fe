<script lang="ts">
  import { tick } from 'svelte';
  import {
    animateMessageSend,
    captureMessageSendOrigin,
    createMessageSendLaunchBubble,
    type MessageSendOrigin,
  } from '../message-send-transition';
  import { USER_MESSAGE_SURFACE_CLASS, USER_MESSAGE_TEXT_CLASS } from '../user-message-surface';

  interface Props {
    panelId: string;
    text?: string;
    followBottom?: boolean;
    rapidCount?: number;
    responseStart?: boolean;
    theme?: 'light' | 'dark';
  }

  let {
    panelId,
    text = 'A message sent from the composer',
    followBottom = true,
    rapidCount = 1,
    responseStart = false,
    theme = 'light',
  }: Props = $props();
  let scrollContainer: HTMLDivElement;
  let composer: HTMLDivElement;
  let messages = $state<Array<{ id: string; text: string }>>([]);
  let responseVisible = $state(false);
  let settledCount = $state(0);

  interface PreparedSend {
    id: string;
    origin: MessageSendOrigin;
    launchBubble: HTMLElement | null;
  }

  async function send(): Promise<void> {
    const prepared: PreparedSend[] = [];
    for (let index = 0; index < rapidCount; index++) {
      const id = `${panelId}-${messages.length + index}`;
      const origin = captureMessageSendOrigin(composer);
      prepared.push({
        id,
        origin,
        launchBubble: createMessageSendLaunchBubble(origin, `${text} ${index + 1}`, panelId),
      });
    }
    messages = [
      ...messages,
      ...prepared.map(({ id }, index) => ({ id, text: `${text} ${index + 1}` })),
    ];
    if (responseStart) responseVisible = true;
    await tick();
    await Promise.all(
      prepared.map(async ({ id, origin, launchBubble }) => {
        const target = scrollContainer.querySelector<HTMLElement>(`[data-send-target="${id}"]`);
        if (!target) return;
        await animateMessageSend({
          origin,
          target,
          scrollContainer,
          launchBubble,
          followBottom,
        });
        settledCount += 1;
      }),
    );
  }
</script>

<div class={theme} data-testid="send-transition-host" data-panel-id={panelId}>
  <div
    bind:this={scrollContainer}
    class="h-64 overflow-y-auto bg-background p-3 text-foreground"
    data-testid="send-scroll"
  >
    <div class="h-80" aria-hidden="true"></div>
    {#each messages as message (message.id)}
      <div class="mb-4" data-send-row={message.id}>
        <div
          class={USER_MESSAGE_SURFACE_CLASS}
          data-send-target={message.id}
          data-testid="send-target"
        >
          <span class={USER_MESSAGE_TEXT_CLASS}>{message.text}</span>
        </div>
      </div>
    {/each}
    {#if responseVisible}
      <div class="h-12" data-testid="response-start">Response started</div>
    {/if}
  </div>
  <div bind:this={composer} class="bg-background p-3" data-testid="send-composer">
    <div class="min-h-12 rounded-lg border border-border px-3 py-2" data-testid="message-input">
      {text}
    </div>
    <button type="button" onclick={send} data-testid="send-button">Send</button>
  </div>
  <output data-testid="settled-count">{settledCount}</output>
</div>
