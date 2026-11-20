<script lang="ts">
  import type { ButtonProps } from '$lib/components/ui/button';
  import { Button } from '$lib/components/ui/button';
  import Fa from '$lib/components/shared/icons/FaWrapper.svelte';
  import { faStop } from '$lib/icons/phosphor-icons';
  import {
    selectPttInputLevels,
    selectPttRecordingStartedAt,
  } from '$store/renderer/slices/hardware-console/hardware-console-selectors';
  import DictationMeter from './DictationMeter.svelte';

  /**
   * A live push-to-talk mic button: one capture-colored pill (stop, elapsed time, level
   * bars) that stops the recording on click. Matches the dock's live mic and record pills.
   */
  let { class: className = '', ...rest }: ButtonProps = $props();

  const levels$ = selectPttInputLevels();
  const startedAt$ = selectPttRecordingStartedAt();
</script>

<Button
  variant="ghost"
  size="sm"
  class={`dictation-stop-pill ${className}`.trim()}
  aria-pressed="true"
  {...rest}
>
  <Fa icon={faStop} size="xs" />
  <DictationMeter levels={$levels$} startedAt={$startedAt$} />
</Button>

<style>
  :global(.dictation-stop-pill) {
    gap: 6px;
    padding-inline: 8px 10px;
    border-radius: 999px;
    background: hsl(var(--capture-active));
    color: hsl(var(--capture-active-foreground));
    font-variant-numeric: tabular-nums;
  }
  :global(.dictation-stop-pill:hover) {
    background: hsl(var(--capture-active) / 0.9);
    color: hsl(var(--capture-active-foreground));
  }
</style>
