import type { DockPointerRect } from './dock-layout';

export type DockPlacement =
  | { kind: 'notch'; displayId: number | null }
  | { kind: 'edge'; displayId: number; side: 'left' | 'right'; along: number }
  | { kind: 'floating'; displayId: number; x: number; y: number };

export type DockPlacementTarget = 'notch' | 'left' | 'right' | 'floating' | 'reset';
export type DockShape = 'notch' | 'top-pill' | 'edge' | 'floating';
interface DockDragTarget {
  placement: DockPlacement;
  shape: DockShape;
  /** Candidate geometry in the current window's local DIP, for decoration only. */
  surface: DockPointerRect;
  cutout: DockPointerRect | null;
}
export interface DockPlacementSnapshot {
  revision: number;
  placement: DockPlacement;
  displayId: number;
  shape: DockShape;
  windowBounds: DockPointerRect;
  /** Surface, cutout and preview are in window-local DIP, never physical pixels. */
  surface: DockPointerRect;
  cutout: DockPointerRect | null;
  phase: 'idle' | 'dragging';
  dragToken: string | null;
  snapPreview: DockPointerRect | null;
  /** Authoritative candidate form while dragging; never an additional input region. */
  dragTarget?: DockDragTarget | null;
  captureHidden: boolean;
  /** Floating compact surface in window-local DIP; independent of expansion size. */
  floatingAnchor?: DockPointerRect;
  expansionDirection?: 'up' | 'down';
  /** Resolved side conversation bounds in window-local DIP; absent on older snapshots. */
  sidePanel?: DockPointerRect | null;
  /**
   * Echo of the side conversation's vertical anchor (its centre as an offset from the
   * rail surface's top, DIP); null centres it on the rail.
   */
  sidePanelAnchor?: number | null;
  /** Native work area in window-local DIP, including space outside the envelope. */
  workArea?: DockPointerRect;
  /** Native ownership of a conversation resize gesture; not a placement drag. */
  resizeToken?: string | null;
}

type DockLandingSizes = Record<DockPlacement['kind'], { width: number; height: number }>;

export type DockPlacementCommand =
  | { action: 'dismiss' }
  | { action: 'focus' }
  | { action: 'move'; target: DockPlacementTarget }
  | {
      action: 'resize';
      width: number;
      height: number;
      revision: number;
      landingSizes?: DockLandingSizes;
      /** Content width beside the camera, independent of the current display or mode. */
      compactNotchWingWidth?: number;
      /** Transient side conversation size. Omission preserves it; null closes it. */
      sidePanelSize?: { width: number; height: number } | null;
      /**
       * The side conversation's vertical centre as an offset from the rail surface's
       * top (the clicked entry's centre). Omission preserves it; null centres on the rail.
       */
      sidePanelAnchor?: number | null;
      /** Keep a user-resized floating conversation on its current side of the grip. */
      expansionDirection?: 'up' | 'down' | null;
      resizeToken?: string;
    }
  | { action: 'begin-resize'; revision: number; origin: { x: number; y: number } }
  | { action: 'end-resize' | 'cancel-resize'; token: string }
  | {
      action: 'begin-drag';
      revision: number;
      /** Pointer-down grab offset within that revision's surface, in DIP. */
      origin: { x: number; y: number };
      /** Visible header at pointer-down in window-local DIP; supports expanded headers. */
      headerBounds?: DockPointerRect;
    }
  | { action: 'drag' | 'cancel-drag'; token: string; sequence: number }
  | {
      action: 'end-drag';
      token: string;
      sequence: number;
      /** Pointer-up position in screen DIP, frozen before asynchronous IPC delivery. */
      releasePoint?: { x: number; y: number };
    };

/** Which placement request main rejected; the dock names it in its notice. */
export type DockPlacementFailure = 'move' | 'resize' | 'update';

/** Name a rejected command by what the user was doing: moving or resizing the dock. */
export function dockPlacementFailureFor(command: { action: string }): DockPlacementFailure {
  if (/resize/.test(command.action)) return 'resize';
  return /move|drag|dismiss/.test(command.action) ? 'move' : 'update';
}

export interface DockDisplayGeometry {
  id: number;
  bounds: DockPointerRect;
  workArea: DockPointerRect;
  /** Absolute Electron screen DIP. Null means no reliable physical cutout. */
  cutout: DockPointerRect | null;
}

