/**
 * Dock composer annotation overlay: wire contract between the main-process
 * controller and the transparent overlay renderer, plus the pure geometry and
 * perceptual-hash helpers both sides share.
 *
 * Coordinates:
 * - "global" — Electron screen DIP (macOS points, top-left of the primary
 *   display; secondary displays may have negative origins).
 * - "overlay" — DIP relative to the overlay window, which covers exactly the
 *   dock's display (`overlay = global - display.bounds.origin`).
 * - "image" — pixels of the session image the mark belongs to.
 */
import type {
  DockImagePoint,
  DockImageRect,
  DockMarkElement,
  DockMarkGeometry,
  DockMarkTool,
} from './dock-evidence';

/** Mirrored into the central registry (`DOCK_ANNOTATION` group) by the IPC owner. */
export const DOCK_ANNOTATION_CHANNELS = {
  /** overlay → main invoke: `DockAnnotationReadyRequest` → `DockAnnotationOverlayState | null`. */
  READY: 'dock-annotation:ready',
  /** overlay → main invoke: `DockAnnotationPointerRequest` → `DockAnnotationAck`. */
  POINTER: 'dock-annotation:pointer',
  /** overlay → main invoke: `DockAnnotationGestureRequest` → `DockAnnotationAck`. */
  GESTURE: 'dock-annotation:gesture',
  /** overlay → main invoke: `{ sessionId }` → `{ dataUrl } | null` (still sessions only). */
  GET_STILL: 'dock-annotation:get-still',
  /** main → overlay send: `DockAnnotationOverlayState | null`. */
  STATE: 'dock-annotation:state',
  /** overlay → main invoke: `DockAnnotationToolbarRequest` → `boolean` (on-screen tool bar). */
  TOOLBAR: 'dock-annotation:toolbar',
} as const;

export type DockAnnotationMode = 'live' | 'still' | 'dictation';

export interface DockAnnotationRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DockSyncedMark {
  n: number;
  tool: DockMarkTool;
  /** Image pixels of the session image. */
  geometry: DockMarkGeometry;
}

export interface DockAnnotationOverlayState {
  sessionId: string;
  mode: DockAnnotationMode;
  tool: DockMarkTool;
  /** Overlay (display) size in DIP. */
  display: { width: number; height: number };
  /** Session image size in pixels; null until the first live mark creates it. */
  image: { width: number; height: number } | null;
  /** Present for still sessions: fetch the frozen pixels with GET_STILL. */
  still: { imageId: string; width: number; height: number } | null;
  /** Authoritative numbered marks of the session image (renderer-owned order). */
  marks: DockSyncedMark[];
  /** Advances on every `syncMarks`; pending local shapes older than this are dropped. */
  marksRevision: number;
  /** Overlay-local rects where gestures never start (dock, owned menus/popups). */
  excluded: DockAnnotationRect[];
  /** Whether element picking can read real accessibility metadata (still images: never). */
  pick: 'ready' | 'permission' | 'unavailable';
  /** Stable id of the dock's display: the tool bar remembers its position per display. */
  displayId: number;
  /** Overlay-local work area (display minus menu bar and macOS Dock). */
  workArea: DockAnnotationRect;
  /** Where the dock is painted now (overlay-local); the tool bar sits next to it. */
  dock: DockToolbarAnchor | null;
  /**
   * Mouse mode: the screen is used normally (the overlay is click-through except its
   * tool bar, no marks); the session, its marks and image stay. A tool resumes it.
   */
  mouse: boolean;
  /**
   * Screenshot and Record on the tool bar: the dock composer's own button state
   * (null until the dock has sent it; the two buttons are hidden meanwhile).
   */
  media: DockAnnotationMediaState | null;
}

/** One composer media button as the tool bar shows it (strings already localized). */
export interface DockAnnotationMediaButton {
  label: string;
  tooltip: string;
  disabled: boolean;
  pending: boolean;
  /** A missing permission: alert dot; a click opens its System Settings pane. */
  alert: boolean;
}

/** The composer's Screenshot and Record state, mirrored on the annotate tool bar. */
export interface DockAnnotationMediaState {
  capture: DockAnnotationMediaButton;
  record: DockAnnotationMediaButton & {
    recording: boolean;
    /** Epoch ms the live recording started; the bar ticks its own timer. */
    startedAt: number | null;
  };
}

