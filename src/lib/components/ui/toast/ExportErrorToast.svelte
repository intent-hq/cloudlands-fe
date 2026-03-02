<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import OpenComboButton from '$lib/components/ui/OpenComboButton.svelte';
  import Fa from 'svelte-fa';
  import { faExclamationCircle } from '@fortawesome/free-solid-svg-icons';

  interface Props {
    message: string;
    exportPath: string;
  }

  let { message, exportPath }: Props = $props();

  const dispatch = createEventDispatcher();

  function handleDismiss() {
    dispatch('closeToast');
  }
</script>

<div
  class="flex items-start gap-3 p-4 bg-card border border-destructive/50 shadow-lg min-w-[360px] max-w-[500px]"
>
  <!-- Error icon -->
  <div class="flex-shrink-0 mt-0.5 text-destructive-foreground">
    <Fa icon={faExclamationCircle} class="w-5 h-5" />
  </div>

  <!-- Message -->
  <div class="flex-1 min-w-0">
    <p class="text-sm font-medium text-foreground">Export failed</p>
    <p class="text-xs text-subtle mt-0.5">{message}</p>
  </div>

  <!-- Open Combo Button -->
  <OpenComboButton filePath={exportPath} isDirectory={true} usePortal={false} side="top" />

  <!-- Close button -->
  <button
    type="button"
    class="flex-shrink-0 p-1 text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
    onclick={handleDismiss}
    aria-label="Close"
  >
    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"
      ></path>
    </svg>
  </button>
</div>
