<script lang="ts">
  /**
   * CT harness: the real recording tool bar over a page, with main and the dock
   * replaced at the toolbar boundary. Every request is recorded (`data-requests`), and
   * the dock's answers are mirrored back the way main publishes them: a tool or Mouse
   * changes the selection, Clear empties the marks, pause/resume moves `pausedAt`.
   * "Draw a mark" stands in for a gesture.
   */
  import type {
    DockAnnotationOverlayState,
    DockAnnotationSignal,
    DockAnnotationToolbarRequest,
  } from '$shared/dock-annotation';
  import DockRecordingToolbar from '../DockRecordingToolbar.svelte';
  import {
    dockAnnotationLiveEmpty,
    dockAnnotationLiveMarked,
    dockAnnotationMediaRecording,
  } from '../dock-annotation-overlay.fixtures';

  let {
    marked = false,
    paused = false,
    elapsedMs = 42_000,
    signal = { level: 0.6, mic: true },
    width = 900,
  }: {
    marked?: boolean;
    paused?: boolean;
    elapsedMs?: number;
    signal?: DockAnnotationSignal | null;
    width?: number;
  } = $props();

  const startedAt = Date.now() - elapsedMs;
  const base = marked ? dockAnnotationLiveMarked : dockAnnotationLiveEmpty;
  let overlay = $state<DockAnnotationOverlayState>({
    ...base,
    mouse: true,
    display: { width, height: 400 },
    workArea: { x: 0, y: 0, width, height: 400 },
    dock: null,
    media: dockAnnotationMediaRecording(startedAt, paused ? Date.now() : null),
  });
  let requests = $state<DockAnnotationToolbarRequest[]>([]);
  let shown = $state(true);
  // A speaking voice: the live level moves (about 15 times a second, as main sends it).
  let tick = $state(0);
  $effect(() => {
    const timer = setInterval(() => (tick += 1), 66);
    return () => clearInterval(timer);
  });
  const VOICE = [0.35, 0.8, 0.55, 0.95, 0.4, 0.7, 0.25, 0.85];
  const live = $derived(
    signal && signal.mic && signal.level > 0
      ? { ...signal, level: (VOICE[tick % VOICE.length] ?? 0) * signal.level * 1.4 }
      : signal,
  );

  function send(request: DockAnnotationToolbarRequest) {
    if (request.action === 'rect') return;
    requests = [...requests, request];
    if (request.action === 'mouse') overlay = { ...overlay, mouse: true };
    if (request.action === 'tool') overlay = { ...overlay, mouse: false, tool: request.tool };
    if (request.action === 'clear' || request.action === 'discard')
      overlay = { ...overlay, marks: [], image: null };
    if (request.action === 'pause' && overlay.media) {
      const record = overlay.media.record;
      overlay = {
        ...overlay,
        media: {
          ...overlay.media,
          record: request.paused
            ? { ...record, pausedAt: Date.now() }
            : {
                ...record,
                pausedAt: null,
                pausedMs: record.pausedMs + (Date.now() - (record.pausedAt ?? Date.now())),
              },
        },
      };
    }
    if (request.action === 'done' || request.action === 'discard-confirm') shown = false;
  }
  function drawMark() {
    overlay = {
      ...overlay,
      mouse: false,
      image: dockAnnotationLiveMarked.image,
      marks: dockAnnotationLiveMarked.marks.slice(0, 1),
    };
  }
</script>

<div
  class="page"
  style:width="{width}px"
  data-testid="recording-harness"
  data-requests={JSON.stringify(requests)}
  data-shown={shown}
>
  <label>Page field <input data-testid="page-field" /></label>
  <button type="button" onclick={drawMark}>Draw a mark</button>
  {#if shown}
    <DockRecordingToolbar {overlay} {send} signal={live} />
  {/if}
</div>

<style>
  .page {
    position: relative;
    height: 400px;
    padding: 12px;
    background: repeating-linear-gradient(45deg, #ececec 0 12px, #f6f6f6 12px 24px);
    font-family: Inter, sans-serif;
  }
  @media (prefers-color-scheme: dark) {
    .page {
      background: repeating-linear-gradient(45deg, #111 0 12px, #181818 12px 24px);
      color: #eee;
    }
  }
</style>
