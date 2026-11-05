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
  import {
    FRAME_MS,
    STEP_MS,
    clampTime,
    formatRecordingTime,
    recordingKeyAction,
  } from './recording-editor-model';

  /**
   * The recording editor (Capture and recording editor spec): the video is the main
   * area, with play controls and the timeline below it. Video, timeline and the mark
   * label share one playhead.
   *
   * This is the foundation: it plays the recording as captured (marks drawn while
   * recording are part of its frames) and navigates by its marks. Editing, the send
   * options and Save come with the output that honors them.
   */
  let { snapshot, onClose }: { snapshot: DockCaptureEditorSnapshot; onClose: () => void } =
    $props();

  let video = $state<HTMLVideoElement | null>(null);
  let currentMs = $state(0);
  let paused = $state(true);
  let mediaDurationMs = $state(0);
  let activeMarkId = $state<string | null>(null);
  let failed = $state(false);

  const durationMs = $derived(mediaDurationMs || snapshot.durationMs || 0);
  const activeMark = $derived(snapshot.marks.find((mark) => mark.id === activeMarkId) ?? null);

  // The playhead follows the video smoothly while it plays.
  let frame: number | undefined;
  function follow(): void {
    if (video) currentMs = video.currentTime * 1000;
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
    if (video.paused) void video.play().catch(() => undefined);
    else video.pause();
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
  onCancel={onClose}
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
