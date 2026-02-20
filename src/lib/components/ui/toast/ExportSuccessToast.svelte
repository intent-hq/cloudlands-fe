<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import OpenComboButton from '$lib/components/ui/OpenComboButton.svelte';
  import Fa from 'svelte-fa';
  import { faCheck } from '@fortawesome/free-solid-svg-icons';

  interface Props {
    exportPath: string;
  }

  let { exportPath }: Props = $props();

  const dispatch = createEventDispatcher();

  function handleDismiss() {
    dispatch('closeToast');
  }
</script>

<div class="flex items-center gap-3 p-4 bg-card border border-border shadow-lg min-w-[360px]">
  <!-- Success icon -->
  <div class="flex-shrink-0 text-green-500">
    <Fa icon={faCheck} class="w-5 h-5" />
  </div>

  <!-- Message -->
  <div class="flex-1 min-w-0">
    <p class="text-sm font-medium text-foreground">Files exported successfully</p>
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
