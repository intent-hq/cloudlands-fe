import { randomUUID } from 'node:crypto';
import { screen } from 'electron';
import type { BrowserWindow } from 'electron';
import {
  DEFAULT_DOCK_PLACEMENT,
  DOCK_FLOATING_COMPACT_SIZE,
  DOCK_FLOATING_SHADOW_MARGIN,
  DOCK_NOTCH_MIN_WING_WIDTH,
  DOCK_SURFACE_SIZES,
  dockLocalRect,
  dockShape,
  dockWindowEnvelope,
  findDockSnapTarget,
  floatingDockPlacement,
  getDockCompactNotchSize,
  parseDockPlacementPreference,
  resolveDockDisplay,
  resolveDockSurface,
  resolveDockSidePanelSurface,
  resolveFloatingDockGeometry,
  type DockDisplayGeometry,
  type DockPlacement,
  type DockPlacementCommand,
  type DockPlacementSnapshot,
} from '../shared/dock-placement';
import type { DockPointerRect } from '../shared/dock-layout';
import { WINDOW_CHANNELS } from '../shared/ipc/channels';
import { getLocalPref, setDockPlacementLocalPref } from './local-prefs';
import { readDockDisplayGeometry } from './dock-display-geometry';

interface RetainedEnvelope {
  displayId: number;
  bounds: DockPointerRect;
}

function unionEnvelopes(
  a: DockPointerRect,
  b: DockPointerRect,
  display: DockDisplayGeometry,
): DockPointerRect {
  const x = Math.max(display.bounds.x, Math.min(a.x, b.x));
  const y = Math.max(display.bounds.y, Math.min(a.y, b.y));
  const right = Math.min(
    display.bounds.x + display.bounds.width,
    Math.max(a.x + a.width, b.x + b.width),
  );
  const bottom = Math.min(
    display.bounds.y + display.bounds.height,
    Math.max(a.y + a.height, b.y + b.height),
  );
  return { x, y, width: Math.max(1, right - x), height: Math.max(1, bottom - y) };
}

function containsEnvelope(outer: DockPointerRect, inner: DockPointerRect): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

function sameSnapTarget(a: DockPlacement, b: DockPlacement): boolean {
  return (
    a.kind === b.kind &&
    a.displayId === b.displayId &&
    (a.kind !== 'edge' || (b.kind === 'edge' && a.side === b.side))
  );
}

interface DragTransaction {
  token: string;
  sequence: number;
  offset: { x: number; y: number };
  candidate: DockPlacement | null;
  surface: DockPointerRect;
  display: DockDisplayGeometry;
  previousEnvelope: RetainedEnvelope | null;
}

interface ResizeTransaction {
  token: string;
  kind: DockPlacement['kind'];
  size: { width: number; height: number };
  sidePanelSize: { width: number; height: number } | null;
  expansionDirection: 'up' | 'down' | null;
  previousEnvelope: RetainedEnvelope | null;
}

/** The one native window owns placement; renderer messages never supply desktop coordinates. */
export class DockPlacementController {
  private placement: DockPlacement = DEFAULT_DOCK_PLACEMENT;
  private displays: DockDisplayGeometry[] = [];
  private sizes: Record<DockPlacement['kind'], { width: number; height: number }> = {
    notch: { ...DOCK_SURFACE_SIZES.notch },
    edge: { ...DOCK_SURFACE_SIZES.edge },
    floating: { ...DOCK_SURFACE_SIZES.floating },
  };
  private landingSizes = {
    notch: { ...DOCK_SURFACE_SIZES.notch } as { width: number; height: number },
    edge: { ...DOCK_SURFACE_SIZES.edge } as { width: number; height: number },
    floating: { ...DOCK_SURFACE_SIZES.floating } as { width: number; height: number },
  };
  private revision = 0;
  private compactNotchWingWidth = DOCK_NOTCH_MIN_WING_WIDTH;
  private sidePanelSize: { width: number; height: number } | null = null;
  private floatingExpansionDirection: 'up' | 'down' | null = null;
  private geometryGeneration = 0;
  private mutationGeneration = 0;
  private disposed = false;
  private hiddenForDisplays = false;
  private hiddenForCapture = false;
  private drag: DragTransaction | null = null;
  private resize: ResizeTransaction | null = null;
  private snapshot: DockPlacementSnapshot | null = null;
  private dragTimer: ReturnType<typeof setInterval> | null = null;
  private retainedEnvelope: RetainedEnvelope | null = null;
  private appliedWindowLevel: 'floating' | 'status' | null = null;