export const DEFAULT_DOCK_PLACEMENT: DockPlacement = { kind: 'notch', displayId: null };
const DOCK_NOTCH_MIN_HEIGHT = 32;
export const DOCK_NOTCH_MIN_WING_WIDTH = 36;
export const DOCK_FLOATING_COMPACT_SIZE = { width: 224, height: 40 } as const;
/** Conversation content size; horizontal shells add their compact header height. */
export const DOCK_CONVERSATION_MIN_SIZE = { width: 320, height: 300 } as const;
/** A shorter default open height (420): the minimum still fits the composer and a few lines. */
export const DOCK_CONVERSATION_DEFAULT_SIZE = { width: 420, height: 420 } as const;
/** A wire guard only: native display geometry supplies the actual size limit. */
export const DOCK_SURFACE_MAX_SIZE = 16384;
// Dark overlay shadow: 12px vertical offset plus the 32px blur's ~48px painted tail.
export const DOCK_FLOATING_SHADOW_MARGIN = 64;

/** The compact attached shell follows measured hardware; plain displays keep a top pill. */
export function getDockCompactNotchSize(
  cutout: Pick<DockPointerRect, 'width' | 'height'> | null,
  wingWidth = DOCK_NOTCH_MIN_WING_WIDTH,
): { width: number; height: number } {
  const wing = Math.max(DOCK_NOTCH_MIN_WING_WIDTH, wingWidth);
  // Without a camera the top pill follows the same rules: header height, two wings.
  if (!cutout) return { width: wing * 2, height: DOCK_NOTCH_MIN_HEIGHT };
  return {
    width: Math.ceil(cutout.width + wing * 2),
    height: Math.max(DOCK_NOTCH_MIN_HEIGHT, cutout.height),
  };
}

export const DOCK_SURFACE_SIZES = {
  // Width excludes the hardware gap, which resolveDockSurface adds from the display.
  notch: { width: DOCK_NOTCH_MIN_WING_WIDTH * 2, height: DOCK_NOTCH_MIN_HEIGHT },
  edge: { width: 40, height: 260 },
  floating: { width: 360, height: 320 },
  dragging: DOCK_FLOATING_COMPACT_SIZE,
} as const;

