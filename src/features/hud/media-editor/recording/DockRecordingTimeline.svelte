<script lang="ts">
  import { m } from '$shared/paraglide/messages.js';
  import { Button } from '$lib/components/ui/button';
  import type { DockCaptureEditorMark } from '$shared/dock-capture-editor';
  import DockComposerIcon, {
    type DockComposerGlyph,
  } from '../../components/DockComposerIcon.svelte';
  import { formatRecordingTime, timeAtPointer, timelinePercent } from './recording-editor-model';

  /**
   * The recording's timeline: the playhead (click or drag to move it), and a pin at
   * each mark's time; clicking a pin jumps to its mark. Video, timeline and the mark
   * label share this one playhead.
   */
  let {
    durationMs,
    currentMs,
    marks,
    activeMarkId = null,
    onSeek,
    onMark,
  }: {
    durationMs: number;
    currentMs: number;
    marks: readonly DockCaptureEditorMark[];
    activeMarkId?: string | null;
    onSeek: (ms: number) => void;
    onMark: (mark: DockCaptureEditorMark) => void;
  } = $props();

  let track = $state<HTMLDivElement | null>(null);
  let dragging: number | null = null;

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

  function seekTo(event: PointerEvent): void {
    if (!track) return;
    const box = track.getBoundingClientRect();
    onSeek(timeAtPointer(event.clientX, box.left, box.width, durationMs));
  }
  function onPointerDown(event: PointerEvent): void {
    if (event.button !== 0 || (event.target as Element).closest('[data-pin]')) return;
    dragging = event.pointerId;
    track?.setPointerCapture(event.pointerId);
    seekTo(event);
  }
  function onPointerMove(event: PointerEvent): void {
    if (dragging === event.pointerId) seekTo(event);
  }
  const endDrag = () => (dragging = null);
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
    onpointerup={endDrag}
    onpointercancel={endDrag}
    onkeydown={onKeydown}
  >
    <div class="rail"></div>
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