  constructor(
    private window: BrowserWindow,
    private onLayout: () => void,
    private canShow: () => boolean,
  ) {
    this.displays = screen
      .getAllDisplays()
      .map(({ id, bounds, workArea }) => ({ id, bounds, workArea, cutout: null }));
    this.layout();
  }

  async initialize(): Promise<void> {
    const generation = this.mutationGeneration;
    const preference = parseDockPlacementPreference(await getLocalPref('dockPlacement'));
    if (this.disposed) return;
    if (preference && generation === this.mutationGeneration) this.placement = preference;
    await this.refreshDisplays();
  }

  getSnapshot(): DockPlacementSnapshot | null {
    return this.snapshot;
  }
  get isDragging(): boolean {
    return this.drag !== null;
  }
  get isResizing(): boolean {
    return this.resize !== null;
  }
  get captureHidden(): boolean {
    return this.hiddenForCapture;
  }

  private display(): DockDisplayGeometry | null {
    if (this.displays.length === 0) return null;
    return resolveDockDisplay(this.placement, this.displays, screen.getPrimaryDisplay().id);
  }

  async refreshDisplays(): Promise<void> {
    const generation = ++this.geometryGeneration;
    this.cancelInteraction();
    this.retainedEnvelope = null;
    const displays = await readDockDisplayGeometry(screen.getAllDisplays());
    if (this.disposed || generation !== this.geometryGeneration) return;
    this.cancelInteraction();
    this.retainedEnvelope = null;
    this.displays = displays;
    this.floatingExpansionDirection = null;
    this.layout();
  }

  private layout(): void {
    if (this.disposed || this.window.isDestroyed()) return;
    const display = this.drag?.display ?? this.display();
    if (!display) {
      this.hiddenForDisplays = true;
      this.window.hide();
      return;
    }
    const floating =
      !this.drag && this.placement.kind === 'floating'
        ? resolveFloatingDockGeometry(
            this.placement,
            display,
            this.sizes.floating,
            this.floatingExpansionDirection,
          )
        : null;
    const surface =
      this.drag?.surface ??
      floating?.surface ??
      resolveDockSurface(this.placement, display, this.sizes[this.placement.kind]);
    const candidate = this.drag?.candidate;
    const preview = candidate
      ? resolveDockSurface(candidate, display, this.landingSize(candidate, display))
      : null;
    const side = !this.drag && this.placement.kind === 'edge' ? this.placement.side : null;
    const sidePanel =
      side && !this.hiddenForCapture && this.sidePanelSize
        ? resolveDockSidePanelSurface(surface, display, this.sidePanelSize, side)
        : null;
    let bounds = dockWindowEnvelope(
      surface,
      display,
      null,
      side,
      process.platform !== 'linux',
      // Keep the native origin and local core offset stable at a free-floating
      // drop, before the renderer receives the idle snapshot.
      this.drag || floating ? DOCK_FLOATING_SHADOW_MARGIN : 24,
      sidePanel,
    );
    // Reserve only the current candidate, never the path or previous candidates.
    if (this.drag && candidate && preview)
      bounds = unionEnvelopes(bounds, this.targetEnvelope(candidate, display, preview), display);
    else if (!this.drag && this.retainedEnvelope?.displayId === display.id)
      bounds = unionEnvelopes(bounds, this.retainedEnvelope.bounds, display);
    const shape = this.drag ? 'floating' : dockShape(this.placement, display);
    const cutout =
      shape === 'notch' && display.cutout ? dockLocalRect(display.cutout, bounds) : null;
    const snapshot: DockPlacementSnapshot = {
      revision: this.revision + 1,
      placement: { ...this.placement },
      displayId: display.id,
      shape,
      windowBounds: bounds,
      workArea: dockLocalRect(display.workArea, bounds),
      surface: dockLocalRect(surface, bounds),
      cutout,
      phase: this.drag ? 'dragging' : 'idle',
      dragToken: this.drag?.token ?? null,
      resizeToken: this.resize?.token ?? null,
      snapPreview: preview ? dockLocalRect(preview, bounds) : null,
      dragTarget:
        candidate && preview
          ? {
              placement: { ...candidate },
              shape: dockShape(candidate, display),
              surface: dockLocalRect(preview, bounds),
              cutout:
                candidate.kind === 'notch' && display.cutout
                  ? dockLocalRect(display.cutout, bounds)
                  : null,
            }
          : null,
      captureHidden: this.hiddenForCapture,
      sidePanel: sidePanel ? dockLocalRect(sidePanel, bounds) : null,
      ...(floating
        ? {
            floatingAnchor: dockLocalRect(floating.anchor, bounds),
            expansionDirection: floating.expansionDirection,
          }
        : {}),
    };
    // A stationary native poll should not invalidate the renderer's pointer regions.
    if (
      !this.hiddenForDisplays &&
      this.snapshot &&
      JSON.stringify({ ...this.snapshot, revision: 0 }) ===
        JSON.stringify({ ...snapshot, revision: 0 })
    )
      return;
    this.revision++;
    this.snapshot = snapshot;
    // A held physical-notch candidate must already occupy its committed layer.
    // Keep the input core floating-shaped without lowering its notch preview.
    const levelShape = snapshot.dragTarget?.shape ?? shape;
    const windowLevel =
      levelShape === 'notch' && process.platform === 'darwin' ? 'status' : 'floating';
    if (windowLevel !== this.appliedWindowLevel) {
      this.window.setAlwaysOnTop(true, windowLevel);
      this.appliedWindowLevel = windowLevel;
    }
    this.window.setBounds(bounds, false);
    this.onLayout();
    if (this.hiddenForDisplays && this.canShow()) {
      this.hiddenForDisplays = false;
      this.window.showInactive();
    }
    if (!this.window.webContents.isDestroyed())
      this.window.webContents.send(WINDOW_CHANNELS.DOCK_PLACEMENT_CHANGED, snapshot);
  }

