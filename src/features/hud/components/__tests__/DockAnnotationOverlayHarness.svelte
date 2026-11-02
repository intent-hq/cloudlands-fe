<script lang="ts">
  import DockAnnotationOverlay from '../DockAnnotationOverlay.svelte';
  import {
    dockAnnotationLiveEmpty,
    dockAnnotationLiveMarked,
    dockAnnotationStill,
    dockAnnotationStillUrl,
    recordingTransport,
  } from '../dock-annotation-overlay.fixtures';
  import type {
    DockAnnotationOverlayState,
    DockAnnotationOverlayTransport,
    DockAnnotationToolbarRequest,
  } from '$shared/dock-annotation';

  let {
    fixture = 'live-empty',
    pick,
    dock,
    media = null,
    markCount,
  }: {
    fixture?: 'live-empty' | 'live-marked' | 'still';
    pick?: DockAnnotationOverlayState['pick'];
    /** Overrides the fixture's dock bounds (the tool bar sits next to them). */
    dock?: DockAnnotationOverlayState['dock'];
    /** The composer's Screenshot/Record state as the dock sends it. */
    media?: DockAnnotationOverlayState['media'];
    /** Keep only the first n fixture marks (the Attach badge counts them). */
    markCount?: number;
  } = $props();
  // The dock's echo of Record on the bar: a recording starts, then stops.
  let recordingSince = $state<number | null>(null);
  // Main's echo of Clear: the marks on screen are gone.
  let cleared = $state(false);

  // Main's echo of a tool switched on the bar; an ended session has no overlay.
  let toolOverride = $state<DockAnnotationOverlayState['tool'] | null>(null);
  let ended = $state(false);
  let mouse = $state(false);
  const overlay = $derived.by(() => {
    if (ended) return null;
    const base =
      fixture === 'still'
        ? dockAnnotationStill
        : fixture === 'live-marked'
          ? dockAnnotationLiveMarked
          : dockAnnotationLiveEmpty;
    return {
      ...base,
      ...(pick ? { pick } : {}),
      ...(dock !== undefined ? { dock } : {}),
      ...(toolOverride ? { tool: toolOverride } : {}),
      ...(markCount !== undefined ? { marks: base.marks.slice(0, markCount) } : {}),
      ...(cleared ? { marks: [] } : {}),
      mouse,
      media:
        media && recordingSince
          ? {
              ...media,
              record: {
                ...media.record,
                label: 'Stop recording',
                tooltip: 'Stop recording',
                recording: true,
                startedAt: recordingSince,
              },
            }
          : media,
    };
  });

  // Only the fixture's recording transport exists here: no IPC, capture or accessibility.
  const recorder = recordingTransport();
  let pointers = $state('[]');
  let gestures = $state('[]');
  let toolbarRequests = $state<DockAnnotationToolbarRequest[]>([]);
  const transport: DockAnnotationOverlayTransport = {
    pointer: async (request) => {
      const ack = await recorder.pointer(request);
      pointers = JSON.stringify(recorder.pointers);
      return ack;
    },
    gesture: async (request) => {
      const ack = await recorder.gesture(request);
      gestures = JSON.stringify(recorder.gestures);
      return ack;
    },
    toolbar: async (request) => {
      toolbarRequests = [...toolbarRequests, request];
      if (request.action === 'tool') {
        toolOverride = request.tool;
        mouse = false;
      }
      // Like main: Done commits the marks and then switches to mouse mode.
      if (request.action === 'mouse' || request.action === 'commit') mouse = true;
      if (request.action === 'end') ended = true;
      if (request.action === 'clear') cleared = true;
      if (request.action === 'record') recordingSince = recordingSince ? null : Date.now() - 65_000;
      return true;
    },
  };
  const toolbarActions = $derived(
    JSON.stringify(
      toolbarRequests.filter((row) => row.action !== 'rect').map((row) => ({ ...row })),
    ),
  );
  const toolbarRect = $derived(
    JSON.stringify(toolbarRequests.findLast((row) => row.action === 'rect') ?? null),
  );
</script>

<div
  data-testid="dock-annotation-harness"
  data-pointers={pointers}
  data-gestures={gestures}
  data-toolbar={toolbarActions}
  data-toolbar-rect={toolbarRect}
>
  <!-- A stand-in for the dock window under the overlay, so its placement is visible. -->
  {#if overlay?.dock}
    <div
      class="dock-stand-in"
      data-testid="dock-stand-in"
      style:left="{overlay.dock.rect.x}px"
      style:top="{overlay.dock.rect.y}px"
      style:width="{overlay.dock.rect.width}px"
      style:height="{overlay.dock.rect.height}px"
    ></div>
  {/if}
  <DockAnnotationOverlay
    {overlay}
    stillUrl={fixture === 'still' ? dockAnnotationStillUrl : null}
    {transport}
  />
</div>

<style>
  .dock-stand-in {
    position: fixed;
    border-radius: 16px;
    background: hsl(var(--theme-dark-surface-2, 0 0% 11%));
    box-shadow: 0 0 0 1px hsl(var(--theme-dark-border));
  }
</style>
