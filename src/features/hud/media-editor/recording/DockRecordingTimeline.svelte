<script lang="ts">
  import { tick } from 'svelte';
  import { m } from '$shared/paraglide/messages.js';
  import { Button } from '$lib/components/ui/button';
  import type { DockCaptureEditorMark } from '$shared/dock-capture-editor';
  import { subtractDockMediaRanges, type DockMediaRange } from '$shared/dock-media-edit';
  import { formatInteger } from '$lib/i18n/format';
  import {
    clampTrim,
    formatRecordingTime,
    timeAtPointer,
    timelinePercent,
    recordingOutputDuration,
    recordingSourceToOutput,
    recordingOutputToSource,
  } from './recording-editor-model';

  /**
   * The recording's timeline: the playhead (click or drag to move it), and a pin at
   * each mark's time; clicking a pin jumps to its mark. Video, timeline and the mark
   * label share this one playhead.
   *
   * With `trim`, handles at both ends trim the whole recording (drag, or arrow keys
   * on a focused handle); what falls outside is dimmed. `kept` shades what plays.
   *
   * Cuts collapse on the display clock. Selection, pins, waveform and keyboard seeks
   * map back to the same source clock used by the edit/export. A small join restores
   * a cut; Undo remains an ordinary editor transaction. Trimmed margins remain
   * available to the edge handles, so extending a trim does not require Undo.
   */
  let {
    durationMs,
    currentMs,
    marks,
    activeMarkId = null,
    trim = null,
    kept = null,
    onSeek,
    onMark,
    onTrim,
    cuts = [],
    onCut,
    onRestore,
    onDeleteMark,
    waveform = null,
  }: {
    durationMs: number;
    currentMs: number;
    /** Pins; an excluded mark shows hollow. */
    marks: readonly (DockCaptureEditorMark & { n?: number })[];
    activeMarkId?: string | null;
    onSeek: (ms: number) => void;
    onMark: (mark: DockCaptureEditorMark) => void;
    onDeleteMark?: (markId: string) => void;
    /** Decoded audio peaks (0–1) every `intervalMs` from the start of the source. */
    waveform?: { peaks: readonly number[]; intervalMs: number; durationMs: number } | null;
    /** The trimmed range; null without trimming. */
    trim?: DockMediaRange | null;
    /** What plays and is kept (trim minus cuts). */
    kept?: readonly DockMediaRange[] | null;
    onTrim?: (range: DockMediaRange) => void;
    /** Stretches cut out (hatched); clicking one calls `onRestore` with it. */
    cuts?: readonly DockMediaRange[];
    onCut?: (range: DockMediaRange) => void;
    onRestore?: (range: DockMediaRange) => void;
  } = $props();

  let track = $state<HTMLDivElement | null>(null);
  // Remove cuts, not source pixels. Keep trim margins available to its handles.
  const axisRanges = $derived(subtractDockMediaRanges([{ startMs: 0, endMs: durationMs }], cuts));
  const axisDurationMs = $derived(recordingOutputDuration(axisRanges));
  const axisCurrentMs = $derived(recordingSourceToOutput(currentMs, axisRanges));
  const percent = (sourceMs: number) =>
    timelinePercent(recordingSourceToOutput(sourceMs, axisRanges), axisDurationMs);
  const sourceAt = (outputMs: number, edge: 'after' | 'before' = 'after') =>
    recordingOutputToSource(outputMs, axisRanges, edge);
  $effect(() => {
    void cuts;
    void trim;
    selection = null;
  });

  // Zoom (Cmd/Ctrl + wheel, or pinch, which arrives as a Ctrl wheel): the track grows
  // up to 8x inside a scroller, keeping the time under the pointer in place.
  const MAX_ZOOM = 8;
  let zoom = $state(1);
  let scroller = $state<HTMLDivElement | null>(null);
  function onWheel(event: WheelEvent): void {
    if (!(event.ctrlKey || event.metaKey) || !scroller || !track) return;
    event.preventDefault();
    const next = Math.min(MAX_ZOOM, Math.max(1, zoom * Math.exp(-event.deltaY / 200)));
    if (next === zoom) return;
    const view = scroller.getBoundingClientRect();
    const offset = event.clientX - view.left;
    const fraction = (scroller.scrollLeft + offset) / track.offsetWidth;
    zoom = next;
    void tick().then(() => {
      if (scroller && track) scroller.scrollLeft = fraction * track.offsetWidth - offset;
    });
  }
  // Not `onwheel`: Svelte makes that passive, and a zoom must stop the page zooming.
  $effect(() => {
    const node = scroller;
    if (!node) return;
    node.addEventListener('wheel', onWheel, { passive: false });
    return () => node.removeEventListener('wheel', onWheel);
  });
  // While zoomed, keep the playhead in view as it moves (playback, seeking).
  $effect(() => {
    const at = timelinePercent(axisCurrentMs, axisDurationMs) / 100;
    if (zoom === 1 || !scroller || !track) return;
    const x = at * track.offsetWidth;
    const { scrollLeft, clientWidth } = scroller;
    if (x < scrollLeft || x > scrollLeft + clientWidth)
      scroller.scrollLeft = Math.max(0, x - clientWidth * 0.1);
  });
  let dragging: {
    pointerId: number;
    part: 'playhead' | 'start' | 'end';
    originX: number;
    originMs: number;
    selecting: boolean;
  } | null = null;
  /** A selected range, ready for Delete; drawn from the drag that made it. */
  let selection = $state<DockMediaRange | null>(null);
  const SELECT_THRESHOLD_PX = 4;
  /**
   * A trim handle being dragged: shown at once, committed as one edit on release (so
   * one Undo undoes one whole gesture); a cancelled drag puts it back.
   */
  let previewTrim = $state<DockMediaRange | null>(null);
  const shownTrim = $derived(previewTrim ?? trim);

  // The waveform as one SVG path: a vertical bar per peak, centred.
  const wave = $derived.by(() => {
    if (!waveform || !waveform.peaks.length || durationMs <= 0) return null;
    if (axisDurationMs <= 0) return null;
    const bars = waveform.peaks
      .flatMap((peak, index) => {
        const at = index * waveform.intervalMs;
        if (!axisRanges.some((range) => at >= range.startMs && at < range.endMs)) return [];
        const h = Math.max(0.5, peak * 45),
          x = (recordingSourceToOutput(at, axisRanges) / axisDurationMs) * 1000;
        return [`M${x} ${50 - h}V${50 + h}`];
      })
      .join('');
    return { path: bars };
  });
  const pinned = $derived(
    marks.filter(
      (mark): mark is DockCaptureEditorMark & { atMs: number; n?: number } =>
        mark.atMs !== null &&
        axisRanges.some((range) => mark.atMs! >= range.startMs && mark.atMs! < range.endMs),
    ),
  );

  function timeAt(event: PointerEvent): number {
    if (!track) return 0;
    const box = track.getBoundingClientRect();
    return timeAtPointer(event.clientX, box.left, box.width, axisDurationMs);
  }
  function trimmed(base: DockMediaRange, part: 'start' | 'end', ms: number): DockMediaRange {
    return clampTrim(
      part === 'start' ? { ...base, startMs: ms } : { ...base, endMs: ms },
      part,
      durationMs,
    );
  }
  function moveTrim(part: 'start' | 'end', ms: number): void {
    if (trim && onTrim) onTrim(trimmed(trim, part, ms));
  }
  function apply(event: PointerEvent): void {
    if (!dragging) return;
    if (dragging.part !== 'playhead') {
      if (trim && onTrim)
        previewTrim = trimmed(
          trim,
          dragging.part,
          sourceAt(timeAt(event), dragging.part === 'end' ? 'before' : 'after'),
        );
      return;
    }
    // Past a few pixels, a drag on the track selects a range instead of scrubbing.
    if (
      onCut &&
      !dragging.selecting &&
      Math.abs(event.clientX - dragging.originX) > SELECT_THRESHOLD_PX
    )
      dragging.selecting = true;
    if (dragging.selecting) {
      const at = timeAt(event);
      selection = {
        startMs: Math.min(at, dragging.originMs),
        endMs: Math.max(at, dragging.originMs),
      };
    } else onSeek(sourceAt(timeAt(event)));
  }
  function onPointerDown(event: PointerEvent): void {
    const target = event.target as Element;
    if (event.button !== 0 || target.closest('[data-pin], [data-cut]')) return;
    const handle = target.closest<HTMLElement>('[data-handle]')?.dataset.handle;
    selection = null;
    dragging = {
      pointerId: event.pointerId,
      part: handle === 'start' || handle === 'end' ? handle : 'playhead',
      originX: event.clientX,
      originMs: timeAt(event),
      selecting: false,
    };
    (handle ? target.closest<HTMLElement>('[data-handle]') : track)?.focus({ preventScroll: true });
    track?.setPointerCapture(event.pointerId);
    apply(event);
  }
  function onPointerMove(event: PointerEvent): void {
    if (dragging?.pointerId === event.pointerId) apply(event);
  }
  function onHandleKeydown(event: KeyboardEvent, part: 'start' | 'end'): void {
    if (!trim) return;
    const step = event.shiftKey ? 5000 : 1000;
    const at = part === 'start' ? trim.startMs : trim.endMs;
    if (event.key === 'ArrowLeft') moveTrim(part, at - step);
    else if (event.key === 'ArrowRight') moveTrim(part, at + step);
    else return;
    event.preventDefault();
    event.stopPropagation();
  }
  /** Release commits a trim drag as one edit; a cancelled one is put back. */
  function endDrag(commit: boolean): void {
    const preview = previewTrim;
    if (!commit && dragging?.selecting) selection = null;
    dragging = null;
    previewTrim = null;
    if (commit && preview && onTrim) onTrim(preview);
  }
  function onKeydown(event: KeyboardEvent): void {
    const pin =
      event.target instanceof Element ? event.target.closest<HTMLElement>('[data-pin]') : null;
    if (pin?.dataset.pin && onDeleteMark && (event.key === 'Delete' || event.key === 'Backspace')) {
      event.preventDefault();
      event.stopPropagation();
      onDeleteMark(pin.dataset.pin);
      track?.focus({ preventScroll: true });
      return;
    }
    if (selection && onCut && (event.key === 'Delete' || event.key === 'Backspace')) {
      event.preventDefault();
      const range = selection;
      selection = null;
      if (range.endMs > range.startMs)
        onCut({ startMs: sourceAt(range.startMs), endMs: sourceAt(range.endMs, 'before') });
      event.stopPropagation();
      return;
    }
    if (selection && event.key === 'Escape') {
      // Clears the selection only; the shell's Esc (close) does not run.
      event.preventDefault();
      selection = null;
      event.stopPropagation();
      return;
    }
    const step = event.shiftKey ? 5000 : 1000;
    if (event.key === 'ArrowLeft') onSeek(sourceAt(Math.max(0, axisCurrentMs - step)));
    else if (event.key === 'ArrowRight')
      onSeek(sourceAt(Math.min(axisDurationMs, axisCurrentMs + step)));
    else if (event.key === 'Home') onSeek(sourceAt(0));
    else if (event.key === 'End') onSeek(sourceAt(axisDurationMs));
    else return;
    event.preventDefault();
  }
