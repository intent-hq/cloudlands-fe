<script lang="ts">
  import { cubicOut } from 'svelte/easing';
  import { onMount } from 'svelte';
  import { formatInteger } from '$lib/i18n/format';
  import { m } from '$shared/paraglide/messages.js';
  import { lerpGeometry } from './layout/interpolate';
  import type { RegionGeometry } from './layout/place';
  import { CanvasPathCache, drawQuadraticPath, traceHull } from './render/canvas';
  import { layoutSceneLabels, type LabelLayout, type PlacedLabel } from './render/labels';
  import { buildScene, hitRouteEdge } from './render/scene';
  import type { ActivityMark, AgentBadge, RouteEdge, SemanticMapCanvasProps } from './render/types';

  let {
    manifest,
    geometry,
    activities,
    route,
    selection,
    filters,
    timeWindow,
    width,
    height,
    onSelectRegion,
    onSelectAgent,
    onSelectRoute,
    onClearSelection,
  }: SemanticMapCanvasProps = $props();

  const MIN_SCALE = 0.5;
  const MAX_SCALE = 4;
  const TWEEN_DURATION_MS = 300;
  const READ_DURATION_MS = 2_000;
  const MOVE_DURATION_MS = 1_000;
  const TOOL_DURATION_MS = 1_200;
  const BADGE_RADIUS = 13;
  const MINIMAP_WIDTH = 160;
  const MINIMAP_HEIGHT = 100;
  const MINIMAP_MARGIN = 16;
  const applicationAttributes = { role: 'application', tabindex: 0 } as const;

  interface CanvasColors {
    background: string;
    surface: string;
    muted: string;
    border: string;
    foreground: string;
    mutedForeground: string;
    accent: string;
  }

  let canvas: HTMLCanvasElement | null = $state(null);
  let container: HTMLDivElement | null = $state(null);
  let hoveredRegionId: string | null = $state(null);
  let hoveredEdgeIndex: number | null = $state(null);
  let hoveredBadgeId: string | null = $state(null);
  let keyboardRegionId: string | null = $state(null);
  let pointer = $state({ x: 0, y: 0 });
  let panning = $state(false);
  let transform = $state({ x: 0, y: 0, scale: 1 });
  let colors = $state<CanvasColors>({
    background: '#ffffff',
    surface: '#ffffff',
    muted: '#f4f4f5',
    border: '#d4d4d8',
    foreground: '#18181b',
    mutedForeground: '#71717a',
    accent: '#8b5cf6',
  });

  let reducedMotion = false;
  let currentGeometry: RegionGeometry[] = geometry.rest;
  let targetGeometry: RegionGeometry[] = geometry.rest;
  let tweenFrom: RegionGeometry[] = geometry.rest;
  let tweenStartedAt = 0;
  let tweening = false;
  const pathCache = new CanvasPathCache();
  let labelLayout: LabelLayout = { regions: [], edges: [], counts: [], badges: [], boxes: [] };
  let hatchPattern: CanvasPattern | null = null;
  let animationFrame: number | null = null;
  let sceneStartedAt = 0;
  let drawScheduled = false;
  let dragPointerId: number | null = null;
  let lastPointerX = 0;
  let lastPointerY = 0;
  let dragDistance = 0;

  const selectedRegionIds = $derived(
    selection?.type === 'region' ? new Set(selection.regionIds) : new Set<string>(),
  );
  const scene = $derived(
    buildScene({
      activities,
      filters,
      timeWindow,
      geometry: geometry.rest,
      route,
      neutral: colors.mutedForeground,
      fileLabel: routeFileLabel,
    }),
  );
  const hoveredRegion = $derived(manifest.regions.find(({ id }) => id === hoveredRegionId));
  const hoveredEdge = $derived(
    hoveredEdgeIndex === null ? undefined : scene.edges[hoveredEdgeIndex],
  );
  const hoveredBadge = $derived(scene.badges.find(({ id }) => id === hoveredBadgeId));
  const keyboardRegion = $derived(manifest.regions.find(({ id }) => id === keyboardRegionId));
  const selectionDescription = $derived.by(() => {
    if (keyboardRegion)
      return m.semanticMap_canvas_regionFocused_description({ label: keyboardRegion.label });
    if (selection?.type === 'region') {
      const label = manifest.regions.find(({ id }) => id === selection.regionIds[0])?.label;
      return label
        ? m.semanticMap_canvas_regionSelected_description({ label })
        : m.semanticMap_canvas_selectionNone_description();
    }
    if (selection?.type === 'agent') {
      const name =
        scene.badges.find(({ id }) => id === selection.agentId)?.name ?? selection.agentId;
      return m.semanticMap_canvas_agentSelected_description({ name });
    }
    if (selection?.type === 'route') return m.semanticMap_canvas_routeSelected_description();
    return m.semanticMap_canvas_selectionNone_description();
  });

  function routeFileLabel(count: number): string {
    return count === 1
      ? m.semanticMap_canvas_routeFiles_one()
      : m.semanticMap_canvas_routeFiles_many({ count: formatInteger(count) });
  }

  function cssValue(style: CSSStyleDeclaration, name: string, fallback: string): string {
    return style.getPropertyValue(name).trim() || fallback;
  }

  let uiFont = 'sans-serif';
  let badgeForeground = '#18181b';

  function resolveColors(): void {
    if (!container) return;
    const style = getComputedStyle(container);
    uiFont = cssValue(style, '--font-ui', 'sans-serif');
    badgeForeground = `hsl(${cssValue(style, '--agent-avatar-foreground', '0 0% 0%')})`;
    colors = {
      background: cssValue(style, '--color-background', '#ffffff'),
      surface: cssValue(style, '--color-card', '#ffffff'),
      muted: cssValue(style, '--color-muted', '#f4f4f5'),
      border: cssValue(style, '--color-border', '#d4d4d8'),
      foreground: cssValue(style, '--color-foreground', '#18181b'),
      mutedForeground: cssValue(style, '--color-muted-foreground', '#71717a'),
      accent: cssValue(style, '--color-primary', '#8b5cf6'),
    };
    createHatchPattern();
  }

  function resolveReducedMotion(): void {
    reducedMotion =
      document.documentElement.classList.contains('catalog-reduced-motion') ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reducedMotion) {
      currentGeometry = targetGeometry;
      tweening = false;
    }
  }

  function createHatchPattern(): void {
    const context = canvas?.getContext('2d');
    if (!context) return;
    const tile = document.createElement('canvas');
    tile.width = 8;
    tile.height = 8;
    const tileContext = tile.getContext('2d');
    if (!tileContext) return;
    tileContext.fillStyle = colors.background;
    tileContext.fillRect(0, 0, 8, 8);
    tileContext.strokeStyle = colors.muted;
    tileContext.beginPath();
    tileContext.moveTo(-2, 8);
    tileContext.lineTo(8, -2);
    tileContext.moveTo(4, 10);
    tileContext.lineTo(10, 4);
    tileContext.stroke();
    hatchPattern = context.createPattern(tile, 'repeat');
  }

  function startGeometryTween(next: RegionGeometry[]): void {
    targetGeometry = next;
    refreshRenderCaches(next);
    if (reducedMotion || currentGeometry.length !== next.length) {
      currentGeometry = next;
      tweening = false;
      scheduleDraw();
      return;
    }
    tweenFrom = currentGeometry;
    tweenStartedAt = performance.now();
    tweening = true;
    ensureAnimationFrame();
  }

  function refreshRenderCaches(next: RegionGeometry[]): void {
    pathCache.update(next, scene.edges);
    labelLayout = layoutSceneLabels({
      regions: next,
      regionLabels: new Map(manifest.regions.map(({ id, label }) => [id, label])),
      edges: scene.edges,
      badges: scene.badges,
      width,
      height,
      scale: transform.scale,
    });
  }

  function updateTween(now: number): void {
    if (!tweening) return;
    const progress = Math.min(1, (now - tweenStartedAt) / TWEEN_DURATION_MS);
    const eased = cubicOut(progress);
    currentGeometry = targetGeometry.map((target, index) =>
      lerpGeometry(tweenFrom[index] ?? target, target, eased),
    );
    if (progress >= 1) {
      currentGeometry = targetGeometry;
      tweening = false;
    }
  }

  function screenToWorld(screenX: number, screenY: number): { x: number; y: number } {
    return {
      x: (screenX - transform.x) / transform.scale,
      y: (screenY - transform.y) / transform.scale,
    };
  }

  function drawRegion(
    ctx: CanvasRenderingContext2D,
    region: RegionGeometry,
    path: Path2D | undefined,
  ): void {
    const isUnsorted = region.id.toLowerCase() === 'unsorted'; // i18n-ignore (wire identifier)
    const highlighted =
      hoveredRegionId === region.id ||
      keyboardRegionId === region.id ||
      selectedRegionIds.has(region.id);
    ctx.save();
    ctx.globalAlpha = isUnsorted ? 0.46 : 1;
    ctx.fillStyle = selectedRegionIds.has(region.id)
      ? colors.surface
      : (hatchPattern ?? colors.muted);
    ctx.strokeStyle = highlighted ? colors.accent : colors.border;
    ctx.lineWidth = (highlighted ? 2 : 1) / transform.scale;
    ctx.setLineDash(isUnsorted ? [6 / transform.scale, 5 / transform.scale] : []);
    if (path && !tweening) {
      ctx.fill(path);
      ctx.stroke(path);
    } else {
      ctx.beginPath();
      traceHull(ctx, region.hull);
      ctx.fill();
      ctx.stroke();
    }
    const heat = scene.heatByRegion[region.id] ?? 0;
    if (heat > 0) {
      ctx.globalAlpha = heat * 0.18;
      ctx.fillStyle = colors.mutedForeground;
      path && !tweening ? ctx.fill(path) : ctx.fill();
    }
    ctx.restore();
  }

  function drawRegionLabel(ctx: CanvasRenderingContext2D, label: PlacedLabel): void {
    ctx.fillStyle = colors.foreground;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `600 ${label.fontSize}px "Source Serif 4 Variable", Georgia, serif`;
    const lines = label.lines ?? [label.text];
    for (let index = 0; index < lines.length; index += 1) {
      ctx.fillText(
        lines[index],
        label.x,
        label.y + (index - (lines.length - 1) / 2) * (label.fontSize + 3),
        label.width,
      );
    }
  }

  function drawRoute(ctx: CanvasRenderingContext2D, edges: RouteEdge[]): void {
    edges.forEach((edge, index) => {
      const highlighted =
        hoveredEdgeIndex === index || selection?.type === 'route' || selection?.type === 'agent';
      ctx.save();
      ctx.strokeStyle = highlighted ? colors.accent : colors.mutedForeground;
      ctx.fillStyle = highlighted ? colors.accent : colors.mutedForeground;
      ctx.globalAlpha = highlighted ? 0.9 : 0.62;
      ctx.lineWidth = (1.5 + Math.sqrt(Math.max(1, edge.count))) / transform.scale;
      const path = pathCache.routes[index];
      if (path) ctx.stroke(path);
      else {
        drawQuadraticPath(ctx, edge);
        ctx.stroke();
      }
      ctx.restore();
    });
  }

  function drawRouteLabels(ctx: CanvasRenderingContext2D): void {
    for (const label of [...labelLayout.edges, ...labelLayout.counts]) {
      ctx.save();
      ctx.fillStyle = colors.background;
      ctx.fillRect(
        label.x - label.width / 2,
        label.y - label.height / 2,
        label.width,
        label.height,
      );
      ctx.fillStyle = colors.accent;
      ctx.font = `${label.fontSize}px ${uiFont}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const lines = label.lines ?? [label.text];
      for (let index = 0; index < lines.length; index += 1) {
        ctx.fillText(
          lines[index],
          label.x,
          label.y + (index - (lines.length - 1) / 2) * (label.fontSize + 3 / transform.scale),
          label.width,
        );
      }
      ctx.restore();
    }
  }

  function drawMark(ctx: CanvasRenderingContext2D, mark: ActivityMark, elapsed: number): void {
    const age = mark.ageMs + elapsed;
    ctx.save();
    ctx.strokeStyle = mark.color;
    ctx.fillStyle = mark.color;
    ctx.lineWidth = 2 / transform.scale;
    if (mark.kind === 'read') {
      const progress = Math.min(1, age / READ_DURATION_MS);
      ctx.globalAlpha = 1 - progress;
      ctx.beginPath();
      ctx.arc(mark.x, mark.y, 4 + progress * 14, 0, Math.PI * 2);
      ctx.stroke();
    } else if (mark.kind === 'move' && mark.fromX !== undefined && mark.fromY !== undefined) {
      const progress = Math.min(1, age / MOVE_DURATION_MS);
      const x = mark.fromX + (mark.x - mark.fromX) * cubicOut(progress);
      const y = mark.fromY + (mark.y - mark.fromY) * cubicOut(progress);
      ctx.globalAlpha = 1 - progress * 0.5;
      ctx.beginPath();
      ctx.moveTo(mark.fromX, mark.fromY);
      ctx.lineTo(mark.x, mark.y);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x, y, 4 / transform.scale, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.globalAlpha = mark.alpha;
      ctx.beginPath();
      ctx.arc(mark.x, mark.y, 4 / transform.scale, 0, Math.PI * 2);
      ctx.fill();
      if (mark.kind === 'delete') {
        ctx.beginPath();
        ctx.moveTo(mark.x - 6 / transform.scale, mark.y + 6 / transform.scale);
        ctx.lineTo(mark.x + 6 / transform.scale, mark.y - 6 / transform.scale);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  function drawToolPulse(ctx: CanvasRenderingContext2D, badge: AgentBadge, elapsed: number): void {
    const age = (badge.toolAgeMs ?? Infinity) + elapsed;
    if (age >= TOOL_DURATION_MS) return;
    const progress = age / TOOL_DURATION_MS;
    const radius = 6 + progress * 6;
    ctx.save();
    ctx.translate(badge.x + BADGE_RADIUS, badge.y - BADGE_RADIUS);
    ctx.rotate(Math.PI / 4);
    ctx.globalAlpha = 1 - progress;
    ctx.strokeStyle = badge.color;
    ctx.lineWidth = 2 / transform.scale;
    ctx.strokeRect(-radius / 2, -radius / 2, radius, radius);
    ctx.restore();
  }

  function drawBadge(
    ctx: CanvasRenderingContext2D,
    badge: AgentBadge,
    now: number,
    elapsed: number,
  ): void {
    const breathing = badge.thinking && !reducedMotion ? 1 + Math.sin(now / 420) * 0.08 : 1;
    const selected = selection?.type === 'agent' && selection.agentId === badge.id;
    ctx.save();
    ctx.fillStyle = badge.color;
    ctx.strokeStyle = selected || hoveredBadgeId === badge.id ? colors.accent : colors.background;
    ctx.lineWidth = (selected || hoveredBadgeId === badge.id ? 3 : 2) / transform.scale;
    ctx.beginPath();
    ctx.arc(badge.x, badge.y, (BADGE_RADIUS * breathing) / transform.scale, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = badgeForeground;
    ctx.font = `600 ${10 / transform.scale}px ${uiFont}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(badge.name.slice(0, 1).toUpperCase(), badge.x, badge.y);
    ctx.restore();
    drawToolPulse(ctx, badge, elapsed);
  }

  function drawMinimap(ctx: CanvasRenderingContext2D): void {
    const x = width - MINIMAP_WIDTH - MINIMAP_MARGIN;
    const y = height - MINIMAP_HEIGHT - MINIMAP_MARGIN;
    ctx.save();
    ctx.fillStyle = colors.surface;
    ctx.strokeStyle = colors.border;
    ctx.globalAlpha = 0.94;
    ctx.fillRect(x, y, MINIMAP_WIDTH, MINIMAP_HEIGHT);
    ctx.strokeRect(x + 0.5, y + 0.5, MINIMAP_WIDTH - 1, MINIMAP_HEIGHT - 1);
    for (const region of geometry.rest) {
      const dotX = x + (region.x / width) * MINIMAP_WIDTH;
      const dotY = y + (region.y / height) * MINIMAP_HEIGHT;
      ctx.fillStyle = colors.mutedForeground;
      ctx.globalAlpha = 0.25 + (scene.heatByRegion[region.id] ?? 0) * 0.75;
      ctx.beginPath();
      ctx.arc(dotX, dotY, Math.max(2, (region.radius / width) * MINIMAP_WIDTH), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.strokeStyle = colors.accent;
    ctx.globalAlpha = 0.8;
    ctx.lineWidth = 1;
    ctx.strokeRect(
      x + (-transform.x / transform.scale / width) * MINIMAP_WIDTH,
      y + (-transform.y / transform.scale / height) * MINIMAP_HEIGHT,
      (width / transform.scale / width) * MINIMAP_WIDTH,
      (height / transform.scale / height) * MINIMAP_HEIGHT,
    );
    ctx.restore();
  }

  function draw(now = performance.now()): void {
    if (!canvas) return;
    updateTween(now);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const elapsed = Math.max(0, now - sceneStartedAt);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.fillStyle = colors.background;
    ctx.fillRect(0, 0, width, height);
    ctx.save();
    ctx.translate(transform.x, transform.y);
    ctx.scale(transform.scale, transform.scale);
    currentGeometry.forEach((region) => drawRegion(ctx, region, pathCache.hulls.get(region.id)));
    drawRoute(ctx, scene.edges);
    scene.marks.forEach((mark) => drawMark(ctx, mark, elapsed));
    labelLayout.regions.forEach((label) => drawRegionLabel(ctx, label));
    drawRouteLabels(ctx);
    labelLayout.badges.forEach((badge) => drawBadge(ctx, badge, now, elapsed));
    ctx.restore();
    drawMinimap(ctx);
    ctx.restore();
  }

  function hasActiveMotion(elapsed: number): boolean {
    return (
      tweening ||
      (!reducedMotion && scene.badges.some((badge) => badge.thinking)) ||
      scene.marks.some((mark) =>
        mark.kind === 'read'
          ? mark.ageMs + elapsed < READ_DURATION_MS
          : mark.kind === 'move' && mark.ageMs + elapsed < MOVE_DURATION_MS,
      ) ||
      scene.badges.some((badge) => (badge.toolAgeMs ?? Infinity) + elapsed < TOOL_DURATION_MS)
    );
  }

  function ensureAnimationFrame(): void {
    if (animationFrame !== null) return;
    animationFrame = requestAnimationFrame((now) => {
      animationFrame = null;
      drawScheduled = false;
      draw(now);
      if (hasActiveMotion(Math.max(0, now - sceneStartedAt))) ensureAnimationFrame();
    });
  }

  function scheduleDraw(): void {
    if (drawScheduled) return;
    drawScheduled = true;
    ensureAnimationFrame();
  }

  function updateHover(screenX: number, screenY: number): void {
    const world = screenToWorld(screenX, screenY);
    hoveredBadgeId =
      labelLayout.badges.find(
        (badge) =>
          Math.hypot(badge.x - world.x, badge.y - world.y) <= BADGE_RADIUS / transform.scale,
      )?.id ?? null;
    hoveredEdgeIndex = hoveredBadgeId
      ? null
      : scene.edges.findIndex((edge) => hitRouteEdge(edge, world.x, world.y, 7 / transform.scale));
    if (hoveredEdgeIndex !== null && hoveredEdgeIndex < 0) hoveredEdgeIndex = null;
    hoveredRegionId =
      hoveredBadgeId || hoveredEdgeIndex !== null
        ? null
        : ([...currentGeometry]
            .reverse()
            .find((region) => Math.hypot(region.x - world.x, region.y - world.y) <= region.radius)
            ?.id ?? null);
  }

  function handlePointerDown(event: PointerEvent): void {
    if (!canvas || event.button !== 0) return;
    const rect = canvas.getBoundingClientRect();
    pointer = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    updateHover(pointer.x, pointer.y);
    dragPointerId = event.pointerId;
    lastPointerX = event.clientX;
    lastPointerY = event.clientY;
    dragDistance = 0;
    canvas.setPointerCapture(event.pointerId);
  }

  function handlePointerMove(event: PointerEvent): void {
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    pointer = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    if (dragPointerId === event.pointerId) {
      const dx = event.clientX - lastPointerX;
      const dy = event.clientY - lastPointerY;
      dragDistance += Math.hypot(dx, dy);
      if (dragDistance > 3) panning = true;
      if (panning) transform = { ...transform, x: transform.x + dx, y: transform.y + dy };
      lastPointerX = event.clientX;
      lastPointerY = event.clientY;
    } else {
      updateHover(pointer.x, pointer.y);
    }
  }

  function handlePointerUp(event: PointerEvent): void {
    if (dragPointerId !== event.pointerId) return;
    canvas?.releasePointerCapture(event.pointerId);
    dragPointerId = null;
    if (!panning && dragDistance <= 3) {
      if (hoveredBadgeId) onSelectAgent?.(hoveredBadgeId);
      else if (hoveredEdgeIndex !== null) onSelectRoute?.();
      else if (hoveredRegionId) onSelectRegion?.([hoveredRegionId]);
      else onClearSelection?.();
    }
    panning = false;
  }

  function handleWheel(event: WheelEvent): void {
    event.preventDefault();
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const nextScale = Math.max(
      MIN_SCALE,
      Math.min(MAX_SCALE, transform.scale * Math.exp(-event.deltaY * 0.001)),
    );
    const factor = nextScale / transform.scale;
    transform = {
      x: x - (x - transform.x) * factor,
      y: y - (y - transform.y) * factor,
      scale: nextScale,
    };
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      keyboardRegionId = null;
      onClearSelection?.();
      return;
    }
    if (event.key.startsWith('Arrow') && geometry.rest.length > 0) {
      event.preventDefault();
      const current = geometry.rest.findIndex(({ id }) => id === keyboardRegionId);
      const direction = event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1;
      const index =
        current < 0
          ? direction < 0
            ? geometry.rest.length - 1
            : 0
          : (current + direction + geometry.rest.length) % geometry.rest.length;
      keyboardRegionId = geometry.rest[index].id;
      return;
    }
    if (event.key === 'Enter' && keyboardRegionId) {
      event.preventDefault();
      onSelectRegion?.([keyboardRegionId]);
    }
  }

  $effect(() => {
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    createHatchPattern();
    scheduleDraw();
  });

  $effect(() => {
    if (!canvas) return;
    const next = selection ? geometry.focus : geometry.rest;
    startGeometryTween(next);
  });

  $effect(() => {
    void scene;
    sceneStartedAt = performance.now();
    refreshRenderCaches(targetGeometry);
    scheduleDraw();
  });

  $effect(() => {
    void colors;
    void transform;
    void hoveredRegionId;
    void hoveredEdgeIndex;
    void hoveredBadgeId;
    void keyboardRegionId;
    refreshRenderCaches(targetGeometry);
    scheduleDraw();
  });

  onMount(() => {
    resolveReducedMotion();
    resolveColors();
    container?.addEventListener('keydown', handleKeydown);
    const themeObserver = new MutationObserver(() => {
      resolveColors();
      resolveReducedMotion();
    });
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'data-theme', 'style'],
    });
    refreshRenderCaches(currentGeometry);
    scheduleDraw();
    return () => {
      container?.removeEventListener('keydown', handleKeydown);
      themeObserver.disconnect();
      if (animationFrame !== null) cancelAnimationFrame(animationFrame);
    };
  });
