<script lang="ts">
  import { DICTATION_BAR_COUNT } from '$features/voice/utils/spectrum-bands';

  /** Live microphone level bars; the newest {@link DICTATION_BAR_COUNT} levels, 0–1 each. */
  let { levels }: { levels: readonly number[] } = $props();

  const bars = $derived.by(() => {
    const recent = levels
      .slice(-DICTATION_BAR_COUNT)
      .map((level) => (Number.isFinite(level) ? Math.min(1, Math.max(0, level)) : 0));
    return [...new Array<number>(DICTATION_BAR_COUNT - recent.length).fill(0), ...recent];
  });
</script>

<span class="waveform" aria-hidden="true" data-dictation-waveform>
  {#each bars as level, index (index)}
    <span data-level={level} style:height={`${2 + level * 12}px`}></span>
  {/each}
</span>

<style>
  .waveform {
    display: inline-flex;
    flex: none;
    align-items: center;
    gap: 2px;
    height: 14px;
  }
  .waveform span {
    width: 2px;
    border-radius: 1px;
    background: currentColor;
    transition: height var(--spring-fast) var(--spring-fast-ease);
  }
  @container style(--motion-reduced: 1) {
    .waveform span {
      transition: none;
    }
  }
</style>