  private stopDragTimer(): void {
    if (this.dragTimer) clearInterval(this.dragTimer);
    this.dragTimer = null;
  }

  private landingSize(placement: DockPlacement, display: DockDisplayGeometry) {
    return placement.kind === 'notch'
      ? getDockCompactNotchSize(display.cutout, this.compactNotchWingWidth)
      : this.landingSizes[placement.kind];
  }

  private targetEnvelope(
    placement: DockPlacement,
    display: DockDisplayGeometry,
    surface: DockPointerRect,
  ): DockPointerRect {
    const side = placement.kind === 'edge' ? placement.side : null;
    const panel =
      side && this.sidePanelSize && !this.hiddenForCapture
        ? resolveDockSidePanelSurface(surface, display, this.sidePanelSize, side)
        : null;
    return dockWindowEnvelope(
      surface,
      display,
      null,
      side,
      process.platform !== 'linux',
      placement.kind === 'floating' ? DOCK_FLOATING_SHADOW_MARGIN : 24,
      panel,
    );
  }

  cancelDrag(): void {
    if (!this.drag) return;
    this.stopDragTimer();
    this.retainedEnvelope = this.drag.previousEnvelope;
    this.drag = null;
    this.layout();
  }

  cancelResize(): void {
    const transaction = this.resize;
    if (!transaction) return;
    this.resize = null;
    this.sizes[transaction.kind] = transaction.size;
    this.sidePanelSize = transaction.sidePanelSize;
    this.floatingExpansionDirection = transaction.expansionDirection;
    this.retainedEnvelope = transaction.previousEnvelope;
    this.layout();
  }

  cancelInteraction(): void {
    this.cancelDrag();
    this.cancelResize();
  }

  setCaptureHidden(hidden: boolean): void {
    this.hiddenForCapture = hidden;
    if (hidden) {
      this.cancelInteraction();
      this.retainedEnvelope = null;
    }
    this.layout();
  }

  private updateDrag(point = screen.getCursorScreenPoint(), publish = true): void {
    const drag = this.drag;
    if (!drag || this.disposed || this.hiddenForCapture) return;
    const nearest = screen.getDisplayNearestPoint(point);
    const display = this.displays.find((d) => d.id === nearest.id);
    if (!display) {
      this.cancelDrag();
      return;
    }
    const size = DOCK_SURFACE_SIZES.dragging;
    const desired = { x: point.x - drag.offset.x, y: point.y - drag.offset.y, ...size };
    drag.display = display;
    drag.surface = resolveDockSurface(floatingDockPlacement(desired, display), display, size);
    drag.candidate = findDockSnapTarget(point, display, drag.candidate, this.landingSizes.edge);
    if (publish) this.layout();
  }

