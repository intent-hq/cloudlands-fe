<script lang="ts">
  import { m } from '$shared/paraglide/messages.js';
  import { Button } from '$lib/components/ui/button';
  import type { DockCaptureEditorMark } from '$shared/dock-capture-editor';
  import type { DockMediaRange } from '$shared/dock-media-edit';
  import DockComposerIcon, {
    type DockComposerGlyph,
  } from '../../components/DockComposerIcon.svelte';
  import {
    clampTrim,
    formatRecordingTime,
    timeAtPointer,
    timelinePercent,
  } from './recording-editor-model';

  /**
   * The recording's timeline: the playhead (click or drag to move it), and a pin at
   * each mark's time; clicking a pin jumps to its mark. Video, timeline and the mark
   * label share this one playhead.
   *
   * With `trim`, handles at both ends trim the whole recording (drag, or arrow keys
   * on a focused handle); what falls outside is dimmed. `kept` shades what plays.
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
  }: {
    durationMs: number;
    currentMs: number;
    marks: readonly DockCaptureEditorMark[];
    activeMarkId?: string | null;
    onSeek: (ms: number) => void;
    onMark: (mark: DockCaptureEditorMark) => void;
    /** The trimmed range; null without trimming. */
    trim?: DockMediaRange | null;
    /** What plays and is kept (trim minus cuts). */
    kept?: readonly DockMediaRange[] | null;
    onTrim?: (range: DockMediaRange) => void;
  } = $props();

  let track = $state<HTMLDivElement | null>(null);
  let dragging: { pointerId: number; part: 'playhead' | 'start' | 'end' } | null = null;
  /**
   * A trim handle being dragged: shown at once, committed as one edit on release (so
   * one Undo undoes one whole gesture); a cancelled drag puts it back.
   */
  let previewTrim = $state<DockMediaRange | null>(null);
  const shownTrim = $derived(previewTrim ?? trim);

  const glyphs: Record<DockCaptureEditorMark['tool'], DockComposerGlyph> = {
    pick: 'click',
    box: 'box',
    pen: 'pen',
    arrow: 'arrow',
  };
  const toolLabels: Record<DockCaptureEditorMark['tool'], () => string> = {
    pick: () => m.dock_recordingToolbar_element_label(),
    box: () => m.dock_recordingToolbar_rectangle_label(),
    pen: () => m.dock_recordingToolbar_draw_label(),
    arrow: () => m.dock_recordingToolbar_arrow_label(),
  };
  const pinned = $derived(
    marks.filter((mark): mark is DockCaptureEditorMark & { atMs: number } => mark.atMs !== null),
  );

  function timeAt(event: PointerEvent): number {
    if (!track) return 0;
    const box = track.getBoundingClientRect();
    return timeAtPointer(event.clientX, box.left, box.width, durationMs);
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
    if (dragging.part === 'playhead') onSeek(timeAt(event));
    else if (trim && onTrim) previewTrim = trimmed(trim, dragging.part, timeAt(event));
  }
  function onPointerDown(event: PointerEvent): void {
    const target = event.target as Element;
    if (event.button !== 0 || target.closest('[data-pin]')) return;
    const handle = target.closest<HTMLElement>('[data-handle]')?.dataset.handle;
    dragging = {
      pointerId: event.pointerId,
      part: handle === 'start' || handle === 'end' ? handle : 'playhead',
    };
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
    dragging = null;
    previewTrim = null;
    if (commit && preview && onTrim) onTrim(preview);
  }
  function onKeydown(event: KeyboardEvent): void {
    const step = event.shiftKey ? 5000 : 1000;
    if (event.key === 'ArrowLeft') onSeek(currentMs - step);
    else if (event.key === 'ArrowRight') onSeek(currentMs + step);
    else if (event.key === 'Home') onSeek(0);
    else if (event.key === 'End') onSeek(durationMs);
    else return;
    event.preventDefault();
  }
</script>

<div class="timeline" data-testid="recording-timeline">
  <div
    bind:this={track}
    class="track"
    role="slider"
    tabindex="0"
    aria-label={m.dock_captureEditor_timeline_label()}
    aria-valuemin={0}
    aria-valuemax={Math.round(durationMs / 1000)}
    aria-valuenow={Math.round(currentMs / 1000)}
    aria-valuetext={formatRecordingTime(currentMs)}
    onpointerdown={onPointerDown}
    onpointermove={onPointerMove}
    onpointerup={() => endDrag(true)}
    onpointercancel={() => endDrag(false)}
    onlostpointercapture={() => endDrag(false)}
    onkeydown={onKeydown}
  >
    <div class="rail"></div>
    {#each kept ?? [] as range, index (index)}
      <div
        class="kept"
        style:left={`${timelinePercent(range.startMs, durationMs)}%`}
        style:width={`${timelinePercent(range.endMs, durationMs) - timelinePercent(range.startMs, durationMs)}%`}
      ></div>
    {/each}
    {#if shownTrim}
      <div
        class="outside"
        style:left="0"
        style:width={`${timelinePercent(shownTrim.startMs, durationMs)}%`}
      ></div>
      <div
        class="outside"
        style:left={`${timelinePercent(shownTrim.endMs, durationMs)}%`}
        style:right="0"
      ></div>
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
          style:left={`${timelinePercent(at, durationMs)}%`}
          onkeydown={(event) => onHandleKeydown(event, part)}
        ></div>
      {/each}
    {/if}
    {#each pinned as mark (mark.id)}
      <Button
        variant="plain"
        size="icon-compact"
        class="pin"
        data-pin={mark.id}
        data-active={mark.id === activeMarkId || undefined}
        style={`left: ${timelinePercent(mark.atMs, durationMs)}%`}
        aria-label={m.dock_captureEditor_pin_ariaLabel({
          mark: mark.label || toolLabels[mark.tool](),
          time: formatRecordingTime(mark.atMs),
        })}
        onclick={() => onMark(mark)}
      >
        <DockComposerIcon glyph={glyphs[mark.tool]} size={11} />
      </Button>
    {/each}
    <div class="playhead" style:left={`${timelinePercent(currentMs, durationMs)}%`}></div>
  </div>
</div>

<style>
  .timeline {
    padding: 4px 0 2px;
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
    outline: 2px solid hsl(var(--ring));
    outline-offset: 2px;
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
