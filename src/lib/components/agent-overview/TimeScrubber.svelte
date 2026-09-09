<script lang="ts">
  import { onMount } from 'svelte';
  import Fa from 'svelte-fa';
  import { faPause, faPlay } from '@fortawesome/free-solid-svg-icons';
  import { Select } from '$lib/components/ui/select';
  import { formatTime as formatClockTime } from '$lib/i18n/format';
  import { m } from '$shared/paraglide/messages.js';
  import { playbackShortcut, stepPlaybackEvent, type PlaybackSpeed } from './playback';

  interface Props {
    currentTime: string;
    minTime: string;
    maxTime: string;
    eventTimes?: string[];
    isLive: boolean;
    isPlaying: boolean;
    speed: PlaybackSpeed;
    onTimeChange: (time: string) => void;
    onTogglePlay: () => void;
    onSpeedChange: (speed: PlaybackSpeed) => void;
    onGoLive: () => void;
  }

  let {
    currentTime,
    minTime,
    maxTime,
    eventTimes = [],
    isLive,
    isPlaying,
    speed,
    onTimeChange,
    onTogglePlay,
    onSpeedChange,
    onGoLive,
  }: Props = $props();

  const minMs = $derived(Date.parse(minTime));
  const maxMs = $derived(Date.parse(maxTime));
  const currentMs = $derived(Date.parse(currentTime));
  const timesMs = $derived(
    eventTimes
      .map(Date.parse)
      .filter(Number.isFinite)
      .sort((a, b) => a - b),
  );
  const hasRange = $derived(Number.isFinite(minMs) && Number.isFinite(maxMs) && maxMs > minMs);
  const progress = $derived(
    hasRange ? Math.min(100, Math.max(0, ((currentMs - minMs) / (maxMs - minMs)) * 100)) : 100,
  );
  let track: HTMLDivElement;
  let trackWidth = $state(0);
  const tickBins = $derived.by(() => {
    if (!hasRange || trackWidth <= 0) return [];
    const bins = new Map<number, number>();
    const maxColumn = Math.max(0, Math.floor(trackWidth / 2) - 1);
    for (const time of timesMs) {
      const ratio = Math.min(1, Math.max(0, (time - minMs) / (maxMs - minMs)));
      const column = Math.min(maxColumn, Math.floor(ratio * Math.max(1, maxColumn)));
      bins.set(column, (bins.get(column) ?? 0) + 1);
    }
    const maxDensity = Math.max(1, ...bins.values());
    return [...bins].map(([column, density]) => ({
      left: column * 2,
      height: 4 + Math.round((density / maxDensity) * 6),
    }));
  });
  const deadSpans = $derived.by(() => {
    if (!hasRange || timesMs.length < 2) return [];
    return timesMs.slice(0, -1).flatMap((time, index) => {
      const next = timesMs[index + 1];
      const left = ((time - minMs) / (maxMs - minMs)) * 100;
      const width = ((next - time) / (maxMs - minMs)) * 100;
      return width > 0 ? [{ left, width }] : [];
    });
  });
  const nextEventMs = $derived(timesMs.find((time) => time > currentMs));
  const secondsToNext = $derived.by(() => {
    if (nextEventMs === undefined || isLive) return null;
    const rate = Math.max(1, (maxMs - minMs) / 60_000);
    return Math.max(1, Math.ceil((nextEventMs - currentMs) / (rate * speed * 1000)));
  });
  const captionLeft = $derived(Math.min(88, Math.max(12, progress)));
  const speedItems = [1, 2, 4, 8].map((value) => ({ value: String(value), label: `${value}×` }));
  let hover = $state<{ left: number; time: string } | null>(null);

  onMount(() => {
    trackWidth = track.getBoundingClientRect().width;
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => (trackWidth = entry.contentRect.width));
    observer.observe(track);
    return () => observer.disconnect();
  });

  function formatTime(time: string): string {
    try {
      return formatClockTime(time, { seconds: true }) || '--:--:--';
    } catch {
      return '--:--:--';
    }
  }

  function changeTime(ms: number): void {
    onTimeChange(new Date(Math.min(maxMs, Math.max(minMs, ms))).toISOString());
  }

  function handleInput(event: Event): void {
    changeTime(Number((event.target as HTMLInputElement).value));
  }

  function handlePointerMove(event: PointerEvent): void {
    if (!hasRange) return;
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    hover = { left: ratio * 100, time: new Date(minMs + ratio * (maxMs - minMs)).toISOString() };
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (event.target !== event.currentTarget) return;
    const shortcut = playbackShortcut(event.key);
    if (!shortcut) return;
    event.preventDefault();
    if (shortcut === 'toggle') onTogglePlay();
    else if (shortcut === 'live') onGoLive();
    else if (shortcut === 'start') changeTime(minMs);
    else if (shortcut === 'end') changeTime(maxMs);
    else changeTime(stepPlaybackEvent(timesMs, currentMs, shortcut === 'previous' ? -1 : 1));
  }

  function changeSpeed(value: string): void {
    onSpeedChange(Number(value) as PlaybackSpeed);
  }
