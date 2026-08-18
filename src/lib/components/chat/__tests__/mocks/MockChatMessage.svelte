<script lang="ts">
  /**
   * Minimal ChatMessage stand-in: exposes the `onEditSubmit` callback as a
   * button so tests can drive the edit-and-regenerate flow without the real
   * ChatMessage dependency tree.
   */
  let {
    messageId = '',
    onEditSubmit,
  }: {
    messageId?: string;
    onEditSubmit?: (newText: string, model?: string, blocks?: unknown) => void;
    [key: string]: unknown;
  } = $props();
</script>

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