</script>

<div
  bind:this={container}
  class="relative overflow-hidden rounded-lg border border-border bg-background outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset"
  style="width: {width}px; height: {height}px;"
  {...applicationAttributes}
  aria-label={m.semanticMap_canvas_visualization_ariaLabel()}
  data-semantic-map-canvas
  data-semantic-map-width={width}
  data-semantic-map-height={height}
  data-semantic-map-agent-count={scene.badges.length}
>
  <span class="sr-only" aria-live="polite">{selectionDescription}</span>
  <canvas
    bind:this={canvas}
    class:cursor-grabbing={panning}
    class:cursor-grab={!panning}
    class="block"
    aria-hidden="true"
    onpointerdown={handlePointerDown}
    onpointermove={handlePointerMove}
    onpointerup={handlePointerUp}
    onpointercancel={handlePointerUp}
    onpointerleave={() => {
      hoveredRegionId = null;
      hoveredEdgeIndex = null;
      hoveredBadgeId = null;
    }}
    onwheel={handleWheel}
  ></canvas>

  {#if hoveredRegion}
    <div
      class="pointer-events-none absolute z-10 max-w-64 rounded-md border border-border bg-popover/95 px-3 py-2 text-xs shadow-lg"
      style="left: {Math.min(pointer.x + 12, width - 268)}px; top: {Math.min(
        pointer.y + 12,
        height - 90,
      )}px;"
    >
      <div class="font-medium text-foreground">{hoveredRegion.label}</div>
      <div class="mt-1 text-muted-foreground">{hoveredRegion.responsibility}</div>
    </div>
  {:else if hoveredEdge}
    <div
      class="pointer-events-none absolute z-10 max-w-80 rounded-md border border-border bg-popover/95 px-3 py-2 text-xs shadow-lg"
      style="left: {Math.min(pointer.x + 12, width - 332)}px; top: {Math.min(
        pointer.y + 12,
        height - 120,
      )}px;"
    >
      <div class="font-medium text-foreground">{hoveredEdge.label}</div>
      {#each hoveredEdge.evidence as path (path)}
        <div class="mt-1 truncate font-mono text-muted-foreground">{path}</div>
      {/each}
    </div>
  {:else if hoveredBadge}
    <div
      class="pointer-events-none absolute z-10 rounded-md border border-border bg-popover/95 px-2 py-1 text-xs text-foreground shadow-lg"
      style="left: {Math.min(pointer.x + 12, width - 180)}px; top: {Math.min(
        pointer.y + 12,
        height - 48,
      )}px;"
    >
      {hoveredBadge.name}
    </div>
  {/if}
</div>
