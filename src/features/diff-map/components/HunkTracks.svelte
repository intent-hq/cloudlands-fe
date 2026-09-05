<script lang="ts">
  interface Props {
    oldTrack?: number[];
    newTrack?: number[];
  }

  let { oldTrack, newTrack }: Props = $props();

  function segments(track: number[] | undefined) {
    if (!track) return [];
    const result: Array<{ position: number; size: number }> = [];
    for (let index = 0; index + 1 < track.length; index += 2) {
      result.push({
        position: Math.min(1, Math.max(0, track[index])),
        size: Math.min(1, Math.max(0.015, track[index + 1])),
      });
    }
    return result;
  }
</script>

<span class="hunk-tracks" aria-hidden="true">
  <span class="track-label track-label--old">−</span>
  <span class="track track--old">
    {#each segments(oldTrack) as segment, index (index)}
      <span
        class="segment"
        style:left={`${segment.position * 100}%`}
        style:width={`${segment.size * 100}%`}
      ></span>
    {/each}
  </span>
  <span class="track-label track-label--new">+</span>
  <span class="track track--new">
    {#each segments(newTrack) as segment, index (index)}
      <span
        class="segment"
        style:left={`${segment.position * 100}%`}
        style:width={`${segment.size * 100}%`}
      ></span>
    {/each}
  </span>
</span>

<style>
  .hunk-tracks {
    display: grid;
    grid-template-columns: auto 1fr auto 1fr;
    align-items: center;
    gap: 2px;
    height: 4px;
  }

  .track-label {
    font-family: var(--font-mono);
    font-size: 7px;
    line-height: 1;
  }

  .track-label--old {
    color: rgb(220 38 38);
  }

  .track-label--new {
    color: rgb(5 150 105);
  }

  .track {
    position: relative;
    overflow: hidden;
    border-radius: 9999px;
    background: hsl(var(--muted));
  }

  .segment {
    position: absolute;
    top: 0;
    bottom: 0;
    min-width: 2px;
    transform: translateX(-50%);
    border-radius: inherit;
  }

  .track--old .segment {
    background: rgb(239 68 68);
  }

  .track--new .segment {
    background: rgb(16 185 129);
  }

  :global(.dark) .track-label--old {
    color: rgb(239 68 68);
  }

  :global(.dark) .track-label--new {
    color: rgb(16 185 129);
  }
</style>
