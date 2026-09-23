<script lang="ts">
  /**
   * Minimal ChatMessage stand-in: exposes the `onEditSubmit` callback as a
   * button so tests can drive the edit-and-regenerate flow without the real
   * ChatMessage dependency tree.
   */
  let {
    messageId = '',
    onEditSubmit,
    onRegenerate,
    isStreaming = false,
    isLastConversationMessage = false,
  }: {
    messageId?: string;
    onEditSubmit?: (newText: string, model?: string, blocks?: unknown) => void;
    onRegenerate?: () => void;
    isStreaming?: boolean;
    isLastConversationMessage?: boolean;
    [key: string]: unknown;
  } = $props();
</script>

<span
  data-testid="mock-message-presentation"
  data-message-key={messageId}
  data-streaming={isStreaming}
  data-last-assistant={isLastConversationMessage}
  data-regeneratable={Boolean(onRegenerate)}
></span>

{#if onEditSubmit}
  <button
    type="button"
    data-testid="mock-edit-submit"
    data-message-id={messageId}
    onclick={() => onEditSubmit?.('edited text')}
  >
    edit-submit
  </button>
{/if}