</script>

<div
  class="timeline"
  data-testid="recording-timeline"
  data-zoomed={zoom > 1 || undefined}
  bind:this={scroller}
>
  <div
    bind:this={track}
    style:width={`${zoom * 100}%`}
    class="track"
    role="slider"
    tabindex="0"
    aria-label={m.dock_captureEditor_timeline_label()}
    aria-valuemin={0}
    aria-valuemax={Math.round(axisDurationMs / 1000)}
    aria-valuenow={Math.round(axisCurrentMs / 1000)}
    aria-valuetext={formatRecordingTime(axisCurrentMs)}
    onpointerdown={onPointerDown}
    onpointermove={onPointerMove}
    onpointerup={() => endDrag(true)}
    onpointercancel={() => endDrag(false)}
    onlostpointercapture={() => endDrag(false)}
    onkeydown={onKeydown}
  >
    {#if wave}
      <svg
        class="wave"
        style:width="100%"
        viewBox="0 0 1000 100"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <path d={wave.path} />
      </svg>
    {:else}
      <div class="rail"></div>
    {/if}
    {#each kept ?? [] as range, index (index)}
      <div
        class="kept"
        style:left={`${percent(range.startMs)}%`}
        style:width={`${percent(range.endMs) - percent(range.startMs)}%`}
      ></div>
    {/each}
    {#if shownTrim}
      <div class="outside" style:left="0" style:width={`${percent(shownTrim.startMs)}%`}></div>
      <div class="outside" style:left={`${percent(shownTrim.endMs)}%`} style:right="0"></div>
      {#each ['start', 'end'] as const as part (part)}
        {@const at = part === 'start' ? shownTrim.startMs : shownTrim.endMs}
        <div
          class="handle"
          data-handle={part}
          role="slider"
          tabindex={onTrim ? 0 : -1}
          aria-disabled={!onTrim}
          aria-label={part === 'start'
            ? m.dock_captureEditor_trimStart_label()
            : m.dock_captureEditor_trimEnd_label()}
          aria-valuemin={0}
          aria-valuemax={Math.round(durationMs / 1000)}
          aria-valuenow={Math.round(at / 1000)}
          aria-valuetext={formatRecordingTime(at)}
          style:left={`${percent(at)}%`}
          onkeydown={(event) => onHandleKeydown(event, part)}
        ></div>
      {/each}
    {/if}
    {#each cuts as cut (`${cut.startMs}-${cut.endMs}`)}
      <Button
        variant="plain"
        class="cut"
        data-cut
        disabled={!onRestore}
        style={`left: ${percent(cut.startMs)}%`}
        aria-label={m.dock_captureEditor_restoreCut_label({
          start: formatRecordingTime(cut.startMs),
          end: formatRecordingTime(cut.endMs),
        })}
        tooltip={onRestore ? m.dock_captureEditor_restoreCut_tooltip() : undefined}
        onclick={() => onRestore?.(cut)}
      ></Button>
    {/each}
    {#if selection}
      <div
        class="selection"
        data-selection
        style:left={`${timelinePercent(selection.startMs, axisDurationMs)}%`}
        style:width={`${timelinePercent(selection.endMs, axisDurationMs) - timelinePercent(selection.startMs, axisDurationMs)}%`}
      ></div>
    {/if}
    {#each pinned as mark (mark.id)}
      <Button
        variant="plain"
        size="icon-compact"
        class="pin"
        data-pin={mark.id}
        data-active={mark.id === activeMarkId || undefined}
        style={`left: ${percent(mark.atMs)}%`}
        aria-label={formatInteger(mark.n ?? 0)}
        onclick={() => onMark(mark)}
        >{formatInteger(mark.n ?? 0)}
      </Button>
    {/each}
    <div class="playhead" style:left={`${timelinePercent(axisCurrentMs, axisDurationMs)}%`}></div>
  </div>
</div>

<style>
  .timeline {
    padding: 4px 0 2px;
  }
  .timeline[data-zoomed] {
    overflow-x: auto;
    padding-bottom: 6px;
  }
  .track {
    position: relative;
    height: 44px;
    border-radius: 8px;
    background: hsl(var(--secondary));
    cursor: pointer;
    touch-action: none;
  }
  .track:focus-visible {
    outline: none;
  }
  .track:focus-visible .playhead {
    background: hsl(var(--primary));
    box-shadow: 0 0 0 2px hsl(var(--background));
  }
  .wave {
    position: absolute;
    top: 6px;
    bottom: 6px;
    left: 0;
    height: calc(100% - 12px);
    pointer-events: none;
  }
  .wave path {
    stroke: hsl(var(--muted-foreground) / 0.55);
    stroke-width: 0.6;
    vector-effect: non-scaling-stroke;
  }
  .rail {
    position: absolute;
    inset: 50% 8px auto;
    height: 2px;
    background: hsl(var(--border));
  }
  .track :global(.pin) {
    position: absolute;
    bottom: 4px;
    display: grid;
    place-items: center;
    width: 18px;
    height: 18px;
    padding: 0;
    border: 1px solid hsl(var(--border));
    border-radius: 5px;
    background: hsl(var(--background));
    color: hsl(var(--foreground));
    transform: translateX(-50%);
    cursor: pointer;
  }
  .track :global(.pin[data-excluded]) {
    background: transparent;
    opacity: 0.6;
  }
  .track :global(.pin[data-active]) {
    border-color: hsl(var(--primary));
    background: hsl(var(--primary));
    color: hsl(var(--primary-foreground));
  }
  .track :global(.pin:focus-visible) {
    outline: 2px solid hsl(var(--ring));
    outline-offset: 1px;
  }
  .kept {
    position: absolute;
    top: 6px;
    bottom: 6px;
    border-radius: 4px;
    background: hsl(var(--primary) / 0.18);
    pointer-events: none;
  }
  .outside {
    position: absolute;
    top: 0;
    bottom: 0;
    background: hsl(var(--background) / 0.55);
    pointer-events: none;
  }
  .track :global(.cut) {
    position: absolute;
    top: 4px;
    bottom: 4px;
    height: auto;
    width: 6px;
    min-width: 6px;
    transform: translateX(-50%);
    padding: 0;
    border-radius: 4px;
    background: repeating-linear-gradient(
      135deg,
      hsl(var(--muted-foreground) / 0.45) 0 3px,
      transparent 3px 7px
    );
  }
  .selection {
    position: absolute;
    top: 2px;
    bottom: 2px;
    border: 1px solid hsl(var(--primary));
    border-radius: 4px;
    background: hsl(var(--primary) / 0.12);
    pointer-events: none;
  }
  .handle {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 8px;
    border-radius: 4px;
    background: hsl(var(--primary));
    transform: translateX(-50%);
    cursor: ew-resize;
  }
  .handle[aria-disabled='true'] {
    display: none;
  }
  .handle:focus-visible {
    outline: 2px solid hsl(var(--ring));
    outline-offset: 1px;
  }
  .playhead {
    position: absolute;
    top: 2px;
    bottom: 2px;
    width: 2px;
    border-radius: 1px;
    background: hsl(var(--foreground));
    transform: translateX(-50%);
    pointer-events: none;
  }
</style>
