<script lang="ts">
  /**
   * Small HUD shown when a cycle action key steps the agent walk, and while
   * a push-to-talk recording is in progress ("Listening…", which outranks
   * the label and never times out — it clears on release). Purely
   * presentational: the global-cycle runner dispatches `actionHudShown`
   * with the action's localized label; the action-key middleware hides it
   * after press inactivity. Same visual/placement as EncoderCycleHud —
   * mounted after it in the layout so it paints on top when both show.
   * Sits at z-70 so it stays visible above modal overlays (z-60).
   */
  import { fade } from 'svelte/transition';
  import { m } from '$shared/paraglide/messages.js';
  import {
    selectActionHudLabel,
    selectPttRecording,
  } from '$store/renderer/slices/hardware-console/hardware-console-selectors';

  const label$ = selectActionHudLabel();
  const recording$ = selectPttRecording();

  const text = $derived($recording$ ? m.hardwareConsole_ptt_listening_label() : $label$);
</script>

{#if text !== null}
  <div
    class="fixed bottom-8 left-1/2 -translate-x-1/2 z-70 pointer-events-none"
    transition:fade={{ duration: 120 }}
    role="status"
  >
    <div
      class="bg-background border border-border shadow-lg rounded-lg px-4 py-2 text-[13px] font-medium text-foreground max-w-96 truncate"
    >
      {text}
    </div>
  </div>
{/if}