</script>

<div
  class="pointer-events-auto relative z-10 flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-border bg-card/95 px-2 py-1.5 shadow-sm backdrop-blur focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-ring"
  role="toolbar"
  aria-label={m.agentOverview_timeScrubber_playback_ariaLabel()}
  tabindex="0"
  onkeydown={handleKeydown}
  data-time-scrubber
>
  <button
    type="button"
    class="flex size-7 shrink-0 items-center justify-center rounded-full text-foreground hover:bg-muted"
    aria-label={isPlaying
      ? m.agentOverview_timeScrubber_pauseReplay_ariaLabel()
      : m.agentOverview_timeScrubber_playReplay_ariaLabel()}
    onclick={onTogglePlay}
  >
    <Fa icon={isPlaying ? faPause : faPlay} class="size-2.5" />
  </button>
  <Select.Root bind:value={() => String(speed), changeSpeed} items={speedItems}>
    <Select.Trigger
      aria-label={m.agentOverview_timeScrubber_speed_ariaLabel()}
      class="h-7! w-14! px-2! text-xs tabular-nums"
    >
      <Select.Value />
    </Select.Trigger>
    <Select.Content dropUp>
      {#each speedItems as item}
        <Select.Item value={item.value} label={item.label}>{item.label}</Select.Item>
      {/each}
    </Select.Content>
  </Select.Root>
  <span class="hidden shrink-0 text-xs tabular-nums text-subtle sm:inline">
    {formatTime(minTime)}
  </span>
  <div
    bind:this={track}
    class="group relative flex h-7 min-w-0 flex-1 items-center"
    role="presentation"
    onpointermove={handlePointerMove}
    onpointerleave={() => (hover = null)}
  >
    <div class="absolute inset-x-0 h-px bg-border"></div>
    {#each deadSpans as span, index (`${span.left}-${index}`)}
      <i
        class="dead-time-span absolute h-2 -translate-y-1/2 opacity-35"
        style:left={`${span.left}%`}
        style:width={`${span.width}%`}
        data-dead-time-span
      ></i>
    {/each}
    <div class="absolute left-0 h-px bg-foreground" style:width={`${progress}%`}></div>
    {#each tickBins as tick, index (`${tick.left}-${index}`)}
      <i
        class="absolute bottom-1/2 w-0.5 bg-muted-foreground/65"
        style:left={`${tick.left}px`}
        style:height={`${tick.height}px`}
        data-event-tick
      ></i>
    {/each}
    <input
      type="range"
      min={minMs}
      max={maxMs}
      value={currentMs}
      disabled={!hasRange}
      aria-label={m.agentOverview_timeScrubber_position_ariaLabel()}
      aria-valuetext={formatTime(currentTime)}
      oninput={handleInput}
      class="absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
    />
    <i
      class="pointer-events-none absolute size-3 -translate-x-1/2 rounded-full border-2 border-card bg-foreground shadow-sm"
      style:left={`${progress}%`}
    ></i>
    {#if secondsToNext !== null}
      <span
        class="next-event-caption pointer-events-none absolute bottom-full mb-1 -translate-x-1/2 whitespace-nowrap rounded bg-card px-1.5 py-0.5 text-muted-foreground shadow-sm"
        style:left={`${captionLeft}%`}
        data-next-event-caption
        >{m.agentOverview_timeScrubber_nextEvent_label({ seconds: secondsToNext })}</span
      >
    {/if}
    {#if hover}
      <span
        class="pointer-events-none absolute bottom-full mb-1 -translate-x-1/2 rounded bg-foreground px-1.5 py-0.5 text-xs tabular-nums text-background"
        style:left={`${hover.left}%`}>{formatTime(hover.time)}</span
      >
    {/if}
  </div>
  <span class="hidden shrink-0 text-xs tabular-nums text-subtle sm:inline">
    {formatTime(maxTime)}
  </span>
  <button
    type="button"
    class="shrink-0 rounded-full border px-2 py-0.5 text-xs font-semibold"
    class:border-foreground={isLive}
    class:bg-foreground={isLive}
    class:text-background={isLive}
    class:border-border={!isLive}
    class:text-subtle={!isLive}
    aria-label={m.agentOverview_timeScrubber_jumpToLive_ariaLabel()}
    onclick={onGoLive}>{m.agentOverview_timeScrubber_live_label()}</button
  >
</div>

<style>
  .next-event-caption {
    font-size: 10px;
  }
  .dead-time-span {
    background-image: repeating-linear-gradient(
      135deg,
      transparent 0,
      transparent 3px,
      var(--color-muted-foreground) 3px,
      var(--color-muted-foreground) 4px
    );
  }
</style>
