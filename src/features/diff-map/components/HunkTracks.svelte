<script lang="ts">
  import { hunkTrackColor } from './hunk-track-colors';

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
  <span class="track" style:background={hunkTrackColor('background')}>
    {#each segments(oldTrack) as segment, index (index)}
      <span
        class="segment segment--old"
        style:background={hunkTrackColor('old')}
        style:left={`${segment.position * 100}%`}
        style:width={`${segment.size * 100}%`}
      ></span>
    {/each}
    {#each segments(newTrack) as segment, index (index)}
      <span
        class="segment segment--new"
        style:background={hunkTrackColor('new')}
        style:left={`${segment.position * 100}%`}
        style:width={`${segment.size * 100}%`}
      ></span>
    {/each}
  </span>
</span>

<style>
  .hunk-tracks {
    display: block;
    height: 6px;
  }

  .track {
    position: relative;
    display: block;
    height: 100%;
    overflow: hidden;
    border-radius: 2px;
  }

  .segment {
    position: absolute;
    height: 3px;
    min-width: 2px;
    transform: translateX(-50%);
  }

  .segment--old {
    top: 0;
    border-radius: 2px 2px 0 0;
  }

  .segment--new {
    bottom: 0;
    border-radius: 0 0 2px 2px;
  }
</style>
