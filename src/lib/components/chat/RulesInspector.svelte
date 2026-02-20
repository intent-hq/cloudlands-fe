<script lang="ts">
  import { faXmark } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import Button from '$lib/components/ui/button/button.svelte';

  interface Props {
    rules: string | null;
    onClose: () => void;
  }

  let { rules, onClose }: Props = $props();

  function handleBackdropClick(event: MouseEvent) {
    if (event.target === event.currentTarget) {
      onClose();
    }
  }

  function handleBackdropKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.stopPropagation();
      onClose();
    }
  }
</script>

<div
  class="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
  role="dialog"
  aria-modal="true"
  aria-labelledby="rules-inspector-title"
  tabindex="-1"
  onclick={handleBackdropClick}
  onkeydown={handleBackdropKeydown}
>
  <div
    class="relative max-w-3xl w-full max-h-[80vh] bg-background border border-border rounded-lg shadow-xl overflow-hidden"
  >
    <div class="flex items-center justify-between px-6 py-4 border-b border-border">
      <h2 id="rules-inspector-title" class="text-lg font-semibold text-foreground">
        Applied Agent Rules
      </h2>
      <Button variant="ghost" size="icon-sm" onclick={onClose}>
        <Fa icon={faXmark} />
      </Button>
    </div>

    <div class="px-6 py-4 overflow-y-auto max-h-[calc(80vh-4rem)]">
      {#if rules}
        <div class="prose prose-sm dark:prose-invert max-w-none">
          <pre
            class="whitespace-pre-wrap font-mono text-xs bg-muted/50 p-4 rounded-md">{rules}</pre>
        </div>
      {:else}
        <p class="text-muted-foreground">No custom rules were applied to this agent.</p>
      {/if}
    </div>
  </div>
</div>
