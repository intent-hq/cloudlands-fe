<script lang="ts">
  import { onDestroy } from 'svelte';
  import { m } from '$shared/paraglide/messages.js';
  import { Button } from '$lib/components/ui/button';
  import type {
    DockCaptureEditorMark,
    DockCaptureEditorSnapshot,
  } from '$shared/dock-capture-editor';
  import DockComposerIcon from '../../components/DockComposerIcon.svelte';
  import DockCaptureEditorShell from '../DockCaptureEditorShell.svelte';
  import DockRecordingTimeline from './DockRecordingTimeline.svelte';
  import { createEditTransaction } from '../edit-transaction.svelte';
  import {
    defaultDockMediaEdit,
    markRemovable,
    mergeDockMediaRanges,
    subtractDockMediaRanges,
    type DockMediaRange,
    type DockMediaEdit,
  } from '$shared/dock-media-edit';
  import {
    FRAME_MS,
    STEP_MS,
    clampTime,
    formatRecordingTime,
    nextKeptTime,
    recordingKeyAction,
  } from './recording-editor-model';

  /**
   * The recording editor (Capture and recording editor spec): the video is the main
   * area, with play controls and the timeline below it. Video, timeline and the mark
   * label share one playhead.
   *
   * It plays the recording as captured (marks drawn while recording are part of its
   * frames) and navigates by its marks. With a canonical source, the edit is a draft
   * (undo, redo, Esc asks before discarding): trim handles set what is kept, and
   * playback skips the rest. Save appears only once sending honors a saved edit; a
   * source without a canonical description opens read-only.
   */
  let {
    snapshot,
    onClose,
    discardRequest = 0,
    onDirtyChange,
    onDiscardRequested,
    onKeepEditing,
  }: {
    snapshot: DockCaptureEditorSnapshot;
    onClose: () => void;
    /** Main's "edits would be lost" questions (window close, a switch); see the shell. */
    discardRequest?: number;
    onDirtyChange?: (dirty: boolean) => void;
    onDiscardRequested?: () => void;
    onKeepEditing?: () => void;
  } = $props();

  // One session per mount (the page remounts the view for each open).
  const source = snapshot.source ?? null;
  const transcript = snapshot.transcript ?? null;
  const edits = source
    ? createEditTransaction<DockMediaEdit>(
        snapshot.saved ?? defaultDockMediaEdit(source, source.bakedMarks ?? [], transcript, null),
      )
    : null;
  // Recorded marks are part of the frames: cutting time away would not remove them.
  const timeEditable = !!source && (markRemovable(source) || !source.bakedMarks?.length);
  const kept = $derived(
    edits ? subtractDockMediaRanges([edits.draft.trim], edits.draft.cuts) : null,
  );

  let video = $state<HTMLVideoElement | null>(null);
  let currentMs = $state(0);
  let paused = $state(true);
  let mediaDurationMs = $state(0);
  let activeMarkId = $state<string | null>(null);
  let failed = $state(false);

  // Edits are bounded by the canonical source's duration; the media's own duration
  // is only a display fallback for a source without one (read-only).
  const durationMs = $derived(
    snapshot.source?.durationMs ?? (mediaDurationMs || snapshot.durationMs || 0),
  );
  const activeMark = $derived(snapshot.marks.find((mark) => mark.id === activeMarkId) ?? null);

  // Main asks before closing or switching would lose these edits.
  $effect(() => {
    onDirtyChange?.(edits?.dirty ?? false);
  });

  // The playhead follows the video smoothly while it plays.
  let frame: number | undefined;
  function follow(): void {
    if (video) {
      currentMs = video.currentTime * 1000;
      // Play only what is kept: skip past what was trimmed or cut away.
      if (kept && !video.paused) {
        const next = nextKeptTime(currentMs, kept);
        if (next === null) {
          video.pause();
          seek(kept.at(-1)?.endMs ?? currentMs);
        } else if (next !== currentMs) seek(next);
      }
    }
    frame = paused ? undefined : requestAnimationFrame(follow);
  }
  $effect(() => {
    if (!paused && frame === undefined) frame = requestAnimationFrame(follow);
  });
  onDestroy(() => {
    if (frame !== undefined) cancelAnimationFrame(frame);
  });
  // A new attachment in the same window starts over.
  $effect(() => {
    snapshot.openId;
    currentMs = 0;
    activeMarkId = null;
    failed = false;
  });

  /** Cut a stretch: one edit; overlapping or touching cuts merge into one. */
  function cut(range: DockMediaRange): void {
    edits?.apply((draft) => ({ ...draft, cuts: mergeDockMediaRanges([...draft.cuts, range]) }));
  }
  /** Restore a cut stretch (click on it): one edit. */
  function restore(range: DockMediaRange): void {
    edits?.apply((draft) => ({
      ...draft,
      cuts: draft.cuts.filter((row) => row.startMs !== range.startMs || row.endMs !== range.endMs),
    }));
  }

  function seek(ms: number): void {
    const next = clampTime(ms, durationMs);
    currentMs = next;
    if (video) video.currentTime = next / 1000;
  }
  function jumpTo(mark: DockCaptureEditorMark): void {
    if (mark.atMs === null) return;
    activeMarkId = mark.id;
    video?.pause();
    seek(mark.atMs);
  }
  function toggle(): void {
    if (!video) return;
    if (!video.paused) {
      video.pause();
      return;
    }
    // From the end (or outside what is kept), play from the start of what is kept.
    if (kept?.length && nextKeptTime(currentMs, kept) === null) seek(kept[0].startMs);
    void video.play().catch(() => undefined);
  }
  function step(ms: number): void {
    video?.pause();
    seek(currentMs + ms);
  }
  function onKeydown(event: KeyboardEvent): void {
    if (event.defaultPrevented) return;
    const action = recordingKeyAction(event);
    if (!action) return;
    event.preventDefault();
    if (action === 'toggle') toggle();
    else if (action === 'back') step(-STEP_MS);
    else if (action === 'forward') step(STEP_MS);
    else if (action === 'previous-frame') step(-FRAME_MS);
    else step(FRAME_MS);
  }
