<script lang="ts">
  /**
   * Small HUD shown when a cycle action key steps the agent walk. Purely
   * presentational: the global-cycle runner dispatches `actionHudShown`
   * with the action's localized label; the action-key middleware hides it
   * after press inactivity. Same visual/placement as EncoderCycleHud —
   * mounted after it in the layout so it paints on top when both show.
   */
  import { fade } from 'svelte/transition';
  import { selectActionHudLabel } from '$store/renderer/slices/hardware-console/hardware-console-selectors';

  const label$ = selectActionHudLabel();
</script>

{#if $label$ !== null}
  <div
    class="fixed bottom-8 left-1/2 -translate-x-1/2 z-50 pointer-events-none"
    transition:fade={{ duration: 120 }}
    role="status"
  >
    <div
      class="bg-background border border-border shadow-lg rounded-lg px-4 py-2 text-[13px] font-medium text-foreground max-w-96 truncate"
    >
      {$label$}
    </div>
  </div>
{/if}
