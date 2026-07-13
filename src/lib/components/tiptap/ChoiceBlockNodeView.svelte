<script lang="ts">
  /**
   * ChoiceBlock NodeView Component
   *
   * Renders a choice block container with:
   * - Hover-activated delete button in top-right corner
   * - Editable content (question and options via NodeViewContent)
   *
   * Uses the svelte-tiptap style SvelteNodeViewRenderer where NodeViewProps
   * are passed directly as reactive props via $props().
   */
  import type { NodeViewProps } from '@tiptap/core';
  import {
  NodeViewWrapper,
  NodeViewContent,
} from '$lib/utils/tiptap/svelte-node-view';

  // Props are passed directly from SvelteNodeViewRenderer and are reactive via $state
  let { deleteNode }: NodeViewProps = $props();

  let isHovered = $state(false);

  /**
   * Delete the entire choice block
   */
  function handleDelete() {
    deleteNode();
  }

  /**
   * Handle keyboard events for delete button
   */
  function handleKeyDown(event: KeyboardEvent) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      handleDelete();
    }
  }
</script>

<NodeViewWrapper
  as="div"
  class="choice-block-wrapper relative my-4 p-4 border border-muted rounded-lg bg-muted/30 group flex flex-col"
  data-type="choice-block"
  onmouseenter={() => (isHovered = true)}
  onmouseleave={() => (isHovered = false)}
>
  <!-- Delete button - only visible on hover -->
  {#if isHovered}
    <button
      class="absolute top-2 right-2 p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive-foreground transition-colors"
      onclick={handleDelete}
      onkeydown={handleKeyDown}
      aria-label="Delete choice block"
      title="Delete choice block"
      type="button"
    >
      <!-- X icon -->
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <line x1="18" y1="6" x2="6" y2="18"></line>
        <line x1="6" y1="6" x2="18" y2="18"></line>
      </svg>
    </button>
  {/if}

  <!-- Editable content (question and options) -->
  <NodeViewContent />
</NodeViewWrapper>