const mediaText = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= 200;
const mediaButton = (value: unknown): value is DockAnnotationMediaButton => {
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  return (
    mediaText(row.label) &&
    mediaText(row.tooltip) &&
    typeof row.disabled === 'boolean' &&
    typeof row.pending === 'boolean' &&
    typeof row.alert === 'boolean'
  );
};

/** A copy of a well-formed media state, or null (refused, never published). */
export function sanitizeDockAnnotationMedia(value: unknown): DockAnnotationMediaState | null {
  if (!value || typeof value !== 'object') return null;
  const { capture, record } = value as Record<string, unknown>;
  if (!mediaButton(capture) || !mediaButton(record)) return null;
  const { recording, startedAt } = record as unknown as Record<string, unknown>;
  if (typeof recording !== 'boolean') return null;
  if (
    startedAt !== null &&
    !(typeof startedAt === 'number' && Number.isFinite(startedAt) && startedAt > 0)
  )
    return null;
  const button = (row: DockAnnotationMediaButton): DockAnnotationMediaButton => ({
    label: row.label,
    tooltip: row.tooltip,
    disabled: row.disabled,
    pending: row.pending,
    alert: row.alert,
  });
  return {
    capture: button(capture),
    record: {
      ...button(record),
      recording,
      startedAt: recording ? (startedAt as number | null) : null,
    },
  };
}

/** The dock's painted shell and its form, for placing the annotate tool bar beside it. */
export interface DockToolbarAnchor {
  rect: DockAnnotationRect;
  shape: 'notch' | 'top-pill' | 'edge' | 'floating';
  /** Edge rails only: the screen side the rail is on. */
  side?: 'left' | 'right';
}

/** Gap between the dock and its annotate tool bar. */
const DOCK_TOOLBAR_GAP = 8;

/**
 * Tool bar position next to the dock: below a notch or top pill (centred on it);
 * beside an edge rail on the screen-inner side (vertically centred); below a
 * floating dock when it fits, else above. Always inside the work area. With no
 * dock bounds, bottom centre of the work area.
 */
export function dockToolbarPosition(
  dock: DockToolbarAnchor | null,
  size: { width: number; height: number },
  area: DockAnnotationRect,
  gap = DOCK_TOOLBAR_GAP,
): { x: number; y: number } {
  const clamp = (value: number, min: number, max: number) =>
    Math.round(Math.min(Math.max(min, value), Math.max(min, max)));
  const place = (x: number, y: number) => ({
    x: clamp(x, area.x, area.x + area.width - size.width),
    y: clamp(y, area.y, area.y + area.height - size.height),
  });
  if (!dock)
    return place(area.x + (area.width - size.width) / 2, area.y + area.height - size.height - 16);
  const { rect } = dock;
  const centreX = rect.x + (rect.width - size.width) / 2;
  const centreY = rect.y + (rect.height - size.height) / 2;
  if (dock.shape === 'edge') {
    const x = dock.side === 'right' ? rect.x - gap - size.width : rect.x + rect.width + gap;
    return place(x, centreY);
  }
  const below = rect.y + rect.height + gap;
  if (dock.shape === 'floating' && below + size.height > area.y + area.height)
    return place(centreX, rect.y - gap - size.height);
  return place(centreX, below);
}

/**
 * The overlay's on-screen tool bar. `rect` reports where it sits (overlay DIP; null
 * when hidden) so main keeps it clickable and never lets a gesture start on it.
 */
export type DockAnnotationToolbarRequest = { sessionId: string } & (
  | { action: 'tool'; tool: DockMarkTool }
  | { action: 'mouse' }
  /** Done: keep what is marked as one image in the composer, clear the screen, carry on. */
  | { action: 'commit' }
  /** Clear: remove the current marks without attaching anything; the tool stays. */
  | { action: 'clear' }
  | { action: 'end' }
  /** Screenshot / Record (start or stop): the composer's own action, in the dock. */
  | { action: 'capture' }
  | { action: 'record' }
  | { action: 'rect'; rect: DockAnnotationRect | null }
);

