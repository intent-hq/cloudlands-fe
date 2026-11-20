<script lang="ts">
  /**
   * Small HUD shown when a cycle action key steps the agent walk, and while
   * the hardware voice key records (elapsed time and live level bars, which
   * outrank the label and never time out — they clear on release). A mic
   * button's own recording shows on that button instead. Purely
   * presentational: the global-cycle runner dispatches `actionHudShown`
   * with the action's localized label; the action-key middleware hides it
   * after press inactivity. Same visual/placement as EncoderCycleHud —
   * mounted after it in the layout so it paints on top when both show.
   * Sits at z-70 so it stays visible above modal overlays (z-60).
   */
  import { fade } from '$lib/motion';
  import { m } from '$shared/paraglide/messages.js';
  import DictationMeter from '$features/voice/components/DictationMeter.svelte';
  import {
    selectActionHudLabel,
    selectPttInputLevels,
    selectPttKeyRecording,
    selectPttRecordingStartedAt,
  } from '$store/renderer/slices/hardware-console/hardware-console-selectors';

  const label$ = selectActionHudLabel();
  const recording$ = selectPttKeyRecording();
  const levels$ = selectPttInputLevels();
  const startedAt$ = selectPttRecordingStartedAt();
</script>

{#if $recording$ || $label$ !== null}
  <div
    class="fixed bottom-8 left-1/2 -translate-x-1/2 z-70 pointer-events-none"
    transition:fade={{ tier: 'moderate' }}
    role="status"
  >
    <div
      class="type-caption bg-background border border-border shadow-lg rounded-lg px-4 py-2 font-medium text-foreground max-w-96 truncate"
    >
      {#if $recording$}
        <span class="sr-only">{m.hardwareConsole_ptt_listening_label()}</span>
        <span class="live-meter">
          <DictationMeter levels={$levels$} startedAt={$startedAt$} />
        </span>
      {:else}
        {$label$}
      {/if}
    </div>
  </div>
{/if}

<style>
  .live-meter {
    display: flex;
    align-items: center;
  }
  .live-meter :global([data-dictation-waveform]) {
    color: hsl(var(--capture-active));
  }
</style>