  async command(
    command: Exclude<DockPlacementCommand, { action: 'dismiss' }>,
  ): Promise<DockPlacementSnapshot | null> {
    if (this.disposed || this.hiddenForCapture || this.window.isDestroyed()) return this.snapshot;
    if (command.action === 'move') {
      this.cancelInteraction();
      this.retainedEnvelope = null;
      const display = this.display();
      if (!display) return this.snapshot;
      this.floatingExpansionDirection = null;
      if (command.target === 'reset') this.placement = { ...DEFAULT_DOCK_PLACEMENT };
      else if (command.target === 'notch')
        this.placement = { kind: 'notch', displayId: display.id };
      else if (command.target === 'floating') {
        if (this.placement.kind !== 'floating') {
          const surface = resolveDockSurface(
            this.placement,
            display,
            this.sizes[this.placement.kind],
          );
          this.placement = floatingDockPlacement(
            { ...surface, ...DOCK_FLOATING_COMPACT_SIZE },
            display,
          );
        }
      } else
        this.placement = { kind: 'edge', displayId: display.id, side: command.target, along: 0.5 };
      if (this.placement.kind === 'notch') {
        const targetDisplay = this.display();
        if (targetDisplay) this.sizes.notch = this.landingSize(this.placement, targetDisplay);
      }
      this.mutationGeneration++;
      this.layout();
      await setDockPlacementLocalPref(this.placement);
    } else if (command.action === 'resize') {
      if (this.drag || command.revision !== this.revision) return this.snapshot;
      if (
        this.resize ? command.resizeToken !== this.resize.token : command.resizeToken !== undefined
      )
        return this.snapshot;
      if (command.landingSizes) this.landingSizes = command.landingSizes;
      if (command.compactNotchWingWidth !== undefined)
        this.compactNotchWingWidth = command.compactNotchWingWidth;
      if (command.sidePanelSize !== undefined) this.sidePanelSize = command.sidePanelSize;
      if (command.expansionDirection !== undefined)
        this.floatingExpansionDirection =
          this.placement.kind === 'floating' ? command.expansionDirection : null;
      this.sizes[this.placement.kind] = { width: command.width, height: command.height };
      this.layout();
    } else if (command.action === 'begin-resize') {
      if (this.drag || this.resize || command.revision !== this.revision || !this.snapshot)
        return this.snapshot;
      const { origin } = command;
      if (!Number.isFinite(origin.x) || !Number.isFinite(origin.y)) return this.snapshot;
      const contains = (rect: DockPointerRect | null | undefined) =>
        !!rect &&
        origin.x >= rect.x &&
        origin.y >= rect.y &&
        origin.x < rect.x + rect.width &&
        origin.y < rect.y + rect.height;
      const target =
        this.placement.kind === 'edge' ? this.snapshot.sidePanel : this.snapshot.surface;
      if (!contains(target) || contains(this.snapshot.cutout)) return this.snapshot;
      this.resize = {
        token: randomUUID(),
        kind: this.placement.kind,
        size: { ...this.sizes[this.placement.kind] },
        sidePanelSize: this.sidePanelSize ? { ...this.sidePanelSize } : null,
        expansionDirection: this.floatingExpansionDirection,
        previousEnvelope: this.retainedEnvelope,
      };
      this.retainedEnvelope = null;
      this.window.setIgnoreMouseEvents(false);
      this.window.focus();
      this.layout();
    } else if (command.action === 'end-resize' || command.action === 'cancel-resize') {
      if (!this.resize || command.token !== this.resize.token) return this.snapshot;
      if (command.action === 'cancel-resize') this.cancelResize();
      else {
        this.resize = null;
        this.layout();
      }
    } else if (command.action === 'begin-drag') {
      if (this.drag || this.resize || command.revision !== this.revision || !this.snapshot)
        return this.snapshot;
      const display = this.display();
      if (!display) return this.snapshot;
      const surface = {
        ...this.snapshot.surface,
        x: this.snapshot.windowBounds.x + this.snapshot.surface.x,
        y: this.snapshot.windowBounds.y + this.snapshot.surface.y,
      };
      // Authorize the original grab against the exact surface revision, not the
      // cursor's later location: a fast gesture may leave this surface before IPC runs.
      // Only the tracked dock can invoke this path, and movement still uses the OS cursor.
      const { origin } = command;
      if (
        !Number.isFinite(origin.x) ||
        !Number.isFinite(origin.y) ||
        origin.x < 0 ||
        origin.x >= surface.width ||
        origin.y < 0 ||
        origin.y >= surface.height
      )
        return this.snapshot;
      const cutout = this.placement.kind === 'notch' ? display.cutout : null;
      if (
        cutout &&
        surface.x + origin.x >= cutout.x &&
        surface.x + origin.x < cutout.x + cutout.width &&
        surface.y + origin.y >= cutout.y &&
        surface.y + origin.y < cutout.y + cutout.height
      )
        return this.snapshot;
      const compact = DOCK_SURFACE_SIZES.dragging;
      const header = command.headerBounds;
      const localSurface = this.snapshot.surface;
      const press = { x: localSurface.x + origin.x, y: localSurface.y + origin.y };
      if (
        header &&
        (![header.x, header.y, header.width, header.height].every(Number.isFinite) ||
          header.width <= 0 ||
          header.height <= 0 ||
          header.height > 64 ||
          header.x < localSurface.x - 1 ||
          header.y < localSurface.y - 1 ||
          header.x + header.width > localSurface.x + localSurface.width + 1 ||
          header.y + header.height > localSurface.y + localSurface.height + 1 ||
          press.x < header.x - 1 ||
          press.x > header.x + header.width + 1 ||
          press.y < header.y - 1 ||
          press.y > header.y + header.height + 1)
      )
        return this.snapshot;
      // The floating window may retain a larger allocation after collapse. Keep
      // the grab relative to the actual visible header, including upward expansion.
      const anchor = this.placement.kind === 'floating' ? this.snapshot.floatingAnchor : null;
      const grab = header
        ? { x: press.x - header.x, y: press.y - header.y }
        : anchor
          ? {
              x: origin.x - (anchor.x - this.snapshot.surface.x),
              y: origin.y - (anchor.y - this.snapshot.surface.y),
            }
          : origin;
      this.drag = {
        token: randomUUID(),
        sequence: -1,
        display,
        candidate: null,
        offset: {
          x: Math.min(compact.width - 8, Math.max(8, grab.x)),
          y: Math.min(compact.height - 4, Math.max(4, grab.y)),
        },
        surface: { ...surface, ...compact },
        previousEnvelope: this.retainedEnvelope,
      };
      this.retainedEnvelope = null;
      this.window.setIgnoreMouseEvents(false);
      this.window.focus();
      this.updateDrag();
      this.dragTimer = setInterval(() => this.updateDrag(), 16);
    } else if (
      command.action === 'drag' ||
      command.action === 'end-drag' ||
      command.action === 'cancel-drag'
    ) {
      const drag = this.drag;
      if (!drag || command.token !== drag.token || command.sequence <= drag.sequence)
        return this.snapshot;
      const releasePoint = command.action === 'end-drag' ? command.releasePoint : undefined;
      if (
        releasePoint &&
        (![releasePoint.x, releasePoint.y].every(Number.isFinite) ||
          Math.abs(releasePoint.x) > 1_000_000 ||
          Math.abs(releasePoint.y) > 1_000_000)
      )
        return this.snapshot;
      drag.sequence = command.sequence;
      if (command.action === 'cancel-drag') this.cancelDrag();
      else {
        const sampled = this.snapshot;
        // Movement follows the OS cursor. Release uses the original pointer-up
        // position so IPC latency cannot snap a completed gesture somewhere else.
        this.updateDrag(releasePoint, command.action !== 'end-drag');
        if (command.action === 'end-drag' && this.drag === drag) {
          this.retainedEnvelope = null;
          // A sampled destination is already painted in this allocation. Preserve
          // its origin through commit and compact resize acknowledgments. A target
          // first reached at pointer-up has no prepainted handoff to preserve.
          if (
            drag.candidate &&
            sampled?.dragToken === drag.token &&
            sampled.dragTarget &&
            sameSnapTarget(sampled.dragTarget.placement, drag.candidate)
          ) {
            const target = resolveDockSurface(
              drag.candidate,
              drag.display,
              this.landingSize(drag.candidate, drag.display),
            );
            if (
              containsEnvelope(
                sampled.windowBounds,
                this.targetEnvelope(drag.candidate, drag.display, target),
              )
            )
              this.retainedEnvelope = {
                displayId: drag.display.id,
                bounds: { ...sampled.windowBounds },
              };
          }
          this.floatingExpansionDirection = null;
          this.placement =
            drag.candidate ??
            floatingDockPlacement({ ...drag.surface, ...DOCK_FLOATING_COMPACT_SIZE }, drag.display);
          this.sizes[this.placement.kind] = { ...this.landingSize(this.placement, drag.display) };
          this.mutationGeneration++;
          this.stopDragTimer();
          this.drag = null;
          this.layout();
          await setDockPlacementLocalPref(this.placement);
        }
      }
    }
    return this.snapshot;
  }

  dispose(): void {
    this.disposed = true;
    this.geometryGeneration++;
    this.stopDragTimer();
    this.drag = null;
    this.resize = null;
    this.retainedEnvelope = null;
  }
}
