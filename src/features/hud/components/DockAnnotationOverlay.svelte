<script lang="ts">
  import { onDestroy } from 'svelte';
  import { fade, scale } from '$lib/motion';
  import {
    DOCK_ANNOTATION_LIMITS,
    DOCK_STILL_FRAME,
    dockAnnotationViewport,
    dockGeometryRect,
    gestureOverlayGeometry,
    imageToOverlay,
    mapDockGeometry,
    pointInRects,
    type DockAnnotationOverlayState,
    type DockAnnotationOverlayTransport,
    type DockAnnotationPointerRequest,
  } from '$shared/dock-annotation';
  import type { DockImagePoint, DockMarkGeometry, DockMarkTool } from '$shared/dock-evidence';
  import DockAnnotationToolbar from './DockAnnotationToolbar.svelte';
  import ZoomPanViewport from '$lib/components/ui/ZoomPanViewport.svelte';

  let {
    overlay,
    stillUrl = null,
    transport,
  }: {
    overlay: DockAnnotationOverlayState | null;
    stillUrl?: string | null;
    transport: DockAnnotationOverlayTransport;
  } = $props();

  interface Gesture {
    sessionId: string;
    sequence: number;
    pointerId: number;
    tool: DockMarkTool;
    origin: DockImagePoint;
    points: DockImagePoint[];
    down: Promise<boolean>;
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
  let gesture = $state.raw<Gesture | null>(null);
  let pending = $state.raw<Pending[]>([]);
  let root = $state<HTMLDivElement | null>(null);

  // Mark up is a framed window: gestures and marks live in the still's image pixels,
  // drawn on the zoomable image itself.
  const framed = $derived(overlay?.mode === 'still' && !!overlay.still);
  /** Gesture surface: the whole overlay, or the still image in the framed window. */
  let surface = $state<HTMLDivElement | null>(null);
  let stageWidth = $state(0);
  let stageHeight = $state(0);
  let zoom = $state(1);
  const stillFit = $derived(
    framed && overlay?.still && stageWidth > 0 && stageHeight > 0
      ? Math.min(
          stageWidth / overlay.still.width,
          Math.max(1, stageHeight - DOCK_STILL_FRAME.zoomBar) / overlay.still.height,
        )
      : null,
  );
  /** Image pixels per screen pixel: strokes and badges keep their on-screen size. */
  const unit = $derived(stillFit ? 1 / (stillFit * zoom) : 1);

  const imageSize = $derived(overlay?.still ?? overlay?.image ?? null);
  const view = $derived(
    overlay && imageSize ? dockAnnotationViewport(overlay.display, imageSize, overlay.mode) : null,
  );
  const marks = $derived(
    overlay && framed
      ? overlay.marks.map((mark) => ({ ...mark, overlay: mark.geometry }))
      : overlay && view
        ? overlay.marks.map((mark) => ({
            ...mark,
            overlay: mapDockGeometry(mark.geometry, (point) => imageToOverlay(point, view)),
          }))
        : [],
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
    const still = framed ? overlay?.still : null;
    if (still && surface) {
      // The rendered box includes the zoom: map straight back to image pixels.
      const rect = surface.getBoundingClientRect();
      return {
        x: ((event.clientX - rect.left) / rect.width) * still.width,
        y: ((event.clientY - rect.top) / rect.height) * still.height,
      };
    }
    const rect = root?.getBoundingClientRect();
    return { x: event.clientX - (rect?.left ?? 0), y: event.clientY - (rect?.top ?? 0) };
  }

  /** The element that owns the gesture's pointer capture. */
  const captureTarget = () => (framed ? surface : root);

  function onPointerDown(event: PointerEvent) {
    // Mouse mode: the screen is used normally; nothing here is a gesture.
    if (!overlay || overlay.mouse || event.button !== 0 || !event.isPrimary) return;
    const origin = local(event);
    // Dock and owned popups are never gesture origins.
    if (!framed && pointInRects(origin, overlay.excluded)) return;
    event.preventDefault();
    // Drawing on the still never pans the zoom viewport around it.
    if (framed) event.stopPropagation();
    if (gesture) cancel();
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
      captureTarget()?.setPointerCapture(event.pointerId);
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
      down: transport.pointer(request).then(
        (ack) => ack.ok,
        () => false,
      ),
    };
    gesture = current;
    void current.down.then((ok) => {
      if (!ok && gesture?.sequence === current.sequence) gesture = null;
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
      if (current.points.length + next.length > DOCK_ANNOTATION_LIMITS.gesturePoints) return;
      current.points = [...current.points, ...next];
    } else {
      current.points = [current.origin, next.at(-1) ?? current.origin];
    }
    gesture = { ...current };
  }

  function onPointerUp(event: PointerEvent) {
    const current = gesture;
    if (!current || event.pointerId !== current.pointerId) return;
    gesture = null;
    releaseCapture(current.pointerId);
    const end = local(event);
    const points =
      current.tool === 'pen'
        ? [...current.points, end]
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
      const ok =
        (await current.down) &&
        (await transport
          .gesture({
            sessionId: current.sessionId,
            sequence: current.sequence,
            tool: current.tool,
            origin: current.origin,
            points,
          })
          .then(
            (ack) => ack.ok,
            () => false,
          ));
      settle(key, ok);
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
      const target = captureTarget();
      if (target?.hasPointerCapture(pointerId)) target.releasePointerCapture(pointerId);
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
    cancel();
    if (typeof window === 'undefined') return;
    window.removeEventListener('blur', cancel);
    document.removeEventListener('visibilitychange', onVisibility);
  });

  // ---------------------------------------------------------------------------
  // Drawing helpers
  // ---------------------------------------------------------------------------

  const BADGE = 18;

  function badgeCenter(geometry: DockMarkGeometry): DockImagePoint {
    const rect = dockGeometryRect(geometry);
    const bounds = framed ? overlay?.still : overlay?.display;
    const width = bounds?.width ?? Infinity;
    const height = bounds?.height ?? Infinity;
    const half = (BADGE / 2) * unit;
    return {
      x: Math.min(width - half, Math.max(half, rect.x + rect.w)),
      y: Math.min(height - half, Math.max(half, rect.y)),
    };
  }

  function pathData(points: readonly DockImagePoint[]): string {
    return points
      .map((p, index) => `${index ? 'L' : 'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
      .join(' ');
  }

  function arrowHead(from: DockImagePoint, to: DockImagePoint): string {
    const angle = Math.atan2(to.y - from.y, to.x - from.x);
    const size = 11 * unit;
    const spread = Math.PI / 7;
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
      '<circle cx="12" cy="12" r="6.5" fill="none" stroke="#080808" stroke-width="3.5"/><circle cx="12" cy="12" r="6.5" fill="none" stroke="#DDEC61" stroke-width="1.5"/><circle cx="12" cy="12" r="1.6" fill="#DDEC61" stroke="#080808" stroke-width="0.8"/>',
    ),
    box: cursor(
      '<path d="M12 4v16M4 12h16" stroke="#080808" stroke-width="3.5"/><path d="M12 4v16M4 12h16" stroke="#DDEC61" stroke-width="1.5"/><rect x="15" y="15" width="6" height="6" rx="1" fill="none" stroke="#DDEC61" stroke-width="1.5"/>',
    ),
    pen: cursor(
      '<circle cx="12" cy="12" r="3.2" fill="#DDEC61" stroke="#080808" stroke-width="1.4"/>',
    ),
    arrow: cursor(
      '<path d="M12 4v16M4 12h16" stroke="#080808" stroke-width="3.5"/><path d="M12 4v16M4 12h16" stroke="#DDEC61" stroke-width="1.5"/><path d="M15 21l6-6M17 15h4v4" fill="none" stroke="#DDEC61" stroke-width="1.5" stroke-linecap="round"/>',
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
      stroke-width={2 * unit}
    />
  {:else if geometry.kind === 'arrow'}
    <path
      d={`M${geometry.from.x} ${geometry.from.y} L${geometry.to.x} ${geometry.to.y} ${arrowHead(geometry.from, geometry.to)}`}
      class="dock-annotation-stroke"
      stroke-width={2.5 * unit}
    />
  {:else}
    <path d={pathData(geometry.points)} class="dock-annotation-stroke" stroke-width={2.5 * unit} />
  {/if}
{/snippet}

{#snippet canvas()}
  {#each marks as mark (mark.n + ':' + JSON.stringify(mark.geometry))}
    {@const badge = badgeCenter(mark.overlay)}
    <g
      class="dock-annotation-mark"
      data-mark={mark.n}
      in:scale={{ tier: 'fast' }}
      out:fade={{ tier: 'fast' }}
    >
      {@render shape(mark.overlay, mark.tool)}
      <circle
        cx={badge.x}
        cy={badge.y}
        r={(BADGE / 2) * unit}
        class="dock-annotation-badge"
        stroke-width={unit}
      />
      <text x={badge.x} y={badge.y} class="dock-annotation-badge-text" font-size={11 * unit}
        >{mark.n}</text
      >
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
          r={9 * unit}
          class="dock-annotation-stroke"
          stroke-width={2 * unit}
        />
      {/if}
    </g>
  {/each}

  {#if draft && gesture}
    <g class="dock-annotation-draft">
      {@render shape(draft, gesture.tool)}
    </g>
  {/if}
{/snippet}

{#snippet toolbar(state: DockAnnotationOverlayState, inFrame: boolean)}
  <!-- Annotate sessions only: dictation clicks need no tools. -->
  {#if state.mode !== 'dictation' && transport.toolbar && state.workArea}
    <DockAnnotationToolbar
      overlay={state}
      framed={inFrame}
      send={(request) => void transport.toolbar?.(request).catch(() => false)}
    />
  {/if}
{/snippet}

{#if framed && overlay?.still}
  <!-- Mark up: a window framing the still, zoomable like image previews, tools below.
       The frame itself moves the window. -->
  <div
    class="dock-annotation-frame"
    data-testid="dock-annotation-overlay"
    data-mode="still"
    data-tool={overlay.tool}
    transition:fade={{ tier: 'fast' }}
  >
    <div
      class="dock-annotation-stage"
      bind:clientWidth={stageWidth}
      bind:clientHeight={stageHeight}
    >
      {#if stillFit}
        <ZoomPanViewport wheelPans minZoom={1} maxZoom={8} onScaleChange={(next) => (zoom = next)}>
          <div
            bind:this={surface}
            class="dock-annotation-surface"
            data-testid="dock-annotation-surface"
            style:width="{overlay.still.width * stillFit}px"
            style:height="{overlay.still.height * stillFit}px"
            style:margin-bottom="{DOCK_STILL_FRAME.zoomBar}px"
            style:cursor={CURSORS[overlay.tool]}
            role="presentation"
            onpointerdown={onPointerDown}
            onpointermove={onPointerMove}
            onpointerup={onPointerUp}
            onpointercancel={cancel}
            onlostpointercapture={onLostCapture}
          >
            {#if stillUrl}
              <img class="dock-annotation-still" src={stillUrl} alt="" draggable="false" />
            {/if}
            <svg
              class="dock-annotation-canvas"
              viewBox={`0 0 ${overlay.still.width} ${overlay.still.height}`}
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              {@render canvas()}
            </svg>
          </div>
        </ZoomPanViewport>
      {/if}
    </div>
    <div class="dock-annotation-frame-tools">
      {@render toolbar(overlay, true)}
    </div>
  </div>
{:else}
  <div
    bind:this={root}
    class="dock-annotation-overlay"
    data-testid="dock-annotation-overlay"
    data-mode={overlay?.mode ?? 'idle'}
    data-tool={overlay?.tool ?? ''}
    style:cursor={overlay && !overlay.mouse ? CURSORS[overlay.tool] : 'default'}
    role="presentation"
    onpointerdown={onPointerDown}
    onpointermove={onPointerMove}
    onpointerup={onPointerUp}
    onpointercancel={cancel}
    onlostpointercapture={onLostCapture}
  >
    {#if overlay}
      <div class="dock-annotation-edge" transition:fade={{ tier: 'fast' }}></div>
      <svg
        class="dock-annotation-canvas"
        width={overlay.display.width}
        height={overlay.display.height}
        viewBox={`0 0 ${overlay.display.width} ${overlay.display.height}`}
        aria-hidden="true"
      >
        {@render canvas()}
      </svg>
      {@render toolbar(overlay, false)}
    {/if}
  </div>
{/if}

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

  /* Mark up window: the dock's dark card; its bare frame drags the window. */
  .dock-annotation-frame {
    position: fixed;
    inset: 0;
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 12px 12px 0;
    overflow: hidden;
    border-radius: 16px;
    border: 1px solid hsl(var(--theme-dark-border));
    background: hsl(var(--theme-dark-surface-3));
    color: hsl(var(--theme-dark-foreground));
    user-select: none;
    -webkit-user-select: none;
    -webkit-app-region: drag;
  }

  .dock-annotation-stage {
    position: relative;
    flex: 1;
    min-height: 0;
    overflow: hidden;
    border-radius: 10px;
    background: hsl(var(--theme-dark-surface-1));
    -webkit-app-region: no-drag;
  }

  .dock-annotation-surface {
    position: relative;
    flex: none;
    touch-action: none;
  }

  .dock-annotation-still {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
  }

  .dock-annotation-frame-tools {
    display: flex;
    flex: none;
    justify-content: center;
    height: 52px;
  }

  .dock-annotation-stroke {
    fill: none;
    stroke: hsl(var(--primary));
    stroke-linecap: round;
    stroke-linejoin: round;
    filter: drop-shadow(0 0 1px hsl(var(--background) / 0.65));
  }

  .dock-annotation-mark {
    transform-box: fill-box;
    transform-origin: center;
  }

  .dock-annotation-badge {
    fill: hsl(var(--primary));
    stroke: hsl(var(--primary-foreground));
  }

  .dock-annotation-badge-text {
    fill: hsl(var(--primary-foreground));
    font-weight: 600;
    font-variant-numeric: tabular-nums;
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