export interface DockAnnotationReadyRequest {
  /** Null on first mount; the session id once its state has been painted. */
  sessionId: string | null;
}

export interface DockAnnotationPointerRequest {
  sessionId: string;
  sequence: number;
  phase: 'down' | 'cancel';
  /** Overlay DIP of the pointerdown origin (ignored for cancel). */
  x: number;
  y: number;
  tool: DockMarkTool;
}

export interface DockAnnotationGestureRequest {
  sessionId: string;
  sequence: number;
  tool: DockMarkTool;
  /** Overlay DIP; must equal the origin sent with the pointerdown of `sequence`. */
  origin: DockImagePoint;
  /** pick: [origin] · box: [from, to] · arrow: [tail, head] · pen: stroke points. */
  points: DockImagePoint[];
}

type DockAnnotationRejectReason =
  'stale' | 'excluded' | 'outside' | 'invalid' | 'permission' | 'unavailable' | 'failed';

/**
 * A genuine failure the dock should surface (settings affordance): no capture was
 * taken and no mark was made. `target` means the window under the pointer could
 * not be checked (helper missing), `pick` that accessibility metadata is not
 * readable, `capture` that the clean capture was refused.
 */
export interface DockAnnotationIssue {
  sessionId: string;
  kind: 'pick' | 'target' | 'capture';
  error: 'permission' | 'unavailable';
}

export type DockAnnotationAck = { ok: true } | { ok: false; reason: DockAnnotationRejectReason };

/** Overlay renderer → main requests (implemented by the overlay IPC bridge). */
export interface DockAnnotationOverlayTransport {
  pointer(request: DockAnnotationPointerRequest): Promise<DockAnnotationAck>;
  gesture(request: DockAnnotationGestureRequest): Promise<DockAnnotationAck>;
  /** On-screen tool bar; optional so harnesses without one keep working. */
  toolbar?(request: DockAnnotationToolbarRequest): Promise<boolean>;
}

export const DOCK_ANNOTATION_LIMITS = {
  gesturePoints: 2048,
  /** Smallest box side / arrow length in overlay DIP that counts as a shape. */
  minShape: 4,
  /** Perceptual-hash Hamming distance above which the screen changed. */
  hashThreshold: 12,
} as const;

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

/** Image → overlay mapping: `overlay = offset + image * scale`. */
export interface DockAnnotationViewport {
  scaleX: number;
  scaleY: number;
  offsetX: number;
  offsetY: number;
}

const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

/**
 * Live images cover the whole display (independent per-axis scale, so a capture
 * whose pixel size is not exactly `bounds × scaleFactor` still lines up). Still
 * images are letterboxed (`contain`) so their aspect is never distorted.
 */
export function dockAnnotationViewport(
  display: { width: number; height: number },
  image: { width: number; height: number },
  mode: DockAnnotationMode,
): DockAnnotationViewport | null {
  if (
    ![display.width, display.height, image.width, image.height].every(finite) ||
    display.width <= 0 ||
    display.height <= 0 ||
    image.width <= 0 ||
    image.height <= 0
  )
    return null;
  if (mode !== 'still')
    return {
      scaleX: display.width / image.width,
      scaleY: display.height / image.height,
      offsetX: 0,
      offsetY: 0,
    };
  const scale = Math.min(display.width / image.width, display.height / image.height);
  return {
    scaleX: scale,
    scaleY: scale,
    offsetX: (display.width - image.width * scale) / 2,
    offsetY: (display.height - image.height * scale) / 2,
  };
}

export function imageToOverlay(
  point: DockImagePoint,
  view: DockAnnotationViewport,
): DockImagePoint {
  return { x: view.offsetX + point.x * view.scaleX, y: view.offsetY + point.y * view.scaleY };
}

function overlayToImage(point: DockImagePoint, view: DockAnnotationViewport): DockImagePoint {
  return { x: (point.x - view.offsetX) / view.scaleX, y: (point.y - view.offsetY) / view.scaleY };
}

