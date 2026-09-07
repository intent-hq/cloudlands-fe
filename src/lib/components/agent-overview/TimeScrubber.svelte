<script lang="ts">
  import Fa from 'svelte-fa';
  import { faPause, faPlay } from '@fortawesome/free-solid-svg-icons';
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
  const ticks = $derived(
    hasRange ? timesMs.map((time) => ((time - minMs) / (maxMs - minMs)) * 100) : [],
  );
  let hover = $state<{ left: number; time: string } | null>(null);

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

  function cycleSpeed(): void {
    const speeds: PlaybackSpeed[] = [1, 2, 4, 8];
    onSpeedChange(speeds[(speeds.indexOf(speed) + 1) % speeds.length]);
  }
</script>

<div
  class="pointer-events-auto absolute inset-x-3 bottom-3 z-10 flex items-center gap-2 rounded-lg border border-border bg-card/95 px-2 py-1.5 shadow-sm backdrop-blur focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-ring"
  role="toolbar"
  aria-label={m.agentOverview_timeScrubber_live_label()}
  tabindex="0"
  onkeydown={handleKeydown}
  data-time-scrubber
>
  <button
    type="button"
    class="flex size-7 shrink-0 items-center justify-center rounded-full text-foreground hover:bg-muted"
    aria-label={isPlaying
      ? m.workspace_card_pause_label()
      : m.chat_videoBlock_play_ariaLabel({ name: m.agentOverview_timeScrubber_live_label() })}
    onclick={onTogglePlay}
  >
    <Fa icon={isPlaying ? faPause : faPlay} class="size-2.5" />
  </button>
  <button
    type="button"
    class="w-8 shrink-0 rounded px-1 py-0.5 text-xs tabular-nums text-subtle hover:bg-muted hover:text-foreground"
    onclick={cycleSpeed}>{speed}×</button
  >
  <span class="hidden shrink-0 text-xs tabular-nums text-subtle sm:inline">
    {formatTime(minTime)}
  </span>
  <div
    class="group relative flex h-7 min-w-0 flex-1 items-center"
    role="presentation"
    onpointermove={handlePointerMove}
    onpointerleave={() => (hover = null)}
  >
    <div class="absolute inset-x-0 h-px bg-border"></div>
    <div class="absolute left-0 h-px bg-foreground" style:width={`${progress}%`}></div>
    {#each ticks as tick, index (`${tick}-${index}`)}
      <i class="absolute h-1.5 w-px -translate-x-1/2 bg-muted-foreground/50" style:left={`${tick}%`}
      ></i>
    {/each}
    <input
      type="range"
      min={minMs}
      max={maxMs}
      value={currentMs}
      disabled={!hasRange}
      aria-label={m.agentOverview_timeScrubber_live_label()}
      oninput={handleInput}
      class="absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
    />
    <i
      class="pointer-events-none absolute size-3 -translate-x-1/2 rounded-full border-2 border-card bg-foreground shadow-sm"
      style:left={`${progress}%`}
    ></i>
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
    onclick={onGoLive}>{m.agentOverview_timeScrubber_live_label()}</button
  >
</div>
