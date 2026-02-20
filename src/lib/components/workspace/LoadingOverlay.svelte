<script lang="ts">
  /**
   * Loading Overlay Component
   * Shows a subtle loading indicator with optional message
   */

  import { fade } from 'svelte/transition';
  import { Fa } from 'svelte-fa';
  import { faSpinner } from '@fortawesome/free-solid-svg-icons';

  interface Props {
    loading?: boolean;
    message?: string;
    fullscreen?: boolean;
    subtle?: boolean;
  }

  let {
    loading = false,
    message = 'Loading...',
    fullscreen = false,
    subtle = false,
  }: Props = $props();
</script>

{#if loading}
  <div
    class="{fullscreen ? 'fixed inset-0' : 'absolute inset-0'}
           {subtle ? 'bg-background/50' : 'bg-background/80'}
           backdrop-blur-sm z-50 flex items-center justify-center pointer-events-auto"
    transition:fade={{ duration: 200 }}
  >
    <div class="flex flex-col items-center gap-3">
      <Fa icon={faSpinner} class="text-2xl text-muted-foreground animate-spin" />
      {#if message && !subtle}
        <p class="text-sm text-muted-foreground">
          {message}
        </p>
      {/if}
    </div>
  </div>
{/if}
