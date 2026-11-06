<script lang="ts">
  import { onDestroy } from 'svelte';
  import { m } from '$shared/paraglide/messages.js';
  import { Button } from '$lib/components/ui/button';
  import type {
    DockCaptureEditorMark,
    DockCaptureEditorSaveResult,
    DockCaptureEditorSnapshot,
  } from '$shared/dock-capture-editor';
  import DockComposerIcon from '../../components/DockComposerIcon.svelte';
  import DockCaptureEditorShell from '../DockCaptureEditorShell.svelte';
  import { DestructiveConfirm } from '$lib/components/patterns/confirm';
  import DockRecordingTimeline from './DockRecordingTimeline.svelte';
  import DockRecordingSendOptions from './DockRecordingSendOptions.svelte';
  import DockRecordingTranscript from './DockRecordingTranscript.svelte';
  import DockRecordingFrameMarks from './DockRecordingFrameMarks.svelte';
  import { findFillerCuts, type FillerCuts } from './recording-transcript-model';
  import { frameToolKind, type FrameTool } from './recording-frame-model';
  import { createEditTransaction } from '../edit-transaction.svelte';
  import {
    defaultDockMediaEdit,
    dockMediaBatchAt,
    canUseHighlights,
    markRemovable,
    mergeDockMediaRanges,
    subtractDockMediaRanges,
    type DockMediaRange,
    type DockMediaEdit,
    type DockMediaGeometry,
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
    onSave,
  }: {
    snapshot: DockCaptureEditorSnapshot;
    onClose: () => void;
    /** Main's "edits would be lost" questions (window close, a switch); see the shell. */
    discardRequest?: number;
    onDirtyChange?: (dirty: boolean) => void;
    onDiscardRequested?: () => void;
    onKeepEditing?: () => void;
    /** Persist the edit; offered only when sending honors saved edits of this source. */
    onSave?: (edit: DockMediaEdit) => Promise<DockCaptureEditorSaveResult | null>;
  } = $props();

  // One session per mount (the page remounts the view for each open).
  const source = snapshot.source ?? null;
  // The transcript can arrive or improve while the editor is open (main re-sends it).
  const transcript = $derived(snapshot.transcript ?? null);
  const edits = source
    ? createEditTransaction<DockMediaEdit>(
        snapshot.saved ??
          defaultDockMediaEdit(
            source,
            source.capturedMarks ?? source.bakedMarks ?? [],
            snapshot.transcript ?? null,
            snapshot.rememberedChoice ?? null,
          ),
      )
    : null;
  // The default was chosen before the transcript arrived. When it resolves (to "no
  // speech", say), an untouched default follows it, as one new baseline: never over a
  // saved edit or anything the person changed. The default never opts into audio.
  let defaultedFor = snapshot.transcript?.status ?? null;
  $effect(() => {
    const status = transcript?.status ?? null;
    if (!edits || !source || snapshot.saved || status === defaultedFor) return;
    defaultedFor = status;
    // Untouched means no history at all: an undone change is still the person's.
    if (edits.dirty || edits.canUndo || edits.canRedo) return;
    const next = defaultDockMediaEdit(
      source,
      source.capturedMarks ?? source.bakedMarks ?? [],
      transcript,
      snapshot.rememberedChoice ?? null,
    );
    if (next.voice !== edits.draft.voice || next.video !== edits.draft.video) edits.commit(next);
  });
  // Recorded marks are part of the frames: cutting time away would not remove them.
  const timeEditable = !!source && (markRemovable(source) || !source.bakedMarks?.length);
  // Save: offered only when sending honors a saved edit of this source.
  const canSave = !!edits && !!onSave && snapshot.output?.ready === true;
  let saving = $state(false);
  let saveProblem = $state<'conflict' | 'failed' | null>(null);
  /** Highlights with every mark excluded sends no clips: warned once, before saving. */
  let confirmEmptyHighlights = $state(false);
  let warnedEmptyHighlights = false;
  async function save(): Promise<void> {
    if (!edits || !onSave || saving) return;
    if (
      edits.draft.video === 'highlights' &&
      !canUseHighlights(edits.draft) &&
      !warnedEmptyHighlights
    ) {
      warnedEmptyHighlights = true;
      confirmEmptyHighlights = true;
      return;
    }
    saving = true;
    saveProblem = null;
    const outcome = await onSave(edits.draft);
    saving = false;
    if (outcome?.result === 'saved' && outcome.saved) {
      // Saved: this is the new baseline, and the editor closes back to its pill.
      edits.commit(outcome.saved);
      onClose();
      return;
    }
    saveProblem =
      outcome?.result === 'revision-conflict' || outcome?.result === 'stale-source'
        ? 'conflict'
        : 'failed';
  }

  // Pins: the edit's marks when there is a canonical source, else the recording's own.
  const toolOf = {
    click: 'pick',
    element: 'pick',
    box: 'box',
    draw: 'pen',
    arrow: 'arrow',
    text: 'pen',
  } as const;
  const pins = $derived<(DockCaptureEditorMark & { excluded?: boolean })[]>(
    edits
      ? edits.draft.marks.map((mark) => ({
          id: mark.id,
          tool: toolOf[mark.kind],
          atMs: mark.atMs,
          excluded: !mark.included,
          ...(mark.label ? { label: mark.label } : {}),
        }))
      : snapshot.marks,
  );

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
  const activeMark = $derived(pins.find((mark) => mark.id === activeMarkId) ?? null);

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

  // Marks drawn while recording are part of the frames: including or excluding one is
  // honest only on a clean source.
  const marksEditable = !!source && markRemovable(source);
  // Drawing on frames: a tool draws a new mark on the paused frame; the pointer selects,
  // moves, resizes and deletes marks. On a clean source only, and only on a frame that
  // is kept (a mark on a cut frame would never be seen).
  let frameTool = $state<FrameTool | null>(null);
  let selectedMarkId = $state<string | null>(null);
  /**
   * One frame clock for drawing and painting: the shown time as a whole millisecond
   * inside the kept range it falls in. Rounding never leaves the range (a fractional
   * start rounds up, the very end of a range, or of the video, is its last
   * millisecond), so a mark drawn on a frame is on screen on that frame and kept.
   */
  function keptFrame(ms: number): number | null {
    const at = Math.min(ms, durationMs);
    const range = kept?.find((r) => at >= r.startMs && at <= r.endMs && r.endMs > r.startMs);
    if (!range) return null;
    const first = Math.ceil(range.startMs);
    const last = Math.ceil(range.endMs) - 1;
    return last < first ? null : Math.min(last, Math.max(first, Math.floor(at)));
  }
  const frameMs = $derived(keptFrame(currentMs));
  const frameKept = $derived(frameMs !== null);
  /** Choosing a tool or starting a gesture pauses; the gesture keeps the paused frame. */
  function pauseForFrame(): number {
    if (video && !video.paused) video.pause();
    if (video) currentMs = video.currentTime * 1000;
    return keptFrame(currentMs) ?? Math.floor(currentMs);
  }
  function drawMark(tool: FrameTool, geometry: DockMediaGeometry, atMs: number): void {
    if (!edits || !source) return;
    // The batch on screen at this frame. After the last Clear no batch is: an editor
    // batch id (not one of the source's) keeps the mark on screen to the end, where
    // falling back to the cleared batch would hide it as soon as it was drawn.
    const batchId = dockMediaBatchAt(source, atMs)?.id ?? 'editor';
    const id = crypto.randomUUID();
    edits.apply((draft) => ({
      ...draft,
      marks: [
        ...draft.marks,
        {
          id,
          atMs,
          batchId,
          source: 'editor',
          kind: frameToolKind(tool),
          included: true,
          geometry,
          label: m.dock_captureEditor_addedMark_label(),
          note: '',
          context: { selector: null, text: null, url: null },
        },
      ],
    }));
    selectedMarkId = id;
  }
  function changeMark(markId: string, geometry: DockMediaGeometry): void {
    edits?.apply((draft) => ({
      ...draft,
      marks: draft.marks.map((mark) => (mark.id === markId ? { ...mark, geometry } : mark)),
    }));
  }
  function deleteMark(markId: string): void {
    edits?.apply((draft) => ({
      ...draft,
      marks: draft.marks.filter((mark) => mark.id !== markId),
    }));
    if (selectedMarkId === markId) selectedMarkId = null;
  }
  const frameTools: {
    tool: FrameTool | null;
    glyph: 'cursor' | 'box' | 'pen' | 'arrow' | 'pencil';
  }[] = [
    { tool: null, glyph: 'cursor' },
    { tool: 'box', glyph: 'box' },
    { tool: 'pen', glyph: 'pen' },
    { tool: 'arrow', glyph: 'arrow' },
    { tool: 'text', glyph: 'pencil' },
  ];
  const frameToolLabels = {
    pointer: () => m.dock_recordingToolbar_pointer_label(),
    box: () => m.dock_recordingToolbar_rectangle_label(),
    pen: () => m.dock_recordingToolbar_draw_label(),
    arrow: () => m.dock_recordingToolbar_arrow_label(),
    text: () => m.dock_captureEditor_frameText_label(),
  };

  // Cut filler: offered only when the transcript has word-aligned filler or long gaps
  // inside what is kept. It shows what it found first, and applies only that, re-checked.
  const filler = $derived(
    edits && timeEditable && transcript?.status === 'ready' && kept
      ? findFillerCuts(transcript.words, kept, edits.draft.wordEdits)
      : null,
  );
  let fillerPreview = $state<FillerCuts | null>(null);
  let fillerOpen = $state(false);
  function previewFiller(): void {
    if (!filler?.ranges.length) return;
    fillerPreview = filler;
    fillerOpen = true;
  }
  function applyFiller(): void {
    const shown = fillerPreview;
    // Trim, cuts, corrections or the transcript changed meanwhile: show the new result.
    if (!filler || JSON.stringify(filler) !== JSON.stringify(shown)) {
      fillerPreview = filler;
      fillerOpen = !!filler?.ranges.length;
      return;
    }
    fillerOpen = false;
    if (!shown?.ranges.length) return;
    edits?.apply((draft) => ({
      ...draft,
      cuts: mergeDockMediaRanges([...draft.cuts, ...shown.ranges]),
    }));
  }

  /** Include or exclude a mark (Shift-click): one edit. */
  function toggleMark(markId: string): void {
    edits?.apply((draft) => ({
      ...draft,
      marks: draft.marks.map((mark) =>
        mark.id === markId ? { ...mark, included: !mark.included } : mark,
      ),
    }));
  }

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
  {saving}
  onSave={canSave ? save : undefined}
  onCancel={onClose}
  sidebar={sendOptions}
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
        {#if source && edits && marksEditable && !failed}
          <DockRecordingFrameMarks
            {source}
            edit={edits.draft}
            atMs={frameMs ?? currentMs}
            tool={frameTool}
            editable={frameKept}
            selectedId={selectedMarkId}
            onBegin={pauseForFrame}
            onDraw={drawMark}
            onChange={changeMark}
            onSelect={(id) => (selectedMarkId = id)}
            onDelete={deleteMark}
          />
          {#if marksEditable}
            <div
              class="frame-tools"
              role="toolbar"
              aria-label={m.dock_captureEditor_frameTools_label()}
            >
              {#each frameTools as entry (entry.glyph)}
                <Button
                  variant="plain"
                  size="icon-sm"
                  aria-pressed={frameTool === entry.tool}
                  aria-label={frameToolLabels[entry.tool ?? 'pointer']()}
                  tooltip={frameToolLabels[entry.tool ?? 'pointer']()}
                  onclick={() => {
                    frameTool = entry.tool;
                    pauseForFrame();
                    if (entry.tool) selectedMarkId = null;
                  }}
                >
                  <DockComposerIcon glyph={entry.glyph} size={16} />
                </Button>
              {/each}
            </div>
          {/if}
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
      {#if saveProblem}
        <p class="save-problem" role="alert" data-save-problem>
          {saveProblem === 'conflict'
            ? m.dock_captureEditor_saveConflict_label()
            : m.dock_captureEditor_saveFailed_label()}
        </p>
      {/if}
      <DockRecordingTimeline
        {durationMs}
        {currentMs}
        marks={pins}
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
        onToggleMark={marksEditable ? toggleMark : undefined}
        waveform={snapshot.waveform ?? null}
      />
    </div>
  {/snippet}
</DockCaptureEditorShell>

<DestructiveConfirm
  bind:open={confirmEmptyHighlights}
  destructive={false}
  title={m.dock_captureEditor_emptyHighlights_title()}
  confirmLabel={m.dock_captureEditor_saveAnyway_label()}
  cancelLabel={m.dock_captureEditor_keepEditing_label()}
  onConfirm={() => {
    confirmEmptyHighlights = false;
    void save();
  }}
/>

<DestructiveConfirm
  bind:open={fillerOpen}
  destructive={false}
  description={m.dock_captureEditor_cutFiller_gapNote()}
  title={fillerPreview?.ranges.length
    ? m.dock_captureEditor_cutFiller_title({
        words: fillerPreview.fillerCount,
        gaps: fillerPreview.gapCount,
        seconds: Math.round((fillerPreview.totalMs / 1000) * 10) / 10,
      })
    : m.dock_captureEditor_cutFiller_none()}
  confirmLabel={m.dock_captureEditor_cutFiller_apply()}
  cancelLabel={m.dock_captureEditor_cancel_label()}
  canSubmit={!!fillerPreview?.ranges.length}
  onConfirm={applyFiller}
  onCancel={() => (fillerOpen = false)}
/>

{#snippet sendOptions()}
  {#if source && edits}
    <div class="sidebar-content">
      <DockRecordingSendOptions
        edit={edits.draft}
        {source}
        {transcript}
        enabled={snapshot.output?.ready === true}
        onChange={(choice) => edits.apply((draft) => ({ ...draft, ...choice }))}
      />
      {#if filler?.ranges.length}
        <div class="transcript-tools">
          <Button variant="ghost" size="xs" onclick={previewFiller} data-cut-filler
            >{m.dock_captureEditor_cutFiller_label()}</Button
          >
        </div>
      {/if}
      <DockRecordingTranscript
        {transcript}
        batches={source.batches}
        marks={edits.draft.marks}
        {currentMs}
        {activeMarkId}
        dimmed={edits.draft.voice !== 'transcript'}
        onSeek={(ms) => {
          activeMarkId = null;
          seek(ms);
        }}
        onMark={(mark) => {
          activeMarkId = mark.id;
          video?.pause();
          seek(mark.atMs);
        }}
        cuts={edits.draft.cuts}
        wordEdits={edits.draft.wordEdits}
        onCut={timeEditable ? cut : undefined}
        onRestore={timeEditable ? restore : undefined}
        onWordEdit={(wordId, text) =>
          edits.apply((draft) => {
            const wordEdits = { ...draft.wordEdits };
            if (text === null) delete wordEdits[wordId];
            else wordEdits[wordId] = text.slice(0, 20_000);
            return { ...draft, wordEdits };
          })}
        onToggleMark={marksEditable ? toggleMark : undefined}
      />
    </div>
  {:else}
    <!-- Playback only: the same sidebar, nothing to change; says why. -->
    <div class="sidebar-content">
      <DockRecordingSendOptions
        edit={null}
        source={null}
        transcript={null}
        enabled={false}
        onChange={() => {}}
      />
      <p class="readonly-note" data-readonly-note>{m.dock_captureEditor_readonly_note()}</p>
      <DockRecordingTranscript
        transcript={null}
        batches={[]}
        marks={[]}
        {currentMs}
        onSeek={seek}
        onMark={() => {}}
      />
    </div>
  {/if}
{/snippet}

<style>
  /* The drawing tools float over the bottom of the video. */
  .frame-tools {
    position: absolute;
    bottom: 10px;
    left: 50%;
    display: flex;
    gap: 2px;
    padding: 2px;
    border: 1px solid hsl(var(--border));
    border-radius: var(--radius-medium);
    background: hsl(var(--card));
    box-shadow: var(--elevation-raised);
    transform: translateX(-50%);
  }
  .frame-tools :global([aria-pressed='true']) {
    background: hsl(var(--selected));
    color: hsl(var(--foreground));
  }
  .save-problem {
    margin: 0;
    font-size: 12px;
    color: hsl(var(--destructive));
  }
  .readonly-note {
    margin: 0;
    padding: 10px 16px 0;
    font-size: 11px;
    color: hsl(var(--muted-foreground));
  }
  .transcript-tools {
    display: flex;
    justify-content: flex-end;
    padding: 6px 10px 0;
  }
  /* Send options stay put; the transcript below scrolls on its own. */
  .sidebar-content {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
  }
  .stage {
    display: flex;
    flex-direction: column;
    gap: 8px;
    flex: 1;
    min-height: 0;
    padding: 12px 12px 10px;
  }
  /* The video takes all the room the controls and timeline leave. */
  .frame {
    position: relative;
    display: grid;
    place-items: center;
    flex: 1;
    min-height: 0;
    overflow: hidden;
    border-radius: var(--radius-medium);
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
