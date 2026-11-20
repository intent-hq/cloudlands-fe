<script lang="ts">
  import { sharedTimeManager } from '$lib/utils/shared-time-manager.svelte';
  import { formatElapsedClock } from '$features/voice/utils/format-elapsed-clock';
  import DictationWaveform from './DictationWaveform.svelte';

  /**
   * Live dictation readout shared by every voice surface: elapsed time, then level bars.
   * Pass `elapsed` when the caller already ticks a clock, else `startedAt` (epoch ms).
   */
  let {
    levels,
    startedAt = null,
    elapsed,
  }: { levels: readonly number[]; startedAt?: number | null; elapsed?: string } = $props();

  let now = $state(Date.now());
  $effect(() => {
    if (elapsed !== undefined || startedAt === null) return;
    now = Date.now();
    return sharedTimeManager.subscribe(new Date(startedAt), () => (now = Date.now()), 'second');
  });
  const time = $derived(elapsed ?? formatElapsedClock(startedAt === null ? 0 : now - startedAt));
</script>

<span class="dictation-meter">
  <span class="elapsed" data-dictation-elapsed>{time}</span>
  <DictationWaveform {levels} />
</span>

<style>
  .dictation-meter {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .elapsed {
    font-variant-numeric: tabular-nums;
    line-height: 1;
    white-space: nowrap;
  }
</style>
