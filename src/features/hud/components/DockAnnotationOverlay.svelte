<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import {
    DOCK_ANNOTATION_STYLE as INK,
    dockAnnotationBadgeCenter,
  } from '$features/hud/composer/dock-annotation-style';
  import { fade, scale } from '$lib/motion';
  import {
    dockAnnotationViewport,
    dockGeometryRect,
    gestureOverlayGeometry,
    extendDockPenPoints,
    finishDockPenPoints,
    imageToOverlay,
    mapDockGeometry,
    pointInRects,
    type DockAnnotationOverlayState,
    type DockAnnotationOverlayTransport,
    type DockAnnotationPointerRequest,
    type DockAnnotationAck,
  } from '$shared/dock-annotation';
  import type { DockImagePoint, DockMarkGeometry, DockMarkTool } from '$shared/dock-evidence';
  import DockRecordingToolbar from './DockRecordingToolbar.svelte';
  import type { DockAnnotationSignal, DockBarAnchor } from '$shared/dock-annotation';

  let {
    overlay,
    stillUrl = null,
    transport,
    signal = null,
  }: {
    overlay: DockAnnotationOverlayState | null;
    stillUrl?: string | null;
    transport: DockAnnotationOverlayTransport;
    /** The live recording's microphone (the recording tool bar's waveform). */
    signal?: DockAnnotationSignal | null;
  } = $props();

  interface Gesture {
    sessionId: string;
    sequence: number;
    pointerId: number;
    tool: DockMarkTool;
    origin: DockImagePoint;
    points: DockImagePoint[];
    capped: boolean;
    down: Promise<DockAnnotationAck>;
    feedbackEpoch: number;
    transport: DockAnnotationOverlayTransport;
  }
  interface Pending {
    key: number;
    tool: DockMarkTool;
    geometry: DockMarkGeometry | null;
    origin: DockImagePoint;
    /** Accepted shapes stay until an authoritative sync newer than this arrives. */
    revision: number;
    status: 'sending' | 'accepted' | 'rejected';
  }

  // Sequences only ever increase within this document, across sessions.
  let sequence = 0;
  let pendingKey = 0;
  let feedbackEpoch = 0;
  let active = true;
  let pickFailure = $state<{ epoch: number; reason: Extract<DockAnnotationAck, { ok: false }>['reason'] } | null>(null);
  const feedbackContext = $derived(JSON.stringify([overlay?.sessionId, overlay?.tool, !!overlay?.mouse]));
  function retirePickFeedback() {
    feedbackEpoch++;
    pickFailure = null;
  }
  $effect(() => {
    const context = feedbackContext, owner = transport;
    untrack(retirePickFeedback);
    void context; void owner;
  });
  function ownsPickFeedback(current: Gesture): boolean {
    return active && current.feedbackEpoch === feedbackEpoch && current.sequence === sequence &&
      current.sessionId === overlay?.sessionId && current.tool === overlay?.tool &&
      !overlay?.mouse && current.transport === transport;
  }
  function pickResult(current: Gesture, ack: DockAnnotationAck) {
    if (current.tool !== 'pick' || !ownsPickFeedback(current)) return;
    if (ack.ok) pickFailure = null;
    else if (ack.reason !== 'stale' && ack.reason !== 'excluded')
      pickFailure = { epoch: current.feedbackEpoch, reason: ack.reason };
  }
  let gesture = $state.raw<Gesture | null>(null);
  let pending = $state.raw<Pending[]>([]);
  let root = $state<HTMLDivElement | null>(null);
  /** Where the person dragged the tool bar; both bars use it, so a swap never moves it. */
  let toolbarAnchor = $state<DockBarAnchor | null>(null);

  const imageSize = $derived(overlay?.still ?? overlay?.image ?? null);
  const view = $derived(
    overlay && imageSize ? dockAnnotationViewport(overlay.display, imageSize, overlay.mode) : null,
  );
  const marks = $derived(
    overlay && view
      ? overlay.marks.map((mark) => ({
          ...mark,
          overlay: mapDockGeometry(mark.geometry, (point) => imageToOverlay(point, view)),
        }))
      : [],
  );
  const stillFrame = $derived(
    overlay?.still && view
      ? {
          left: view.offsetX,
          top: view.offsetY,
          width: overlay.still.width * view.scaleX,
          height: overlay.still.height * view.scaleY,
        }
      : null,
  );
  const draft = $derived.by(() => {
    if (!gesture || gesture.tool === 'pick') return null;
    return gestureOverlayGeometry(gesture.tool, gesture.points);
  });

  // Drop accepted local shapes once the dock has redrawn the authoritative marks.
  $effect(() => {
    const revision = overlay?.marksRevision ?? 0;
    if (pending.some((row) => row.status === 'accepted' && row.revision < revision))
      pending = pending.filter((row) => !(row.status === 'accepted' && row.revision < revision));
  });

  // A replaced or ended session fences any gesture in flight.
  $effect(() => {
    const sessionId = overlay?.sessionId ?? null;
    if (gesture && gesture.sessionId !== sessionId) cancel();
    if (!sessionId && pending.length) pending = [];
  });

  function local(event: PointerEvent): DockImagePoint {
    const rect = root?.getBoundingClientRect();
    return { x: event.clientX - (rect?.left ?? 0), y: event.clientY - (rect?.top ?? 0) };
  }

  function onPointerDown(event: PointerEvent) {
    // Mouse mode: the screen is used normally; nothing here is a gesture.
    if (!overlay || overlay.mouse || event.button !== 0 || !event.isPrimary) return;
    const origin = local(event);
    // Dock and owned popups are never gesture origins.
    if (pointInRects(origin, overlay.excluded)) return;
    event.preventDefault();
    if (gesture) cancel();
    retirePickFeedback();
    sequence += 1;
    const request: DockAnnotationPointerRequest = {
      sessionId: overlay.sessionId,
      sequence,
      phase: 'down',
      x: origin.x,
      y: origin.y,
      tool: overlay.tool,
    };
    try {
      root?.setPointerCapture(event.pointerId);
    } catch {
      // A pointer that already ended cannot be captured; pointerup will not arrive.
      return;
    }
    const current: Gesture = {
      sessionId: overlay.sessionId,
      sequence,
      pointerId: event.pointerId,
      tool: overlay.tool,
      origin,
      points: [origin],
      capped: false,
      feedbackEpoch,
      transport,
      down: transport.pointer(request).catch((): DockAnnotationAck => ({ ok: false, reason: 'failed' })),
    };
    gesture = current;
    void current.down.then((ack) => {
      if (!ack.ok) {
        pickResult(current, ack);
        if (gesture?.sequence === current.sequence) gesture = null;
      }
    });
  }

  function onPointerMove(event: PointerEvent) {
    const current = gesture;
    if (!current || event.pointerId !== current.pointerId) return;
    const samples =
      current.tool === 'pen' && typeof event.getCoalescedEvents === 'function'
        ? event.getCoalescedEvents()
        : [event];
    const next = samples.map(local);
    if (current.tool === 'pen') {
      const observed = extendDockPenPoints(current, next);
      current.points = observed.points;
      current.capped = observed.capped;
    } else {
      current.points = [current.origin, next.at(-1) ?? current.origin];
    }
    gesture = { ...current };
    // Main stamps the recording clock. Never send renderer wall-clock timing.
    const end = current.points.at(-1) ?? current.origin;
    void current.down
      .then(
        (ack) =>
          ack.ok &&
          current.transport.pointer({
            sessionId: current.sessionId,
            sequence: current.sequence,
            phase: 'move',
            tool: current.tool,
            x: end.x,
            y: end.y,
            pointCount: current.points.length,
          }),
      )
      .catch(() => {});
  }

  function onPointerUp(event: PointerEvent) {
    const current = gesture;
    if (!current || event.pointerId !== current.pointerId) return;
    gesture = null;
    releaseCapture(current.pointerId);
    const end = local(event);
    const points =
      current.tool === 'pen'
        ? finishDockPenPoints(current, end)
        : current.tool === 'pick'
          ? [current.origin]
          : [current.origin, end];
    const geometry = current.tool === 'pick' ? null : gestureOverlayGeometry(current.tool, points);
    if (current.tool !== 'pick' && !geometry) {
      sendCancel(current);
      return;
    }
    const key = (pendingKey += 1);
    pending = [
      ...pending,
      {
        key,
        tool: current.tool,
        geometry,
        origin: current.origin,
        revision: overlay?.marksRevision ?? 0,
        status: 'sending',
      },
    ];
    void (async () => {
      const down = await current.down;
      if (current.tool === 'pick' && !ownsPickFeedback(current)) {
        settle(key, false);
        return;
      }
      const ack = down.ok
        ? await current.transport.gesture({
            sessionId: current.sessionId,
            sequence: current.sequence,
            tool: current.tool,
            origin: current.origin,
            points,
          }).catch((): DockAnnotationAck => ({ ok: false, reason: 'failed' }))
        : down;
      pickResult(current, ack);
      settle(key, ack.ok);
    })();
  }

  function settle(key: number, ok: boolean) {
    if (ok) {
      pending = pending.map((row) =>
        row.key === key
          ? { ...row, status: 'accepted', revision: overlay?.marksRevision ?? row.revision }
          : row,
      );
      // A mark the dock declined never syncs; let its local shape go.
      setTimeout(() => (pending = pending.filter((row) => row.key !== key)), 3_000);
      return;
    }
    pending = pending.map((row) => (row.key === key ? { ...row, status: 'rejected' } : row));
    setTimeout(() => (pending = pending.filter((row) => row.key !== key)), 220);
  }

  function releaseCapture(pointerId: number) {
    try {
      if (root?.hasPointerCapture(pointerId)) root.releasePointerCapture(pointerId);
    } catch {
      // Already released.
    }
  }

  function sendCancel(current: Gesture) {
    void transport
      .pointer({
        sessionId: current.sessionId,
        sequence: current.sequence,
        phase: 'cancel',
        x: current.origin.x,
        y: current.origin.y,
        tool: current.tool,
      })
      .catch(() => undefined);
  }

  function cancel() {
    retirePickFeedback();
    const current = gesture;
    if (!current) return;
    gesture = null;
    releaseCapture(current.pointerId);
    sendCancel(current);
  }

  function onLostCapture(event: PointerEvent) {
    if (gesture && event.pointerId === gesture.pointerId) cancel();
  }

  function onVisibility() {
    if (document.visibilityState !== 'visible') cancel();
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('blur', cancel);
    document.addEventListener('visibilitychange', onVisibility);
  }
  onDestroy(() => {
    active = false;
    cancel();
    if (typeof window === 'undefined') return;
    window.removeEventListener('blur', cancel);
    document.removeEventListener('visibilitychange', onVisibility);
  });

  // ---------------------------------------------------------------------------
  // Drawing helpers
  // ---------------------------------------------------------------------------

  const BADGE = INK.badgeRadius * 2;

  function badgeCenter(geometry: DockMarkGeometry): DockImagePoint {
    const rect = dockGeometryRect(geometry);
    const width = overlay?.display.width ?? Infinity;
    const height = overlay?.display.height ?? Infinity;
    const half = BADGE / 2;
    return dockAnnotationBadgeCenter(rect, { x: 0, y: 0, w: width, h: height }, 1, half);
  }

  function pathData(points: readonly DockImagePoint[]): string {
    return points
      .map((p, index) => `${index ? 'L' : 'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
      .join(' ');
  }

  function arrowHead(from: DockImagePoint, to: DockImagePoint): string {
    const angle = Math.atan2(to.y - from.y, to.x - from.x);
    const size = INK.arrowHead;
    const spread = INK.arrowSpread;
    const a = {
      x: to.x - size * Math.cos(angle - spread),
      y: to.y - size * Math.sin(angle - spread),
    };
    const b = {
      x: to.x - size * Math.cos(angle + spread),
      y: to.y - size * Math.sin(angle + spread),
    };
    return `M${a.x} ${a.y} L${to.x} ${to.y} L${b.x} ${b.y}`;
  }

  const CURSORS: Record<DockMarkTool, string> = {
    pick: cursor(
      `<circle cx="12" cy="12" r="6.5" fill="none" stroke="${INK.halo}" stroke-width="${INK.stroke + INK.haloWidth}"/><circle cx="12" cy="12" r="6.5" fill="none" stroke="${INK.accent}" stroke-width="${INK.stroke}"/><circle cx="12" cy="12" r="1.6" fill="${INK.accent}" stroke="${INK.halo}" stroke-width="0.8"/>`,
    ),
    box: cursor(
      `<path d="M12 4v16M4 12h16" stroke="${INK.halo}" stroke-width="${INK.stroke + INK.haloWidth}"/><path d="M12 4v16M4 12h16" stroke="${INK.accent}" stroke-width="${INK.stroke}"/><rect x="15" y="15" width="6" height="6" rx="1" fill="none" stroke="${INK.accent}" stroke-width="${INK.stroke}"/>`,
    ),
    pen: cursor(
      `<circle cx="12" cy="12" r="3.2" fill="${INK.accent}" stroke="${INK.halo}" stroke-width="1.4"/>`,
    ),
    arrow: cursor(
      `<path d="M12 4v16M4 12h16" stroke="${INK.halo}" stroke-width="${INK.stroke + INK.haloWidth}"/><path d="M12 4v16M4 12h16" stroke="${INK.accent}" stroke-width="${INK.stroke}"/><path d="M15 21l6-6M17 15h4v4" fill="none" stroke="${INK.accent}" stroke-width="${INK.stroke}" stroke-linecap="round"/>`,
    ),
  };

  function cursor(body: string): string {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">${body}</svg>`;
    return `url("data:image/svg+xml,${encodeURIComponent(svg)}") 12 12, crosshair`;
  }
</script>

{#snippet shape(geometry: DockMarkGeometry, tool: DockMarkTool)}
  {#if geometry.kind === 'rect'}
    <rect
      x={geometry.x}
      y={geometry.y}
      width={geometry.w}
      height={geometry.h}
      rx={tool === 'pick' ? 3 : 2}
      class="dock-annotation-stroke"
      stroke-width={INK.stroke}
    />
  {:else if geometry.kind === 'arrow'}
    <path
      d={`M${geometry.from.x} ${geometry.from.y} L${geometry.to.x} ${geometry.to.y} ${arrowHead(geometry.from, geometry.to)}`}
      class="dock-annotation-stroke"
      stroke-width={INK.stroke}
    />
  {:else}
    <path d={pathData(geometry.points)} class="dock-annotation-stroke" stroke-width={INK.pen} />
  {/if}
{/snippet}

<div
  bind:this={root}
  class="dock-annotation-overlay"
  class:is-still={!!overlay?.still}
  data-testid="dock-annotation-overlay"
  data-mode={overlay?.mode ?? 'idle'}
  data-tool={overlay?.tool ?? ''}
  style:--annotation-ink={INK.accent}
  style:--annotation-paper={INK.paper}
  style:--annotation-halo={INK.halo}
  style:--annotation-badge-font={INK.badgeFontFamily}
  style:--annotation-badge-size={`${INK.badgeRadius * INK.badgeTextScale}px`}
  style:--annotation-badge-outline={`${INK.badgeOutline}px`}
  style:cursor={overlay && !overlay.mouse ? CURSORS[overlay.tool] : 'default'}
  role="presentation"
  onpointerdown={onPointerDown}
  onpointermove={onPointerMove}
  onpointerup={onPointerUp}
  onpointercancel={cancel}
  onlostpointercapture={onLostCapture}
>
  {#if overlay}
    {#if overlay.still && stillFrame}
      <div class="dock-annotation-backdrop" transition:fade={{ tier: 'fast' }}></div>
      {#if stillUrl}
        <img
          class="dock-annotation-still"
          src={stillUrl}
          alt=""
          draggable="false"
          style:left="{stillFrame.left}px"
          style:top="{stillFrame.top}px"
          style:width="{stillFrame.width}px"
          style:height="{stillFrame.height}px"
          transition:scale={{ tier: 'fast', distance: 0.015 }}
        />
      {/if}
    {:else}
      <div class="dock-annotation-edge" transition:fade={{ tier: 'fast' }}></div>
    {/if}

    <svg
      class="dock-annotation-canvas"
      width={overlay.display.width}
      height={overlay.display.height}
      viewBox={`0 0 ${overlay.display.width} ${overlay.display.height}`}
      aria-hidden="true"
    >
      {#each marks as mark (mark.n + ':' + JSON.stringify(mark.geometry))}
        {@const badge = badgeCenter(mark.overlay)}
        <g
          class="dock-annotation-mark"
          data-mark={mark.n}
          in:scale={{ tier: 'fast' }}
          out:fade={{ tier: 'fast' }}
        >
          {@render shape(mark.overlay, mark.tool)}
          <circle cx={badge.x} cy={badge.y} r={BADGE / 2} class="dock-annotation-badge" />
          <text x={badge.x} y={badge.y} class="dock-annotation-badge-text">{mark.n}</text>
        </g>
      {/each}

      {#each pending as row (row.key)}
        <g
          class="dock-annotation-pending"
          class:is-rejected={row.status === 'rejected'}
          out:fade={{ tier: 'fast' }}
        >
          {#if row.geometry}
            {@render shape(row.geometry, row.tool)}
          {:else}
            <circle
              cx={row.origin.x}
              cy={row.origin.y}
              r="9"
              class="dock-annotation-stroke"
              stroke-width={INK.stroke}
            />
          {/if}
        </g>
      {/each}

      {#if draft && gesture}
        <g class="dock-annotation-draft">
          {@render shape(draft, gesture.tool)}
        </g>
      {/if}
    </svg>

    <!-- Annotate sessions only: dictation clicks need no tools. -->
    {#if overlay.mode !== 'dictation' && transport.toolbar && overlay.workArea}
      <!-- One tool bar: annotating, and while a recording is live (its chip appears). -->
      <DockRecordingToolbar
        {overlay}
        {signal}
        pickFailureReason={pickFailure?.reason ?? null}
        bind:anchor={toolbarAnchor}
        send={(request) => {
          if (['tool', 'mouse', 'clear', 'end', 'commit', 'done'].includes(request.action)) retirePickFeedback();
          void transport.toolbar?.(request).catch(() => false);
        }}
      />
    {/if}
  {/if}
</div>

<style>
  .dock-annotation-overlay {
    position: fixed;
    inset: 0;
    overflow: hidden;
    background: transparent;
    user-select: none;
    -webkit-user-select: none;
    touch-action: none;
  }

  .dock-annotation-canvas {
    position: absolute;
    inset: 0;
    overflow: visible;
    pointer-events: none;
  }

  .dock-annotation-edge {
    position: absolute;
    inset: 0;
    pointer-events: none;
    box-shadow: inset 0 0 0 1.5px hsl(var(--primary) / 0.32);
  }

  .dock-annotation-backdrop {
    position: absolute;
    inset: 0;
    pointer-events: none;
    background: hsl(var(--background) / 0.9);
  }

  .dock-annotation-still {
    position: absolute;
    pointer-events: none;
    border-radius: 10px;
    box-shadow:
      0 0 0 1px hsl(var(--border)),
      0 24px 64px hsl(var(--background) / 0.5);
  }

  .dock-annotation-stroke {
    fill: none;
    stroke: var(--annotation-ink);
    stroke-linecap: round;
    stroke-linejoin: round;
    filter: drop-shadow(0 0 0.6px var(--annotation-halo));
  }

  .dock-annotation-mark {
    transform-box: fill-box;
    transform-origin: center;
  }

  .dock-annotation-badge {
    fill: var(--annotation-paper);
    stroke: var(--annotation-ink);
    stroke-width: var(--annotation-badge-outline);
  }

  .dock-annotation-badge-text {
    fill: var(--annotation-ink);
    font-size: var(--annotation-badge-size);
    font-family: var(--annotation-badge-font);
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    letter-spacing: normal;
    text-anchor: middle;
    dominant-baseline: central;
  }

  .dock-annotation-pending {
    opacity: 0.7;
    transition: opacity var(--spring-fast) var(--spring-fast-ease);
  }

  .dock-annotation-pending.is-rejected {
    opacity: 0;
  }

  .dock-annotation-draft {
    opacity: 0.9;
  }

  @container style(--motion-reduced: 1) {
    .dock-annotation-pending {
      transition: none;
    }
  }
</style>