function clampDockFraction(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function parseDockPlacementPreference(value: unknown): DockPlacement | null {
  if (!value || typeof value !== 'object') return null;
  const pref = value as { version?: unknown; placement?: unknown };
  if (pref.version !== 1 || !pref.placement || typeof pref.placement !== 'object') return null;
  const p = pref.placement as Record<string, unknown>;
  const id = p.displayId;
  const validId = typeof id === 'number' && Number.isSafeInteger(id);
  const fraction = (v: unknown): v is number =>
    typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1;
  if (p.kind === 'notch' && (id === null || validId))
    return { kind: 'notch', displayId: id as number | null };
  if (
    p.kind === 'edge' &&
    validId &&
    (p.side === 'left' || p.side === 'right') &&
    fraction(p.along)
  )
    return { kind: 'edge', displayId: id as number, side: p.side, along: p.along };
  if (p.kind === 'floating' && validId && fraction(p.x) && fraction(p.y))
    return { kind: 'floating', displayId: id as number, x: p.x, y: p.y };
  return null;
}

export function resolveDockDisplay(
  placement: DockPlacement,
  displays: readonly DockDisplayGeometry[],
  primaryId: number,
): DockDisplayGeometry | null {
  return (
    displays.find((d) => d.id === placement.displayId) ??
    (placement.kind === 'notch' ? displays.find((d) => d.cutout !== null) : undefined) ??
    displays.find((d) => d.id === primaryId) ??
    displays[0] ??
    null
  );
}

export function dockShape(placement: DockPlacement, display: DockDisplayGeometry): DockShape {
  return placement.kind === 'notch' ? (display.cutout ? 'notch' : 'top-pill') : placement.kind;
}

/** Committed surface bounds; normalized positions refer to available travel. */
export function resolveDockSurface(
  placement: DockPlacement,
  display: DockDisplayGeometry,
  size: { width: number; height: number },
): DockPointerRect {
  const area = display.workArea;
  const cutout = placement.kind === 'notch' ? display.cutout : null;
  const minimum =
    placement.kind === 'notch' ? getDockCompactNotchSize(cutout) : { width: 1, height: 1 };
  const width = Math.round(Math.min(area.width, Math.max(minimum.width, size.width)));
  const height = Math.round(Math.min(area.height, Math.max(minimum.height, size.height)));
  let x: number;
  let y: number;
  if (placement.kind === 'notch') {
    x = (cutout ? cutout.x + cutout.width / 2 : area.x + area.width / 2) - width / 2;
    y = cutout ? display.bounds.y : area.y + 8;
  } else if (placement.kind === 'edge') {
    x = placement.side === 'left' ? area.x : area.x + area.width - width;
    y = area.y + (area.height - height) * clampDockFraction(placement.along);
  } else {
    x = area.x + (area.width - width) * clampDockFraction(placement.x);
    y = area.y + (area.height - height) * clampDockFraction(placement.y);
  }
  return {
    x: Math.round(Math.max(area.x, Math.min(x, area.x + area.width - width))),
    y: Math.round(cutout ? y : Math.max(area.y, Math.min(y, area.y + area.height - height))),
    width,
    height,
  };
}

export function floatingDockPlacement(
  surface: DockPointerRect,
  display: DockDisplayGeometry,
): Extract<DockPlacement, { kind: 'floating' }> {
  return {
    kind: 'floating',
    displayId: display.id,
    x: clampDockFraction(
      (surface.x - display.workArea.x) / Math.max(1, display.workArea.width - surface.width),
    ),
    y: clampDockFraction(
      (surface.y - display.workArea.y) / Math.max(1, display.workArea.height - surface.height),
    ),
  };
}

/** Floating preferences describe the compact anchor, never the expanded overview. */
export function resolveFloatingDockGeometry(
  placement: Extract<DockPlacement, { kind: 'floating' }>,
  display: DockDisplayGeometry,
  size: { width: number; height: number },
  preferredDirection: 'up' | 'down' | null = null,
): {
  surface: DockPointerRect;
  anchor: DockPointerRect;
  expansionDirection: 'up' | 'down';
} {
  const area = display.workArea;
  const anchor = resolveDockSurface(placement, display, DOCK_FLOATING_COMPACT_SIZE);
  const width = Math.round(Math.min(area.width, Math.max(anchor.width, size.width)));
  const requestedHeight = Math.round(Math.min(area.height, Math.max(anchor.height, size.height)));
  const below = area.y + area.height - anchor.y;
  const above = anchor.y + anchor.height - area.y;
  const expansionDirection =
    preferredDirection ??
    (requestedHeight <= below ? 'down' : requestedHeight <= above || above > below ? 'up' : 'down');
  const height = Math.min(requestedHeight, expansionDirection === 'up' ? above : below);
  const x = Math.round(
    Math.max(area.x, Math.min(anchor.x + (anchor.width - width) / 2, area.x + area.width - width)),
  );
  const y = expansionDirection === 'up' ? anchor.y + anchor.height - height : anchor.y;
  return { surface: { x, y, width, height }, anchor, expansionDirection };
}

/** Hysteresis retains a selected landing zone until the pointer leaves its wider boundary. */
export function findDockSnapTarget(
  point: { x: number; y: number },
  display: DockDisplayGeometry,
  previous: DockPlacement | null,
  edgeSize: { width: number; height: number } = DOCK_SURFACE_SIZES.edge,
): DockPlacement | null {
  const area = display.workArea;
  const center = display.cutout
    ? display.cutout.x + display.cutout.width / 2
    : area.x + area.width / 2;
  const top = display.cutout ? display.bounds.y : area.y;
  const retained = previous?.displayId === display.id ? previous : null;
  // Without a notch the pill sits below the menu bar, but a drag to the screen's top
  // edge (inside the menu bar) still means "top"; the zone starts at the display top.
  const notchHit = (margin: number) =>
    Math.abs(point.x - center) <= 140 + margin &&
    point.y >= display.bounds.y - margin &&
    point.y <= top + (display.cutout?.height ?? 8) + margin;
  const edge = (side: 'left' | 'right', margin: number) =>
    Math.abs(point.x - (side === 'left' ? area.x : area.x + area.width)) <= margin;
  const edgeHeight = Math.min(area.height, edgeSize.height);
  const edgePlacement = (side: 'left' | 'right'): DockPlacement => ({
    kind: 'edge',
    displayId: display.id,
    side,
    along: clampDockFraction(
      (point.y - area.y - edgeHeight / 2) / Math.max(1, area.height - edgeHeight),
    ),
  });
  if (retained?.kind === 'notch' && notchHit(48)) return retained;
  if (retained?.kind === 'edge' && edge(retained.side, 48)) return edgePlacement(retained.side);
  if (notchHit(24)) return { kind: 'notch', displayId: display.id };
  if (edge('left', 24)) return edgePlacement('left');
  if (edge('right', 24)) return edgePlacement('right');
  return null;
}

export function dockLocalRect(rect: DockPointerRect, bounds: DockPointerRect): DockPointerRect {
  return { ...rect, x: rect.x - bounds.x, y: rect.y - bounds.y };
}

/** Inset that keeps an entry-anchored side conversation's shadow off the work area edge. */
export const DOCK_SIDE_PANEL_INSET = 8;

/**
 * Place a side conversation inward without changing the compact rail's anchor.
 * Vertically it is centred on `anchor` (an offset from the rail's top, like the hover
 * card on its entry) or on the rail, then clamped inside the work area (with a small
 * inset when anchored and it fits).
 */
export function resolveDockSidePanelSurface(
  rail: DockPointerRect,
  display: DockDisplayGeometry,
  requested: { width: number; height: number },
  side: 'left' | 'right',
  anchor: number | null = null,
): DockPointerRect | null {
  const area = display.workArea;
  const gap = 8;
  const inward =
    side === 'left' ? area.x + area.width - (rail.x + rail.width) - gap : rail.x - area.x - gap;
  if (inward < 1 || area.height < 1) return null;
  const width = Math.max(1, Math.floor(Math.min(requested.width, inward)));
  const height = Math.max(1, Math.floor(Math.min(requested.height, area.height)));
  const x = side === 'left' ? rail.x + rail.width + gap : rail.x - gap - width;
  const anchored = anchor !== null && Number.isFinite(anchor);
  const inset = anchored
    ? Math.min(DOCK_SIDE_PANEL_INSET, Math.max(0, (area.height - height) / 2))
    : 0;
  const centre = rail.y + (anchored ? Math.max(0, Math.min(rail.height, anchor)) : rail.height / 2);
  const y = Math.round(
    Math.max(area.y + inset, Math.min(centre - height / 2, area.y + area.height - height - inset)),
  );
  return { x, y, width, height };
}

/** A single envelope contains both the moving surface and the exact landing silhouette. */
export function dockWindowEnvelope(
  surface: DockPointerRect,
  display: DockDisplayGeometry,
  preview: DockPointerRect | null = null,
  side: 'left' | 'right' | null = null,
  supportsForwarding = true,
  shadowMargin = 24,
  sidePanel: DockPointerRect | null = null,
): DockPointerRect {
  const margin = supportsForwarding ? shadowMargin : 0;
  const panelMargin = supportsForwarding ? DOCK_FLOATING_SHADOW_MARGIN : 0;
  const expansion = side && supportsForwarding ? 600 : 0;
  // Side hover cards need vertical room independent of the compact rail's height.
  // Keep the rail and its margins in the union even outside the work area.
  const sideHoverEnvelope = side !== null && supportsForwarding;
  const x = Math.floor(
    Math.max(
      display.bounds.x,
      Math.min(
        surface.x - margin - (side === 'right' ? expansion : 0),
        preview?.x ?? surface.x,
        sidePanel ? sidePanel.x - panelMargin : surface.x,
      ),
    ),
  );
  const y = Math.floor(
    Math.max(
      display.bounds.y,
      Math.min(
        surface.y - margin,
        preview?.y ?? surface.y,
        sideHoverEnvelope ? display.workArea.y : surface.y,
        sidePanel ? sidePanel.y - panelMargin : surface.y,
      ),
    ),
  );
  const right = Math.ceil(
    Math.min(
      display.bounds.x + display.bounds.width,
      Math.max(
        surface.x + surface.width + margin + (side === 'left' ? expansion : 0),
        preview ? preview.x + preview.width : surface.x + surface.width,
        sidePanel ? sidePanel.x + sidePanel.width + panelMargin : surface.x + surface.width,
      ),
    ),
  );
  const bottom = Math.ceil(
    Math.min(
      display.bounds.y + display.bounds.height,
      Math.max(
        surface.y + surface.height + margin,
        preview ? preview.y + preview.height : surface.y,
        sideHoverEnvelope ? display.workArea.y + display.workArea.height : surface.y,
        sidePanel ? sidePanel.y + sidePanel.height + panelMargin : surface.y,
      ),
    ),
  );
  return { x, y, width: Math.max(1, right - x), height: Math.max(1, bottom - y) };
}