export function mapDockGeometry(
  geometry: DockMarkGeometry,
  map: (point: DockImagePoint) => DockImagePoint,
): DockMarkGeometry {
  if (geometry.kind === 'rect') {
    const a = map({ x: geometry.x, y: geometry.y });
    const b = map({ x: geometry.x + geometry.w, y: geometry.y + geometry.h });
    return {
      kind: 'rect',
      x: Math.min(a.x, b.x),
      y: Math.min(a.y, b.y),
      w: Math.abs(b.x - a.x),
      h: Math.abs(b.y - a.y),
    };
  }
  if (geometry.kind === 'arrow')
    return { kind: 'arrow', from: map(geometry.from), to: map(geometry.to) };
  return { kind: 'path', points: geometry.points.map(map) };
}

function rectOfPoints(points: readonly DockImagePoint[]): DockImageRect {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

export function dockGeometryRect(geometry: DockMarkGeometry): DockImageRect {
  if (geometry.kind === 'rect')
    return { x: geometry.x, y: geometry.y, w: geometry.w, h: geometry.h };
  return rectOfPoints(geometry.kind === 'arrow' ? [geometry.from, geometry.to] : geometry.points);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Drop non-finite points and decimate long strokes, keeping both ends. */
export function boundGesturePoints(points: unknown): DockImagePoint[] {
  if (!Array.isArray(points)) return [];
  const valid = points.filter(
    (point): point is DockImagePoint =>
      !!point && typeof point === 'object' && finite(point.x) && finite(point.y),
  );
  const max = DOCK_ANNOTATION_LIMITS.gesturePoints;
  if (valid.length <= max) return valid.map(({ x, y }) => ({ x, y }));
  const stride = Math.ceil(valid.length / max);
  const bounded = valid.filter((_, index) => index % stride === 0);
  if (bounded.at(-1) !== valid.at(-1)) bounded.push(valid.at(-1)!);
  return bounded.slice(-max).map(({ x, y }) => ({ x, y }));
}

/**
 * Overlay gesture → overlay-space mark geometry, or null when the gesture is too
 * small to be a shape. Pick returns null: its geometry comes from the element.
 */
export function gestureOverlayGeometry(
  tool: DockMarkTool,
  points: readonly DockImagePoint[],
): DockMarkGeometry | null {
  const min = DOCK_ANNOTATION_LIMITS.minShape;
  if (tool === 'pick' || points.length === 0) return null;
  if (tool === 'pen') {
    if (points.length < 2) return null;
    const bounds = rectOfPoints(points);
    return Math.max(bounds.w, bounds.h) < min ? null : { kind: 'path', points: [...points] };
  }
  const from = points[0]!;
  const to = points.at(-1)!;
  if (tool === 'arrow')
    return Math.hypot(to.x - from.x, to.y - from.y) < min * 2 ? null : { kind: 'arrow', from, to };
  const rect = rectOfPoints([from, to]);
  return rect.w < min || rect.h < min ? null : { kind: 'rect', ...rect };
}

/** Clamp overlay geometry into image pixels; null when nothing remains inside. */
export function overlayGeometryToImage(
  geometry: DockMarkGeometry,
  view: DockAnnotationViewport,
  image: { width: number; height: number },
): DockMarkGeometry | null {
  const inside = (point: DockImagePoint): DockImagePoint => {
    const p = overlayToImage(point, view);
    return { x: clamp(p.x, 0, image.width), y: clamp(p.y, 0, image.height) };
  };
  const mapped = mapDockGeometry(geometry, inside);
  const rect = dockGeometryRect(mapped);
  if (geometry.kind === 'rect' && (rect.w <= 0 || rect.h <= 0)) return null;
  if (geometry.kind !== 'rect' && rect.w <= 0 && rect.h <= 0) return null;
  return mapped;
}

export function pointInRects(point: DockImagePoint, rects: readonly DockAnnotationRect[]): boolean {
  return rects.some(
    (rect) =>
      point.x >= rect.x &&
      point.y >= rect.y &&
      point.x < rect.x + rect.width &&
      point.y < rect.y + rect.height,
  );
}

/**
 * A shape carries an element only when it lies mostly inside it: at least 80% of
 * the shape's bounds overlap the element, and the element is not a container
 * many times the shape's size (a window or page body).
 */
export function shapeMostlyInside(shape: DockImageRect, element: DockImageRect): boolean {
  const shapeArea = Math.max(1, shape.w) * Math.max(1, shape.h);
  const overlapW =
    Math.min(shape.x + Math.max(1, shape.w), element.x + element.w) - Math.max(shape.x, element.x);
  const overlapH =
    Math.min(shape.y + Math.max(1, shape.h), element.y + element.h) - Math.max(shape.y, element.y);
  if (overlapW <= 0 || overlapH <= 0) return false;
  return overlapW * overlapH >= shapeArea * 0.8 && element.w * element.h <= shapeArea * 6;
}

// ---------------------------------------------------------------------------
// Perceptual hash (16×16 difference hash → 256 bits, 64 hex chars)
// ---------------------------------------------------------------------------

const DOCK_HASH_SIZE = 16;

/**
 * Difference hash of a 17×16 bitmap (4 bytes per pixel; `order` names the
 * channel layout, e.g. BGRA from `nativeImage.toBitmap()`). Each bit compares a
 * pixel's luminance with its right neighbour.
 */
export function dockDifferenceHash(
  bitmap: Uint8Array,
  order: 'bgra' | 'rgba' = 'bgra',
): string | null {
  const columns = DOCK_HASH_SIZE + 1;
  if (bitmap.length < columns * DOCK_HASH_SIZE * 4) return null;
  const [r, g, b] = order === 'bgra' ? [2, 1, 0] : [0, 1, 2];
  const luma = (index: number) =>
    0.299 * bitmap[index * 4 + r]! +
    0.587 * bitmap[index * 4 + g]! +
    0.114 * bitmap[index * 4 + b]!;
  let hex = '';
  let nibble = 0;
  let bits = 0;
  for (let y = 0; y < DOCK_HASH_SIZE; y += 1) {
    for (let x = 0; x < DOCK_HASH_SIZE; x += 1) {
      const left = luma(y * columns + x);
      const right = luma(y * columns + x + 1);
      nibble = (nibble << 1) | (left > right ? 1 : 0);
      bits += 1;
      if (bits === 4) {
        hex += nibble.toString(16);
        nibble = 0;
        bits = 0;
      }
    }
  }
  return hex;
}

/** Hamming distance between two hashes; Infinity when they are not comparable. */
export function dockHashDistance(
  a: string | null | undefined,
  b: string | null | undefined,
): number {
  if (!a || !b || a.length !== b.length || !/^[0-9a-f]+$/.test(a + b)) return Infinity;
  let distance = 0;
  for (let index = 0; index < a.length; index += 1) {
    let diff = parseInt(a[index]!, 16) ^ parseInt(b[index]!, 16);
    while (diff) {
      distance += diff & 1;
      diff >>= 1;
    }
  }
  return distance;
}

// ---------------------------------------------------------------------------
// Native element metadata
// ---------------------------------------------------------------------------

/** `AXButton` → `button`, `AXStaticText` → `static text`; unknown shapes pass through. */
function normalizeAxRole(role: string): string {
  const bare = role.startsWith('AX') ? role.slice(2) : role;
  return bare
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .trim();
}

/** Raw element under a point (global DIP rect): accessibility, or Intent's own page. */
export interface DockAxElement {
  role: string;
  name: string;
  rect: DockAnnotationRect;
  /** DOM path, only when Intent's own page reported the element. */
  path?: string;
}

export function toDockMarkElement(element: DockAxElement | null): DockMarkElement | null {
  if (!element) return null;
  const role = normalizeAxRole(element.role ?? '');
  const name = (element.name ?? '').trim();
  if (!role && !name) return null;
  // Accessibility exposes no DOM path or source location; never infer one. Intent's
  // own page reports a real DOM path.
  return { role, name, path: element.path?.trim() || null, source: null };
}

/** `BrowserWindow.getMediaSourceId()` (`window:<id>:<n>`) → CGWindowID. */
export function dockWindowIdFromMediaSourceId(mediaSourceId: string): number | null {
  const match = /^window:(\d+):\d+$/.exec(mediaSourceId);
  if (!match) return null;
  const id = Number(match[1]);
  return Number.isSafeInteger(id) && id > 0 && id <= 0xffffffff ? id : null;
}
