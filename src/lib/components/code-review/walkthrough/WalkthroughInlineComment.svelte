<script lang="ts">
  /**
   * WalkthroughInlineComment
   *
   * A minimal inline comment input for asking questions about code.
   */
  import Fa from 'svelte-fa';
  import { faArrowRight, faSpinner } from '@fortawesome/free-solid-svg-icons';

  interface Props {
    /** Line number for the comment */
    lineNumber?: number;
    /** File path */
    fileName?: string;
    /** Callback when sending a message */
    onSend?: (message: string, lineNumber: number, fileName: string) => void;
    /** Callback to close the comment input */
    onClose?: () => void;
    /** Whether sending is in progress */
    isSending?: boolean;
    class?: string;
  }

  let {
    lineNumber = 0,
    fileName = '',
    onSend,
    onClose,
    isSending = false,
    class: className = '',
  }: Props = $props();

  let message = $state('');
  let inputElement = $state<HTMLInputElement | null>(null);

  // Auto-focus on mount
  $effect(() => {
    if (inputElement) {
      inputElement.focus();
    }
  });

  function handleSend() {
    if (!message.trim() || isSending) return;
    onSend?.(message.trim(), lineNumber, fileName);
    message = '';
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
    if (e.key === 'Escape') {
      onClose?.();
    }
  }
</script>

<div class="walkthrough-inline-comment flex items-center gap-2 {className}">
  <input
    bind:this={inputElement}
    bind:value={message}
    onkeydown={handleKeydown}
    placeholder="Ask about this line..."
    disabled={isSending}
    class="flex-1 h-8 rounded-md border border-border bg-background px-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/30 focus:border-primary/50 disabled:opacity-50"
  />
  <button
    type="button"
    onclick={handleSend}
    disabled={!message.trim() || isSending}
    class="h-8 w-8 flex items-center justify-center rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
  >
    {#if isSending}
      <Fa icon={faSpinner} class="h-3.5 w-3.5 animate-spin" />
    {:else}
      <Fa icon={faArrowRight} class="h-3.5 w-3.5" />
    {/if}
  </button>
  <button
    type="button"
    onclick={() => onClose?.()}
    class="h-8 px-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
  >
    Cancel
  </button>
</div>
<p class="text-ui text-subtle mt-1">Enter to send · Esc to cancel</p>
