<script lang="ts">
  import { onMount, tick } from 'svelte';
  import ChatMessageNavigator from '../ChatMessageNavigator.svelte';

  interface Props {
    theme?: 'light' | 'dark';
    width?: number;
    zoom?: number;
  }

  let { theme = 'light', width = 720, zoom = 1 }: Props = $props();
  let transcript: HTMLDivElement | null = $state(null);
  let materialized = $state(false);
  let selectedId = $state('');
  let isAtBottom = $state(false);
  const messages = [
    { id: 'first', text: 'Review the initial implementation plan' },
    { id: 'virtual-target', text: 'Find the virtualized restored history message' },
    {
      id: 'last',
      text: 'This long user message must truncate to one line without changing the dropdown width',
    },
  ];

  function updateBottomState() {
    if (!transcript) return;
    isAtBottom = transcript.scrollHeight - transcript.clientHeight - transcript.scrollTop <= 1;
  }

  function scrollToBottom() {
    if (!transcript) return;
    transcript.scrollTop = transcript.scrollHeight;
    updateBottomState();
  }

  async function selectMessage(messageId: string): Promise<boolean> {
    if (messageId === 'virtual-target') materialized = true;
    await tick();
    return new Promise((resolve) => {
      requestAnimationFrame(() => {
        const target = transcript?.querySelector<HTMLElement>(`[data-message-id="${messageId}"]`);
        if (!target || !transcript) {
          resolve(false);
          return;
        }
        const transcriptRect = transcript.getBoundingClientRect();
        const targetRect = target.getBoundingClientRect();
        transcript.scrollTop += targetRect.top - transcriptRect.top;
        target.classList.add('message-highlight-flash');
        selectedId = messageId;
        updateBottomState();
        resolve(true);
      });
    });
  }

  onMount(() => requestAnimationFrame(updateBottomState));
</script>

<section
  class:dark={theme === 'dark'}
  class="relative overflow-visible bg-sidebar text-foreground"
  style:width="{width}px"
  style:zoom
  data-testid="chat-navigation-host"
>
  <header
    class="flex h-12 min-w-0 items-center gap-2 border-b border-border bg-card px-4 sm:px-6"
    data-testid="chat-navigation-header"
  >
    <span class="size-5 shrink-0 rounded-full bg-muted" aria-hidden="true"></span>
    <span class="min-w-0 flex-1 truncate text-sm font-medium" data-testid="chat-header-title">
      A long agent title that yields to stable header actions
    </span>
    <div class="flex shrink-0 items-center gap-0.5" data-testid="chat-header-actions">
      <ChatMessageNavigator
        {messages}
        {isAtBottom}
        onSelectMessage={selectMessage}
        onScrollToBottom={scrollToBottom}
      />
      <button type="button" class="size-7" data-testid="chat-header-kebab" aria-label="More">
        ···
      </button>
      <button type="button" class="size-7" data-testid="chat-header-close" aria-label="Close">
        ×
      </button>
    </div>
  </header>
  <div
    bind:this={transcript}
    class="h-80 overflow-y-auto bg-card"
    data-testid="chat-navigation-transcript"
    onscroll={updateBottomState}
  >
    <div class="h-[420px] p-4" data-message-id="first">First prompt</div>
    {#if materialized}
      <div
        class="h-12 scroll-mt-0 p-4"
        data-message-id="virtual-target"
        data-testid="virtualized-message"
      >
        Virtualized restored history message
      </div>
    {:else}
      <div class="h-12" data-testid="virtualized-placeholder"></div>
    {/if}
    <div class="h-[420px] p-4" data-message-id="last">Last prompt</div>
    <div class="h-6" data-testid="chat-final-spacer"></div>
  </div>
  <output class="sr-only" data-testid="chat-selected-message">{selectedId}</output>
  <output class="sr-only" data-testid="chat-bottom-state">{isAtBottom}</output>
</section>

<style>
  :global(.message-highlight-flash) {
    animation: message-flash 0.6s ease-out;
  }

  @keyframes message-flash {
    from {
      background: hsl(var(--accent) / 0.3);
    }
    to {
      background: transparent;
    }
  }
</style>