</script>

<svelte:window onkeydown={onKeydown} />

<DockCaptureEditorShell
  title={m.dock_captureEditor_recording_title({ duration: formatRecordingTime(durationMs) })}
  subtitle={snapshot.title}
  dirty={edits?.dirty ?? false}
  onCancel={onClose}
  onUndo={edits ? () => edits.undo() : undefined}
  onRedo={edits ? () => edits.redo() : undefined}
  {discardRequest}
  {onDiscardRequested}
  {onKeepEditing}
>
  {#snippet main()}
    <div class="stage">
      <div class="frame">
        {#if failed}
          <p class="unavailable" role="status">{m.dock_captureEditor_unavailable_label()}</p>
        {:else}
          <!-- svelte-ignore a11y_media_has_caption -- the user's own screen recording; no caption track exists. -->
          <video
            bind:this={video}
            src={snapshot.mediaUrl}
            playsinline
            preload="auto"
            aria-label={m.dock_captureEditor_video_ariaLabel()}
            onplay={() => (paused = false)}
            onpause={() => {
              paused = true;
              if (video) currentMs = video.currentTime * 1000;
            }}
            onended={() => (paused = true)}
            onseeked={() => {
              if (video) currentMs = video.currentTime * 1000;
            }}
            onloadedmetadata={() => {
              if (video && Number.isFinite(video.duration)) mediaDurationMs = video.duration * 1000;
            }}
            onerror={() => (failed = true)}
          ></video>
        {/if}
        {#if activeMark && activeMark.atMs !== null}
          <span class="mark-label" data-mark-label
            >{formatRecordingTime(activeMark.atMs)} · {activeMark.label ||
              m.dock_captureEditor_mark_label()}</span
          >
        {/if}
      </div>
      <div class="controls">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={paused
            ? m.dock_captureEditor_play_label()
            : m.dock_captureEditor_pause_label()}
          tooltip={paused ? m.dock_captureEditor_play_label() : m.dock_captureEditor_pause_label()}
          tooltipShortcut="space"
          disabled={failed}
          onclick={toggle}
        >
          <DockComposerIcon glyph={paused ? 'play' : 'pause'} size={14} />
        </Button>
        <span class="time" data-time
          >{formatRecordingTime(currentMs)} / {formatRecordingTime(durationMs)}</span
        >
      </div>
      <DockRecordingTimeline
        {durationMs}
        {currentMs}
        marks={snapshot.marks}
        {activeMarkId}
        trim={timeEditable && edits ? edits.draft.trim : null}
        {kept}
        onTrim={timeEditable && edits
          ? (trim) => edits.apply((draft) => ({ ...draft, trim }))
          : undefined}
        cuts={timeEditable && edits ? edits.draft.cuts : []}
        onCut={timeEditable && edits ? cut : undefined}
        onRestore={timeEditable && edits ? restore : undefined}
        onSeek={(ms) => {
          activeMarkId = null;
          seek(ms);
        }}
        onMark={jumpTo}
      />
    </div>
  {/snippet}
</DockCaptureEditorShell>

<style>
  .stage {
    display: flex;
    flex-direction: column;
    gap: 8px;
    flex: 1;
    min-height: 0;
    padding: 12px;
  }
  /* The video takes all the room the controls and timeline leave. */
  .frame {
    position: relative;
    display: grid;
    place-items: center;
    flex: 1;
    min-height: 0;
    overflow: hidden;
    border-radius: 10px;
    background: hsl(var(--secondary));
  }
  video {
    width: 100%;
    height: 100%;
    object-fit: contain;
  }
  .mark-label {
    position: absolute;
    top: 8px;
    left: 8px;
    padding: 2px 6px;
    border-radius: 4px;
    background: hsl(var(--background) / 0.85);
    font-size: 11px;
  }
  .unavailable {
    margin: 0;
    font-size: 13px;
    color: hsl(var(--muted-foreground));
  }
  .controls {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .time {
    font-size: 12px;
    font-variant-numeric: tabular-nums;
    color: hsl(var(--muted-foreground));
  }
</style>
