<script lang="ts">
  import { cubicOut } from 'svelte/easing';
  import { onMount } from 'svelte';
  import { formatInteger } from '$lib/i18n/format';
  import { m } from '$shared/paraglide/messages.js';
  import type { MapActivityKind } from './core/types';
  import { lerpGeometry } from './layout/interpolate';
  import type { RegionGeometry } from './layout/place';
  import { CanvasPathCache, drawQuadraticPath, traceHull } from './render/canvas';
  import { layoutSceneLabels, type LabelLayout, type PlacedLabel } from './render/labels';
  import { moveSpatialFocus, type SpatialArrowKey, type SpatialTarget } from './render/navigation';
  import { buildScene, HEAT_BAND_ALPHA, hitRouteEdge, routeEdgePresentation } from './render/scene';
  import type {
    ActivityMark,
    ActivityTick,
    AgentBadge,
    AgentTrail,
    RouteEdge,
    SemanticMapCanvasProps,
  } from './render/types';

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
  const showMinimap = $derived(width >= 768 && height >= 240);
  type KeyboardLayer = 'agents' | 'crossings' | 'regions';

  interface CanvasColors {
    background: string;
    surface: string;
    popover: string;
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
  let keyboardLayer: KeyboardLayer = $state('regions');
  let keyboardRegionId: string | null = $state(null);
  let keyboardBadgeId: string | null = $state(null);
  let keyboardEdgeIndex: number | null = $state(null);
  let pointer = $state({ x: 0, y: 0 });
  let panning = $state(false);
  let transform = $state({ x: 0, y: 0, scale: 1 });
  let colors = $state<CanvasColors>({
    background: '#ffffff',
    surface: '#ffffff',
    popover: '#ffffff',
    muted: '#f4f4f5',
    border: '#d4d4d8',
    foreground: '#18181b',
    mutedForeground: '#71717a',
    accent: '#8b5cf6',
  });
  let darkMode = $state(false);

  let reducedMotion = false;
  let currentGeometry: RegionGeometry[] = geometry.rest;
  let targetGeometry: RegionGeometry[] = geometry.rest;
  let tweenFrom: RegionGeometry[] = geometry.rest;
  let tweenStartedAt = 0;
  let tweening = false;
  const pathCache = new CanvasPathCache();
  const minimapPathCache = new CanvasPathCache();
  let labelLayout: LabelLayout = { regions: [], edges: [], pips: [], badges: [], boxes: [] };
  let hatchPattern: CanvasPattern | null = null;
  let animationFrame: number | null = null;
  let sceneStartedAt = 0;
  let pauseStartedAt: number | null = null;
  let pixelRatio = 1;
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
      geometry: selection ? geometry.focus : geometry.rest,
      route,
      dark: darkMode,
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
  const keyboardBadge = $derived(scene.badges.find(({ id }) => id === keyboardBadgeId));
  const keyboardEdge = $derived(
    keyboardEdgeIndex === null ? undefined : scene.edges[keyboardEdgeIndex],
  );
  const agentSummaries = $derived.by(() =>
    scene.badges.map((badge) => {
      const agentActivities = scene.activities.filter(({ agentId }) => agentId === badge.id);
      const latest = agentActivities.at(-1);
      const latestRegionActivity = agentActivities.findLast(({ regionId }) => !!regionId);
      const region = manifest.regions.find(({ id }) => id === latestRegionActivity?.regionId);
      const count = agentActivities.filter(({ kind }) => kind === 'edit').length;
      const params = {
        name: badge.name,
        activity: activitySummaryLabel(latest?.kind ?? badge.kind),
        count: formatInteger(count),
      };
      return {
        id: badge.id,
        text: region
          ? count === 1
            ? m.semanticMap_canvas_agentSummaryInRegion_one({ ...params, region: region.label })
            : m.semanticMap_canvas_agentSummaryInRegion_many({ ...params, region: region.label })
          : count === 1
            ? m.semanticMap_canvas_agentSummary_one(params)
            : m.semanticMap_canvas_agentSummary_many(params),
      };
    }),
  );
  const selectionDescription = $derived.by(() => {
    if (
      keyboardRegion &&
      selection?.type === 'region' &&
      selection.regionIds.includes(keyboardRegion.id)
    )
      return m.semanticMap_canvas_regionSelected_description({ label: keyboardRegion.label });
    if (keyboardBadge && selection?.type === 'agent' && selection.agentId === keyboardBadge.id)
      return m.semanticMap_canvas_agentSelected_description({ name: keyboardBadge.name });
    if (
      keyboardEdge &&
      selection?.type === 'route' &&
      (selection.transitionIndex === undefined || selection.transitionIndex === keyboardEdgeIndex)
    )
      return m.semanticMap_canvas_crossingSelected_description({ label: keyboardEdge.label });
    if (keyboardRegion)
      return m.semanticMap_canvas_regionFocused_description({ label: keyboardRegion.label });
    if (keyboardBadge)
      return m.semanticMap_canvas_agentFocused_description({ name: keyboardBadge.name });
    if (keyboardEdge)
      return m.semanticMap_canvas_crossingFocused_description({ label: keyboardEdge.label });
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

  function activitySummaryLabel(kind: MapActivityKind): string {
    return {
      read: m.semanticMap_canvas_activityReading_label(),
      edit: m.semanticMap_canvas_activityEditing_label(),
      tool: m.semanticMap_canvas_activityUsingTools_label(),
      thinking: m.semanticMap_canvas_activityThinking_label(),
      create: m.semanticMap_canvas_activityCreating_label(),
      delete: m.semanticMap_canvas_activityDeleting_label(),
      move: m.semanticMap_canvas_activityMoving_label(),
    }[kind];
  }

  function cssValue(style: CSSStyleDeclaration, name: string, fallback: string): string {
    return style.getPropertyValue(name).trim() || fallback;
  }

  let uiFont = 'sans-serif';
  let badgeForeground = '#18181b';

  function resolveColors(): void {
    if (!container) return;
    const style = getComputedStyle(container);
    darkMode = style.colorScheme === 'dark';
    uiFont = cssValue(style, '--font-ui', 'sans-serif');
    badgeForeground = `hsl(${cssValue(style, '--agent-avatar-foreground', '0 0% 0%')})`;
    colors = {
      background: cssValue(style, '--color-background', '#ffffff'),
      surface: cssValue(style, '--color-card', '#ffffff'),
      popover: cssValue(style, '--color-popover', '#ffffff'),
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
    scheduleDraw();
  }

  function createHatchPattern(): void {
    const context = canvas?.getContext('2d');
    if (!context) return;
    const period = 10;
    const tile = document.createElement('canvas');
    tile.width = Math.round(period * pixelRatio);
    tile.height = Math.round(period * pixelRatio);
    const tileContext = tile.getContext('2d');
    if (!tileContext) return;
    tileContext.scale(pixelRatio, pixelRatio);
    tileContext.strokeStyle = colors.border;
    tileContext.lineWidth = 1;
    tileContext.beginPath();
    tileContext.moveTo(-1, period - 1);
    tileContext.lineTo(period - 1, -1);
    tileContext.moveTo(4, period + 4);
    tileContext.lineTo(period + 4, 4);
    tileContext.stroke();
    const pattern = context.createPattern(tile, 'repeat');
    pattern?.setTransform(new DOMMatrix().scale(1 / pixelRatio));
    hatchPattern = pattern;
  }

  function syncCanvasBackingStore(): void {
    if (!canvas) return;
    pixelRatio = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * pixelRatio);
    canvas.height = Math.round(height * pixelRatio);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    createHatchPattern();
    scheduleDraw();
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
    tweenStartedAt = pauseStartedAt ?? performance.now();
    tweening = true;
    ensureAnimationFrame();
  }

  function refreshRenderCaches(next: RegionGeometry[]): void {
    pathCache.update(next, scene.edges);
    minimapPathCache.update(geometry.rest, []);
    labelLayout = layoutSceneLabels({
      regions: next,
      regionLabels: new Map(manifest.regions.map(({ id, label }) => [id, label])),
      edges: scene.edges,
      badges: scene.badges,
      width,
      height,
      scale: transform.scale,
      heatByRegion: scene.heatByRegion,
      revealedRegionIds: new Set([
        ...(selection?.type === 'region' ? selection.regionIds : []),
        ...(hoveredRegionId ? [hoveredRegionId] : []),
        ...(keyboardRegionId ? [keyboardRegionId] : []),
      ]),
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
    const highlighted = hoveredRegionId === region.id || selectedRegionIds.has(region.id);
    const cachedPath = path && !tweening;
    const regionAlpha = isUnsorted ? 0.46 : 1;
    ctx.save();
    ctx.globalAlpha = regionAlpha;
    ctx.fillStyle = selectedRegionIds.has(region.id) ? colors.surface : colors.background;
    if (cachedPath) {
      ctx.fill(path);
    } else {
      ctx.beginPath();
      traceHull(ctx, region.hull);
      ctx.fill();
    }
    const heatBand = scene.heatByRegion[region.id] ?? 0;
    if (heatBand > 0) {
      ctx.globalAlpha = regionAlpha * HEAT_BAND_ALPHA[heatBand];
      ctx.fillStyle = colors.foreground;
      cachedPath ? ctx.fill(path) : ctx.fill();
    }
    if (hatchPattern && (!selectedRegionIds.has(region.id) || heatBand > 0)) {
      ctx.globalAlpha = regionAlpha;
      ctx.fillStyle = hatchPattern;
      cachedPath ? ctx.fill(path) : ctx.fill();
    }
    ctx.globalAlpha = regionAlpha;
    ctx.strokeStyle = highlighted ? colors.accent : colors.border;
    ctx.lineWidth = (highlighted ? 2 : 1) / transform.scale;
    ctx.setLineDash(isUnsorted ? [6 / transform.scale, 5 / transform.scale] : []);
    cachedPath ? ctx.stroke(path) : ctx.stroke();
    if (keyboardRegionId === region.id) {
      ctx.setLineDash([]);
      ctx.strokeStyle = colors.background;
      ctx.lineWidth = 7 / transform.scale;
      cachedPath ? ctx.stroke(path) : ctx.stroke();
      ctx.strokeStyle = colors.accent;
      ctx.lineWidth = 2 / transform.scale;
      ctx.setLineDash([3 / transform.scale, 3 / transform.scale]);
      cachedPath ? ctx.stroke(path) : ctx.stroke();
    }
    ctx.restore();
  }

  function drawTrails(ctx: CanvasRenderingContext2D, trails: AgentTrail[]): void {
    for (const trail of trails) {
      for (let index = 1; index < trail.points.length; index += 1) {
        const from = trail.points[index - 1];
        const to = trail.points[index];
        ctx.save();
        ctx.strokeStyle = trail.color;
        ctx.fillStyle = trail.color;
        ctx.globalAlpha = to.alpha;
        ctx.lineWidth = 1.5 / transform.scale;
        ctx.beginPath();
        ctx.moveTo(from.x, from.y);
        ctx.lineTo(to.x, to.y);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(from.x, from.y, 2.5 / transform.scale, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }
  }

  function drawTick(ctx: CanvasRenderingContext2D, tick: ActivityTick): void {
    const label = formatInteger(tick.count);
    ctx.save();
    ctx.font = `600 ${12 / transform.scale}px ${uiFont}`;
    const width = Math.max(
      18 / transform.scale,
      ctx.measureText(label).width + 9 / transform.scale,
    );
    const height = 16 / transform.scale;
    ctx.translate(tick.x, tick.y);
    ctx.fillStyle = colors.surface;
    ctx.strokeStyle = tick.color;
    ctx.lineWidth = 2 / transform.scale;
    ctx.beginPath();
    ctx.roundRect(-width / 2, -height / 2, width, height, 5 / transform.scale);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = colors.foreground;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, 0, 0);
    ctx.restore();
  }

  function drawRegionLabel(ctx: CanvasRenderingContext2D, label: PlacedLabel): void {
    ctx.save();
    ctx.globalAlpha = label.opacity;
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
    ctx.restore();
  }

  function drawRoute(ctx: CanvasRenderingContext2D, edges: RouteEdge[]): void {
    edges.forEach((edge, index) => {
      const presentation = routeEdgePresentation(index, selection, hoveredEdgeIndex);
      ctx.save();
      ctx.strokeStyle = presentation.accented ? colors.accent : colors.mutedForeground;
      ctx.fillStyle = presentation.accented ? colors.accent : colors.mutedForeground;
      ctx.globalAlpha = presentation.opacity;
      ctx.lineWidth = (1.5 + Math.sqrt(Math.max(1, edge.count))) / transform.scale;
      const path = pathCache.routes[index];
      if (path) ctx.stroke(path);
      else {
        drawQuadraticPath(ctx, edge);
        ctx.stroke();
      }
      const arrowSize = 7 / transform.scale;
      ctx.translate(edge.arrowX, edge.arrowY);
      ctx.rotate(edge.arrowAngle);
      ctx.beginPath();
      ctx.moveTo(arrowSize, 0);
      ctx.lineTo(-arrowSize, arrowSize * 0.62);
      ctx.lineTo(-arrowSize, -arrowSize * 0.62);
      ctx.closePath();
      ctx.fill();
      ctx.rotate(-edge.arrowAngle);
      ctx.translate(-edge.arrowX, -edge.arrowY);
      if (keyboardEdgeIndex === index) {
        ctx.globalAlpha = 1;
        ctx.setLineDash([]);
        ctx.strokeStyle = colors.background;
        ctx.lineWidth = 8 / transform.scale;
        path ? ctx.stroke(path) : (drawQuadraticPath(ctx, edge), ctx.stroke());
        ctx.strokeStyle = colors.accent;
        ctx.lineWidth = 2 / transform.scale;
        ctx.setLineDash([4 / transform.scale, 3 / transform.scale]);
        path ? ctx.stroke(path) : (drawQuadraticPath(ctx, edge), ctx.stroke());
      }
      ctx.restore();
    });
  }

  function drawRouteLabels(ctx: CanvasRenderingContext2D): void {
    for (const label of labelLayout.edges) {
      ctx.save();
      ctx.fillStyle = colors.popover;
      ctx.strokeStyle = colors.border;
      ctx.lineWidth = 1 / transform.scale;
      ctx.beginPath();
      ctx.roundRect(
        label.x - label.width / 2,
        label.y - label.height / 2,
        label.width,
        label.height,
        5 / transform.scale,
      );
      ctx.fill();
      ctx.stroke();
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
    for (const label of labelLayout.pips) {
      const index = Number(label.id.slice('pip-'.length));
      const presentation = routeEdgePresentation(index, selection, hoveredEdgeIndex);
      ctx.save();
      ctx.globalAlpha = presentation.opacity;
      ctx.fillStyle = colors.popover;
      ctx.strokeStyle = presentation.accented ? colors.accent : colors.mutedForeground;
      ctx.lineWidth = 2 / transform.scale;
      ctx.beginPath();
      ctx.arc(label.x, label.y, label.width / 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = colors.foreground;
      ctx.font = `600 ${label.fontSize}px ${uiFont}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label.text, label.x, label.y);
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

  function drawBadgeActivityCue(ctx: CanvasRenderingContext2D, badge: AgentBadge): void {
    ctx.save();
    ctx.strokeStyle = badge.color;
    ctx.fillStyle = colors.surface;
    ctx.lineWidth = 2 / transform.scale;
    if (badge.thinking) {
      ctx.setLineDash([3 / transform.scale, 2 / transform.scale]);
      ctx.beginPath();
      ctx.arc(badge.x, badge.y, (BADGE_RADIUS + 4) / transform.scale, 0, Math.PI * 2);
      ctx.stroke();
    } else if (badge.toolAgeMs !== undefined) {
      ctx.translate(
        badge.x + BADGE_RADIUS / transform.scale,
        badge.y - BADGE_RADIUS / transform.scale,
      );
      ctx.rotate(Math.PI / 4);
      const size = 7 / transform.scale;
      ctx.fillRect(-size / 2, -size / 2, size, size);
      ctx.strokeRect(-size / 2, -size / 2, size, size);
    }
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
    ctx.font = `600 ${12 / transform.scale}px ${uiFont}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(badge.name.slice(0, 1).toUpperCase(), badge.x, badge.y);
    ctx.restore();
    if (keyboardBadgeId === badge.id) {
      ctx.save();
      ctx.strokeStyle = colors.background;
      ctx.lineWidth = 6 / transform.scale;
      ctx.beginPath();
      ctx.arc(badge.x, badge.y, (BADGE_RADIUS + 5) / transform.scale, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = colors.accent;
      ctx.lineWidth = 2 / transform.scale;
      ctx.setLineDash([3 / transform.scale, 3 / transform.scale]);
      ctx.stroke();
      ctx.restore();
    }
    drawBadgeActivityCue(ctx, badge);
    if (!reducedMotion) drawToolPulse(ctx, badge, elapsed);
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
      ctx.fillStyle = colors.mutedForeground;
      ctx.globalAlpha = 0.25 + (scene.heatByRegion[region.id] ?? 0) * 0.75;
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(MINIMAP_WIDTH / width, MINIMAP_HEIGHT / height);
      const hull = minimapPathCache.hulls.get(region.id);
      if (hull) ctx.fill(hull);
      ctx.restore();
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
    const elapsed = Math.max(0, now - sceneStartedAt);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.scale(pixelRatio, pixelRatio);
    ctx.fillStyle = colors.background;
    ctx.fillRect(0, 0, width, height);
    ctx.save();
    ctx.translate(transform.x, transform.y);
    ctx.scale(transform.scale, transform.scale);
    currentGeometry.forEach((region) => drawRegion(ctx, region, pathCache.hulls.get(region.id)));
    drawTrails(ctx, scene.trails);
    drawRoute(ctx, scene.edges);
    scene.marks.forEach((mark) => drawMark(ctx, mark, elapsed));
    labelLayout.regions.forEach((label) => drawRegionLabel(ctx, label));
    drawRouteLabels(ctx);
    scene.ticks.forEach((tick) => drawTick(ctx, tick));
    labelLayout.badges.forEach((badge) => drawBadge(ctx, badge, now, elapsed));
    ctx.restore();
    if (showMinimap) drawMinimap(ctx);
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
      (!reducedMotion &&
        scene.badges.some((badge) => (badge.toolAgeMs ?? Infinity) + elapsed < TOOL_DURATION_MS))
    );
  }

  function ensureAnimationFrame(): void {
    if (animationFrame !== null || document.hidden) return;
    animationFrame = requestAnimationFrame((now) => {
      animationFrame = null;
      drawScheduled = false;
      draw(now);
      if (hasActiveMotion(Math.max(0, now - sceneStartedAt))) ensureAnimationFrame();
    });
  }

  function scheduleDraw(): void {
    if (drawScheduled || document.hidden) return;
    drawScheduled = true;
    ensureAnimationFrame();
  }

  function hullContainsPoint(hull: [number, number][], x: number, y: number): boolean {
    let inside = false;
    for (let index = 0, previous = hull.length - 1; index < hull.length; previous = index++) {
      const currentPoint = hull[index];
      const previousPoint = hull[previous];
      const crossesRay =
        currentPoint[1] > y !== previousPoint[1] > y &&
        x <
          ((previousPoint[0] - currentPoint[0]) * (y - currentPoint[1])) /
            (previousPoint[1] - currentPoint[1]) +
            currentPoint[0];
      if (crossesRay) inside = !inside;
    }
    return inside;
  }

  function regionAtPoint(x: number, y: number): RegionGeometry | undefined {
    for (let index = currentGeometry.length - 1; index >= 0; index -= 1) {
      const region = currentGeometry[index];
      if (hullContainsPoint(region.hull, x, y)) return region;
    }
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
        : (regionAtPoint(world.x, world.y)?.id ?? null);
  }

  function handleVisibilityChange(): void {
    const now = performance.now();
    if (document.hidden) {
      pauseStartedAt ??= now;
      if (animationFrame !== null) cancelAnimationFrame(animationFrame);
      animationFrame = null;
      drawScheduled = false;
      return;
    }
    if (pauseStartedAt !== null) {
      const pausedFor = now - pauseStartedAt;
      sceneStartedAt += pausedFor;
      if (tweening) tweenStartedAt += pausedFor;
      pauseStartedAt = null;
    }
    scheduleDraw();
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
      clearKeyboardFocus();
      if (hoveredBadgeId) onSelectAgent?.(hoveredBadgeId);
      else if (hoveredEdgeIndex !== null) onSelectRoute?.(hoveredEdgeIndex);
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

  function availableKeyboardLayers(): KeyboardLayer[] {
    return [
      'regions',
      ...(scene.badges.length > 0 ? (['agents'] as const) : []),
      ...(scene.edges.length > 0 ? (['crossings'] as const) : []),
    ];
  }

  function edgeTarget(edge: RouteEdge, index: number): SpatialTarget {
    return {
      id: String(index),
      x: edge.startX * 0.25 + edge.controlX * 0.5 + edge.endX * 0.25,
      y: edge.startY * 0.25 + edge.controlY * 0.5 + edge.endY * 0.25,
    };
  }

  function focusInLayer(layer: KeyboardLayer, key: SpatialArrowKey): void {
    if (layer === 'regions') {
      keyboardRegionId = moveSpatialFocus(geometry.rest, keyboardRegionId, key);
    } else if (layer === 'agents') {
      keyboardBadgeId = moveSpatialFocus(scene.badges, keyboardBadgeId, key);
    } else {
      const next = moveSpatialFocus(scene.edges.map(edgeTarget), String(keyboardEdgeIndex), key);
      keyboardEdgeIndex = next === null ? null : Number(next);
    }
  }

  function clearKeyboardFocus(): void {
    keyboardRegionId = null;
    keyboardBadgeId = null;
    keyboardEdgeIndex = null;
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      clearKeyboardFocus();
      onClearSelection?.();
      return;
    }
    if (event.key === 'Tab') {
      const layers = availableKeyboardLayers();
      const current = layers.indexOf(keyboardLayer);
      const next = current + (event.shiftKey ? -1 : 1);
      if (next < 0 || next >= layers.length) return;
      event.preventDefault();
      clearKeyboardFocus();
      keyboardLayer = layers[next];
      focusInLayer(keyboardLayer, event.shiftKey ? 'ArrowLeft' : 'ArrowRight');
      return;
    }
    if (event.key.startsWith('Arrow')) {
      event.preventDefault();
      focusInLayer(keyboardLayer, event.key as SpatialArrowKey);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      if (keyboardLayer === 'regions' && keyboardRegionId) onSelectRegion?.([keyboardRegionId]);
      else if (keyboardLayer === 'agents' && keyboardBadgeId) onSelectAgent?.(keyboardBadgeId);
      else if (keyboardLayer === 'crossings' && keyboardEdgeIndex !== null)
        onSelectRoute?.(keyboardEdgeIndex);
    }
  }

  $effect(() => {
    if (!canvas) return;
    syncCanvasBackingStore();
  });

  $effect(() => {
    if (!canvas) return;
    const next = selection ? geometry.focus : geometry.rest;
    startGeometryTween(next);
  });

  $effect(() => {
    void scene;
    sceneStartedAt = pauseStartedAt ?? performance.now();
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
    void keyboardBadgeId;
    void keyboardEdgeIndex;
    refreshRenderCaches(targetGeometry);
    scheduleDraw();
  });

  onMount(() => {
    pauseStartedAt = document.hidden ? performance.now() : null;
    resolveReducedMotion();
    resolveColors();
    container?.addEventListener('keydown', handleKeydown);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const handleMotionChange = () => resolveReducedMotion();
    motionQuery.addEventListener('change', handleMotionChange);
    let dprCleanup: (() => void) | undefined;
    const setupDprListener = () => {
      dprCleanup?.();
      const query = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
      const handleDprChange = () => {
        syncCanvasBackingStore();
        setupDprListener();
      };
      query.addEventListener('change', handleDprChange);
      dprCleanup = () => query.removeEventListener('change', handleDprChange);
    };
    setupDprListener();
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
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      motionQuery.removeEventListener('change', handleMotionChange);
      dprCleanup?.();
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
  data-semantic-map-minimap={showMinimap ? 'visible' : 'hidden'}
  data-semantic-map-keyboard-layer={keyboardLayer}
>
  <span class="sr-only" aria-live="polite">{selectionDescription}</span>
  <ul class="sr-only" aria-label={m.semanticMap_panel_filterAgents_label()}>
    {#each agentSummaries as summary (summary.id)}
      <li>{summary.text}</li>
    {/each}
  </ul>
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
      <div class="mt-1 text-muted-foreground">
        {m.semanticMap_detail_crossingCount_label({ count: formatInteger(hoveredEdge.count) })}
      </div>
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
