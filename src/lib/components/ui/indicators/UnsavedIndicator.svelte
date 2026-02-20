<script lang="ts">
  import { fade } from 'svelte/transition';

  /**
   * UnsavedIndicator - Visual indicator for unsaved changes
   * Shows a yellow dot with smooth fade in/out animations
   */

  interface Props {
    visible?: boolean;
    class?: string;
  }

  let { visible = false, class: className = '' }: Props = $props();
</script>

{#if visible}
  <div
    class="flex items-center justify-center shrink-0 {className}"
    transition:fade={{ duration: 200 }}
    aria-label="Unsaved changes"
    title="Unsaved changes"
  >
    <div class="w-1 h-1 rounded-full bg-yellow-500 animate-pulse motion-reduce:animate-none"></div>
  </div>
{/if}
