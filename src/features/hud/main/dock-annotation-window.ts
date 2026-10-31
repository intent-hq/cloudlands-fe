/**
 * Dock composer annotation: one transparent, nonactivating overlay window on the
 * dock's display that turns pick/box/pen/arrow gestures into numbered marks.
 *
 * The dock stays the composer: it sits above the overlay, keeps keyboard focus
 * (Escape, Cmd+Z and 1–4 are handled there), and is authoritative for mark ids,
 * order and numbers — `syncMarks` redraws what it says. This controller only
 * owns the overlay window, gesture validation, element picking and the decision
 * of when a live mark needs a fresh image.
 *
 * Live marks: the gesture is frozen (session, tool, origin, geometry, clip time)
 * before any await. The first mark captures the dock display without the dock,
 * its owned popups or this overlay; later marks reuse that image unless the
 * screen's 16×16 difference hash moved by more than 12 bits or a navigation was
 * reported. Still marks use the frozen pixels they were started with and never
 * capture the desktop.
 */
import { randomUUID } from 'node:crypto';
import path, { dirname } from 'path';
import { fileURLToPath } from 'url';
import {
  BrowserWindow,
  ipcMain,
  nativeImage,
  screen,
  type Display,
  type IpcMainInvokeEvent,
} from 'electron';
import type {
  DockCapturedPixels,
  DockEvidenceNativeEvent,
  DockEvidenceImage,
  DockEvidenceNativeService,
  DockImagePoint,
  DockMarkElement,
  DockMarkGeometry,
  DockMarkTool,
  DockNativeResult,
} from '../../../shared/dock-evidence';
import { DOCK_MARK_TOOLS } from '../../../shared/dock-evidence';
import {
  DOCK_ANNOTATION_CHANNELS,
  DOCK_ANNOTATION_LIMITS,
  boundGesturePoints,
  dockAnnotationViewport,
  dockDifferenceHash,
  dockGeometryRect,
  dockHashDistance,
  dockWindowIdFromMediaSourceId,
  gestureOverlayGeometry,
  overlayGeometryToImage,
  pointInRects,
  sanitizeDockAnnotationMedia,
  shapeMostlyInside,
  toDockMarkElement,
  type DockAnnotationAck,
  type DockAnnotationGestureRequest,
  type DockAnnotationIssue,
  type DockAxElement,
  type DockAnnotationMode,
  type DockAnnotationOverlayState,
  type DockAnnotationPointerRequest,
  type DockAnnotationReadyRequest,
  type DockAnnotationRect,
  type DockAnnotationToolbarRequest,
  type DockToolbarAnchor,
  type DockSyncedMark,
  type DockAnnotationMediaState,
} from '../../../shared/dock-annotation';
import { Logger } from '../../../shared/logger';
import { stampWindowWithBackend } from '../../../main/window-backend';
import { registerDockAnnotationWindow } from '../../../main/dock-annotation-identity';
import {
  createDockElementPicker,
  type DockElementHit,
  type DockElementPicker,
} from './dock-element-pick';
import {
  inspectDockIntentWindow,
  type DockIntentWindowInspection,
  type DockIntentWindowRequest,
} from './dock-intent-window';

const __dirname = dirname(fileURLToPath(import.meta.url));
const logger = new Logger('DockAnnotation');

const READY_TIMEOUT_MS = 5_000;
const ROUTE_INTERVAL_MS = 33;
const HOLD_TIMEOUT_MS = 60_000;
/** Bound on one commit (helper + capture); a late result is discarded. */
const COMMIT_TIMEOUT_MS = 10_000;
const EXCLUSION_TIMEOUT_MS = 2_000;
const IDLE_DESTROY_MS = 60_000;

type AnnotationService = Pick<
  DockEvidenceNativeService,
  'startAnnotation' | 'setAnnotationTool' | 'syncMarks' | 'endAnnotation' | 'subscribe'
>;
type StartRequest = Parameters<DockEvidenceNativeService['startAnnotation']>[0];

interface DockAnnotationCaptured {
  png: Buffer;
  width: number;
  height: number;
  /** Actual pixels per DIP of this capture (may differ from the screen's when capped). */
  displayScale?: number;
  capturedAt?: string;
  /** Owner-assigned identity, passed through to the dock unchanged. */
  image?: DockEvidenceImage;
}

/** Supplied by the dock window/capture owner (`dockAnnotationController.configure`). */
export interface DockAnnotationHost {
  /** The display the dock is authoritatively on. */
  dockDisplay(): Display | null;
  /** GLOBAL DIP rects where gestures never start: dock surface, owned menus/popups. */
  excludedRects(): DockAnnotationRect[];
  /** CGWindowIDs of the dock and its owned popups (the overlay is added here). */
  excludedWindowIds(): number[];
  /** Clean capture of `display` without `excludeWindowIds`; must not hide the dock. */
  capture(
    display: Display,
    excludeWindowIds: number[],
  ): Promise<DockNativeResult<DockAnnotationCaptured>>;
  /** Screen-recording permission is known to be denied. */
  permissionDenied(): boolean;
  /** The owning dock document retired: no session may start or continue. */
  retired(): boolean;
  /** Observe reviewed-page navigation only while an annotation session is alive. */
  watchNavigation?(listener: () => void): () => void;
  /**
   * Optional: the person is annotating (a gesture or a tool bar click). Live dictation
   * treats it as activity, so its silence timer never ends the mic mid-markup.
   */
  onActivity?(): void;
  /** Optional: the dock's painted shell (GLOBAL DIP) and form; the tool bar sits beside it. */
  dockAnchor?(): DockToolbarAnchor | null;
  /** Elapsed time of the live clip, when one is recording. */
  clipMs(): number | undefined;
  /**
   * Optional: called synchronously at an accepted pointerdown, before any await,
   * so live speech/clip clocks are stamped at the real click time. The mark may
   * still be rejected later; an id that never arrives in a mark event is unused.
   */
  onGestureStart?(annotationId: string, markId: string): void;
  /**
   * Optional: exactly once for every started gesture. 'committed' fires right after
   * its mark event; 'rejected' when the commit failed; 'cancelled' when the pointer
   * sequence ended without a commit (cancel, blur, replacement, timeout, session end).
   */
  onGestureSettled?(annotationId: string, markId: string, outcome: DockGestureOutcome): void;
  /**
   * Optional recording-exclusion barrier, awaited before every show of the overlay
   * (which is still hidden; `windowId` is its CGWindowID). Resolve true once every
   * live recording acknowledged excluding it (immediately when nothing records).
   * False, a throw, or no answer within 2 s fails the start and the overlay is
   * never shown.
   */
  beforeOverlayShow?(windowId: number): Promise<boolean> | boolean;
  /** Exact backend binding of the dock document; the overlay is stamped with it before loading. */
  backendId(): string | null;
}

/** Native boundaries of this controller; tests replace them. */
export interface DockAnnotationNative {
  /** Must stamp `backendId` on the window before it loads its document. */
  createWindow(display: Display, backendId: string): BrowserWindow;
  cursor(): DockImagePoint;
  hash(png: Buffer): string | null;
  picker: Pick<DockElementPicker, 'hit' | 'access' | 'warm' | 'dispose'>;
  now(): number;
  id(): string;
  setInterval(callback: () => void, ms: number): () => void;
  setTimeout(callback: () => void, ms: number): () => void;
  onDisplaysChanged(listener: () => void): () => void;
  /** Intent's own window under a gesture: panel check and page element; 'other' for any other app. */
  intentWindow(
    windowId: number,
    request: DockIntentWindowRequest,
  ): Promise<DockIntentWindowInspection>;
}

interface Hold {
  sequence: number;
  origin: DockImagePoint;
  tool: DockMarkTool;
  /** Minted at the accepted pointerdown; the dock adopts it as the mark id. */
  markId: string;
  /** Epoch ms and clip offset of the pointerdown (the real click time). */
  atEpochMs: number;
  clipMs: number | undefined;
  cancelTimeout: () => void;
}

interface SessionImage {
  width: number;
  height: number;
  hash: string | null;
}

interface Session {
  id: string;
  mode: DockAnnotationMode;
  tool: DockMarkTool;
  display: Display;
  window: BrowserWindow;
  ready: boolean;
  /** Visible and excluded from live recordings; only then is it interactive. */
  revealed: boolean;
  readyWaiters: Array<(ok: boolean) => void>;
  ended: boolean;
  still: { imageId: string; pixels: DockCapturedPixels } | null;
  image: SessionImage | null;
  navigation: boolean;
  marks: DockSyncedMark[];
  marksRevision: number;
  hold: Hold | null;
  lastSequence: number;
  /** Serialises live commits so one image is created before the next mark compares. */
  queue: Promise<unknown>;
  interactive: boolean | null;
  excludedKey: string;
  /** Overlay-local rect of the on-screen tool bar: clickable, never a gesture origin. */
  toolbar: DockAnnotationRect | null;
  /** Mouse mode: click-through except the tool bar; no gesture starts. */
  mouse: boolean;
}

interface Lease {
  expired: boolean;
}

interface Frozen {
  session: Session;
  lease: Lease;
  tool: DockMarkTool;
  display: Display;
  origin: DockImagePoint;
  /** Overlay DIP of the gesture's last point (the origin for pick). */
  end: DockImagePoint;
  geometry: DockMarkGeometry | null;
  clipMs: number | undefined;
  markId: string;
  atEpochMs: number;
  excludeWindowIds: number[];
  /** Global DIP of the hit-test point for the element (pick: origin; shapes: centre). */
  elementPoint: DockImagePoint;
}

export type DockGestureOutcome = 'committed' | 'rejected' | 'cancelled';

const unavailable = <T>(): DockNativeResult<T> => ({ ok: false, error: 'unavailable' });
const reject = (
  reason: Extract<DockAnnotationAck, { ok: false }>['reason'],
): DockAnnotationAck => ({
  ok: false,
  reason,
});

/** The display's work area relative to its bounds; the whole display when unknown. */
function localWorkArea(display: Display): DockAnnotationRect {
  const { bounds } = display;
  const area = display.workArea;
  if (
    !area ||
    ![area.x, area.y, area.width, area.height].every(Number.isFinite) ||
    area.width <= 0 ||
    area.height <= 0
  )
    return { x: 0, y: 0, width: bounds.width, height: bounds.height };
  return { x: area.x - bounds.x, y: area.y - bounds.y, width: area.width, height: area.height };
}

function copyDisplay(display: Display): Display {
  return { ...display, bounds: { ...display.bounds } };
}

function sameDisplay(a: Display, b: Display | null | undefined): boolean {
  return (
    !!b &&
    a.id === b.id &&
    a.scaleFactor === b.scaleFactor &&
    a.bounds.x === b.bounds.x &&
    a.bounds.y === b.bounds.y &&
    a.bounds.width === b.bounds.width &&
    a.bounds.height === b.bounds.height
  );
}

function sameTarget(
  window: DockElementHit['window'],
  target: NonNullable<DockElementHit['window']>,
): boolean {
  return (
    !!window &&
    window.pid === target.pid &&
    window.windowId === target.windowId &&
    window.bounds.x === target.bounds.x &&
    window.bounds.y === target.bounds.y &&
    window.bounds.width === target.bounds.width &&
    window.bounds.height === target.bounds.height
  );
}

function pickStatus(access: DockElementHit['access']): DockAnnotationOverlayState['pick'] {
  return access === 'granted' ? 'ready' : access;
}

function windowIdOf(window: BrowserWindow): number | null {
  try {
    return dockWindowIdFromMediaSourceId(window.getMediaSourceId());
  } catch {
    return null;
  }
}

function usable(window: BrowserWindow | null | undefined): window is BrowserWindow {
  return !!window && !window.isDestroyed() && !window.webContents.isDestroyed();
}

const validTool = (tool: unknown): tool is DockMarkTool =>
  (DOCK_MARK_TOOLS as readonly unknown[]).includes(tool);

const finitePoint = (point: unknown): point is DockImagePoint =>
  !!point &&
  typeof point === 'object' &&
  Number.isFinite((point as DockImagePoint).x) &&
  Number.isFinite((point as DockImagePoint).y);

export class DockAnnotationController implements AnnotationService {
  private session: Session | null = null;
  /** The dock composer's Screenshot/Record state (see `setAnnotationMedia`). */
  private media: DockAnnotationMediaState | null = null;
  private window: BrowserWindow | null = null;
  private windowBackendId: string | null = null;
  /**
   * The session whose hidden overlay is behind the exclusion barrier; its id is
   * already reported. Only that session (or its finish) releases the reservation.
   */
  private revealing: Session | null = null;
  private windowCleanup: Array<() => void> = [];
  private cancelIdle: (() => void) | null = null;
  private stopRouting: (() => void) | null = null;
  private stopDisplays: (() => void) | null = null;
  private stopNavigation: (() => void) | null = null;
  private readonly listeners = new Set<(event: DockEvidenceNativeEvent) => void>();
  private readonly windowListeners = new Set<(ids: number[]) => void>();
  private readonly issueListeners = new Set<(issue: DockAnnotationIssue) => void>();
  private lastWindowIds = '[]';

  constructor(
    private host: DockAnnotationHost | null,
    private readonly native: DockAnnotationNative,
  ) {}

  configure(host: DockAnnotationHost | null): void {
    this.host = host;
    if (!host && this.session) this.finish(this.session, true);
  }

  // -------------------------------------------------------------------------
  // DockEvidenceNativeService (annotation half)
  // -------------------------------------------------------------------------

  isActive(): boolean {
    return !!this.session?.revealed && !this.session.ended;
  }

  subscribe(listener: (event: DockEvidenceNativeEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async startAnnotation(request: StartRequest): Promise<DockNativeResult<void>> {
    const host = this.host;
    if (!host || typeof request?.id !== 'string' || !request.id || !validTool(request.tool))
      return unavailable();
    if (!['live', 'still', 'dictation'].includes(request.mode)) return unavailable();
    if (host.retired()) return unavailable();
    const still = request.mode === 'still' ? request.still : undefined;
    if (request.mode === 'still' && !this.validStill(still)) return unavailable();
    if (request.mode !== 'still' && host.permissionDenied())
      return { ok: false, error: 'permission' };
    const selected = host.dockDisplay();
    if (!selected) return { ok: false, error: 'unavailable', detail: 'display' };
    const display = copyDisplay(selected);
    const backendId = host.backendId();
    if (!backendId) return unavailable();
    if (this.session) this.finish(this.session, false);

    let window: BrowserWindow;
    try {
      window = this.overlayFor(display, backendId);
    } catch (error) {
      logger.warn('Failed to create the dock annotation overlay', { error });
      return { ok: false, error: 'failed' };
    }
    const session: Session = {
      id: request.id,
      mode: request.mode,
      tool: request.tool,
      display,
      window,
      ready: false,
      revealed: false,
      readyWaiters: [],
      ended: false,
      still: still ? { imageId: still.imageId, pixels: still.pixels } : null,
      image: still ? { width: still.pixels.width, height: still.pixels.height, hash: null } : null,
      navigation: false,
      marks: [],
      marksRevision: 0,
      hold: null,
      lastSequence: 0,
      queue: Promise.resolve(),
      interactive: null,
      excludedKey: '',
      toolbar: null,
      mouse: false,
    };
    this.session = session;
    this.stopNavigation = host.watchNavigation?.(() => this.notifyNavigation()) ?? null;
    if (request.mode !== 'still') this.native.picker.warm();
    this.publish(session);

    const ready = await new Promise<boolean>((resolve) => {
      const cancel = this.native.setTimeout(() => resolve(false), READY_TIMEOUT_MS);
      session.readyWaiters.push((ok) => {
        cancel();
        resolve(ok);
      });
    });
    if (!ready || !this.current(session)) {
      // A start that never painted, as opposed to one replaced or ended meanwhile.
      const timedOut = !ready && this.current(session);
      if (this.session === session) this.finish(session, false);
      return timedOut
        ? { ok: false, error: 'unavailable', detail: 'overlay-timeout' }
        : unavailable();
    }
    // Recording-exclusion barrier: the hidden window's id is excluded from every
    // live recording before the overlay is ever shown or painted.
    const windowId = windowIdOf(window);
    if (host.beforeOverlayShow) {
      if (windowId === null) {
        this.finish(session, false);
        return { ok: false, error: 'failed', detail: 'recording-exclusion' };
      }
      this.revealing = session;
      this.announceWindows();
      const excluded = await this.exclusionBarrier(host, windowId);
      const stillValid =
        this.current(session) &&
        this.host === host &&
        sameDisplay(session.display, host.dockDisplay()) &&
        session.window === window &&
        windowIdOf(window) === windowId;
      if (!stillValid || !excluded) {
        // A replaced start never touches its successor's reservation or ids.
        if (this.revealing === session) this.revealing = null;
        if (this.session === session) this.finish(session, false);
        return excluded
          ? unavailable()
          : { ok: false, error: 'failed', detail: 'recording-exclusion' };
      }
    }
    try {
      window.setIgnoreMouseEvents(true, { forward: true });
      session.interactive = false;
      window.showInactive();
      session.revealed = true;
      if (this.revealing === session) this.revealing = null;
    } catch (error) {
      logger.warn('Failed to show the dock annotation overlay', { error });
      this.finish(session, false);
      return { ok: false, error: 'failed' };
    }
    this.announceWindows();
    this.startRouting();
    this.route();
    return { ok: true, value: undefined };
  }

  async setAnnotationTool(sessionId: string, tool: DockMarkTool): Promise<void> {
    const session = this.session;
    if (!session || session.id !== sessionId || session.ended || !validTool(tool)) return;
    // A held gesture keeps the tool it started with. Choosing a tool leaves mouse mode.
    session.tool = tool;
    session.mouse = false;
    this.publish(session);
    this.route();
  }

  private activity(): void {
    try {
      this.host?.onActivity?.();
    } catch (error) {
      logger.warn('Dock annotation activity hook failed', { error });
    }
  }

  /**
   * The dock composer's Screenshot/Record state for the tool bar. Kept across
   * sessions (the dock sends it on change, not per session), so a new session's
   * bar shows it at once.
   */
  setAnnotationMedia(media: unknown): void {
    const next = sanitizeDockAnnotationMedia(media);
    if (!next) return;
    this.media = next;
    const session = this.session;
    if (session && !session.ended) this.publish(session);
  }

  /** Mouse mode: use the screen normally; the session, marks and image stay. */
  async setAnnotationMouse(sessionId: string): Promise<void> {
    const session = this.session;
    if (!session || session.id !== sessionId || session.ended) return;
    this.enterMouse(session);
  }

  private enterMouse(session: Session): void {
    if (session.mouse) return;
    session.mouse = true;
    if (session.hold) this.release(session);
    this.publish(session);
    this.route();
  }

  async syncMarks(sessionId: string, marks: DockSyncedMark[]): Promise<void> {
    const session = this.session;
    if (!session || session.id !== sessionId || session.ended || !Array.isArray(marks)) return;
    session.marks = marks
      .filter(
        (mark) =>
          !!mark &&
          Number.isSafeInteger(mark.n) &&
          mark.n > 0 &&
          validTool(mark.tool) &&
          !!mark.geometry &&
          typeof mark.geometry === 'object',
      )
      .slice(0, 99)
      .map((mark) => ({ n: mark.n, tool: mark.tool, geometry: mark.geometry }));
    session.marksRevision += 1;
    this.publish(session);
  }

  async endAnnotation(sessionId: string): Promise<void> {
    const session = this.session;
    if (session && session.id === sessionId) this.finish(session, false);
  }

  /** Wait (bounded) for the host to confirm every live recording excludes `windowId`. */
  private async exclusionBarrier(host: DockAnnotationHost, windowId: number): Promise<boolean> {
    let cancel: () => void = () => {};
    const timeout = new Promise<boolean>((resolve) => {
      cancel = this.native.setTimeout(() => resolve(false), EXCLUSION_TIMEOUT_MS);
    });
    try {
      return await Promise.race([
        Promise.resolve(host.beforeOverlayShow?.(windowId)).then((ok) => ok === true),
        timeout,
      ]);
    } catch {
      return false;
    } finally {
      cancel();
    }
  }

  // -------------------------------------------------------------------------
  // Extras for the dock/recorder owners
  // -------------------------------------------------------------------------

  /** CGWindowIDs of the overlay, for continuous capture/recording exclusion. */
  /**
   * CGWindowIDs of the visible overlay, for capture/recording exclusion. A hidden
   * retained overlay is not on screen and is never reported.
   */
  overlayWindowIds(): number[] {
    const window = this.window;
    const reserved = !!this.revealing && this.revealing === this.session && !this.revealing.ended;
    if (!usable(window) || !(window.isVisible() || reserved)) return [];
    const id = windowIdOf(window);
    return id === null ? [] : [id];
  }

  onOverlayWindowsChanged(listener: (ids: number[]) => void): () => void {
    this.windowListeners.add(listener);
    return () => this.windowListeners.delete(listener);
  }

  /** Typed permission/availability failures, for the dock's settings affordance. */
  onIssue(listener: (issue: DockAnnotationIssue) => void): () => void {
    this.issueListeners.add(listener);
    return () => this.issueListeners.delete(listener);
  }

  /**
   * Accessibility was granted while running: drop the idle picker helper so the
   * next session starts one that sees the grant (a live session keeps its own).
   */
  refreshPicker(): void {
    if (!this.session) this.native.picker.dispose();
  }

  /** A route change or navigation: the next live mark starts a new image. */
  notifyNavigation(): void {
    if (this.session && !this.session.ended && this.session.mode !== 'still')
      this.session.navigation = true;
  }

  /** Retire native resources without disconnecting the binder's persistent subscribers. */
  retireResources(): void {
    if (this.session) this.finish(this.session, false);
    this.destroyWindow();
    this.native.picker.dispose();
    this.media = null;
  }

  dispose(): void {
    this.retireResources();
    this.listeners.clear();
    this.windowListeners.clear();
    this.issueListeners.clear();
  }

  // -------------------------------------------------------------------------
  // Overlay IPC
  // -------------------------------------------------------------------------

  /** True when `event` comes from the overlay document's own main frame. */
  isOverlaySender(event: Pick<IpcMainInvokeEvent, 'sender' | 'senderFrame'>): boolean {
    const window = this.window;
    return (
      usable(window) &&
      event.sender === window.webContents &&
      !!event.senderFrame &&
      event.senderFrame === window.webContents.mainFrame
    );
  }

  handleReady(request: DockAnnotationReadyRequest): DockAnnotationOverlayState | null {
    const session = this.session;
    if (!session || session.ended || session.window !== this.window) return null;
    if (request?.sessionId === session.id && !session.ready) {
      session.ready = true;
      for (const waiter of session.readyWaiters.splice(0)) waiter(true);
    }
    return this.stateOf(session);
  }

  handleStill(request: { sessionId?: unknown }): { dataUrl: string } | null {
    const session = this.session;
    if (!session || session.ended || session.id !== request?.sessionId || !session.still)
      return null;
    const { mimeType, base64 } = session.still.pixels;
    return { dataUrl: `data:${mimeType};base64,${base64}` };
  }

  /**
   * The overlay's on-screen tool bar: switch tools, end the session (marks stay),
   * or report where the bar sits so it stays clickable and never starts a mark.
   */
  handleToolbar(request: DockAnnotationToolbarRequest): boolean {
    const session = this.session;
    if (
      !session ||
      !session.revealed ||
      !this.current(session) ||
      request?.sessionId !== session.id
    )
      return false;
    if (request.action !== 'rect') this.activity();
    if (request.action === 'tool') {
      if (!validTool(request.tool)) return false;
      if (session.tool !== request.tool || session.mouse) {
        session.tool = request.tool;
        session.mouse = false;
        this.publish(session);
        this.route();
      }
      this.emit({ type: 'annotation-tool', sessionId: session.id, tool: request.tool });
      return true;
    }
    if (request.action === 'mouse') {
      this.enterMouse(session);
      return true;
    }
    if (request.action === 'commit') {
      // The marked image is the dock's now; the screen starts clean, and the next
      // mark captures a new image. The session (and mouse mode, if on) stays.
      if (session.mode !== 'still') {
        session.image = null;
        session.marks = [];
        session.marksRevision += 1;
        this.publish(session);
      }
      this.emit({ type: 'annotation-commit', sessionId: session.id });
      // Then straight to mouse mode, so the person can scroll and click right away;
      // choosing a tool resumes annotating.
      if (this.current(session) && session.mode !== 'still') this.enterMouse(session);
      return true;
    }
    if (request.action === 'clear') {
      // Like Done, the screen starts clean and the next mark captures a new image,
      // but nothing is attached (the dock drops the image) and the tool stays.
      if (session.mode !== 'still') {
        session.image = null;
        session.marks = [];
        session.marksRevision += 1;
        this.publish(session);
      }
      this.emit({ type: 'annotation-clear', sessionId: session.id });
      return true;
    }
    if (request.action === 'end') {
      this.finish(session, true);
      return true;
    }
    if (request.action === 'capture' || request.action === 'record') {
      // The dock runs the composer's own action (and its permission and limit
      // rules); the session, its tool and mouse mode stay as they are.
      this.emit({ type: 'annotation-media', sessionId: session.id, action: request.action });
      return true;
    }
    if (request.action === 'rect') {
      const rect = request.rect;
      session.toolbar =
        rect && [rect.x, rect.y, rect.width, rect.height].every(Number.isFinite)
          ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
          : null;
      this.route();
      return true;
    }
    return false;
  }

  handlePointer(request: DockAnnotationPointerRequest): DockAnnotationAck {
    const session = this.session;
    if (
      !session ||
      !session.revealed ||
      !this.current(session) ||
      request?.sessionId !== session.id
    )
      return reject('stale');
    if (!Number.isSafeInteger(request.sequence)) return reject('invalid');
    if (request.phase === 'cancel') {
      if (session.hold?.sequence === request.sequence) this.release(session);
      return { ok: true };
    }
    if (request.phase !== 'down' || !finitePoint(request) || !validTool(request.tool))
      return reject('invalid');
    // Sequences only move forward: a replayed or reordered pointerdown is stale.
    if (request.sequence <= session.lastSequence) return reject('stale');
    session.lastSequence = request.sequence;
    // Mouse mode makes no marks (the overlay is click-through there anyway).
    if (session.mouse) return reject('excluded');
    if (request.tool !== session.tool) return reject('stale');
    const origin = { x: request.x, y: request.y };
    if (!this.insideDisplay(session, origin)) return reject('outside');
    if (this.excludedAt(session, origin)) return reject('excluded');
    if (session.hold) this.release(session);
    const clipMs = this.host?.clipMs();
    session.hold = {
      sequence: request.sequence,
      origin,
      tool: session.tool,
      markId: this.native.id(),
      atEpochMs: this.native.now(),
      clipMs: clipMs !== undefined && Number.isFinite(clipMs) && clipMs >= 0 ? clipMs : undefined,
      cancelTimeout: this.native.setTimeout(() => {
        if (session.hold?.sequence === request.sequence) this.release(session);
      }, HOLD_TIMEOUT_MS),
    };
    this.setInteractive(session, true);
    this.activity();
    try {
      this.host?.onGestureStart?.(session.id, session.hold.markId);
    } catch (error) {
      logger.warn('Dock annotation gesture-start hook failed', { error });
    }
    return { ok: true };
  }

  async handleGesture(request: DockAnnotationGestureRequest): Promise<DockAnnotationAck> {
    const session = this.session;
    if (!session || !this.current(session) || request?.sessionId !== session.id)
      return reject('stale');
    const hold = session.hold;
    if (!hold || hold.sequence !== request.sequence) return reject('stale');
    this.release(session, null);
    // A commit that outlives the deadline (hung capture or helper) can never emit.
    const lease: Lease = { expired: false };
    let cancelDeadline: () => void = () => {};
    const deadline = new Promise<DockAnnotationAck>((resolve) => {
      cancelDeadline = this.native.setTimeout(() => {
        lease.expired = true;
        resolve(reject('failed'));
      }, COMMIT_TIMEOUT_MS);
    });
    let ack: DockAnnotationAck;
    try {
      ack = await Promise.race([this.commitGesture(session, hold, request, lease), deadline]);
    } catch (error) {
      logger.warn('Dock annotation mark failed', { error });
      ack = reject('failed');
    } finally {
      lease.expired = true;
      cancelDeadline();
    }
    if (!ack.ok) {
      logger.info('Dock annotation gesture refused', { tool: hold.tool, reason: ack.reason });
      // A commit that failed without its own notice (deadline, helper or capture
      // error) still tells the dock, so the shape never vanishes without a reason.
      if (ack.reason === 'failed' && this.current(session))
        this.refuse(session, 'capture', 'unavailable');
    }
    // Exactly once per started gesture, after the mark event when committed.
    this.settle(session, hold, ack.ok ? 'committed' : 'rejected');
    return ack;
  }

  private async commitGesture(
    session: Session,
    hold: Hold,
    request: DockAnnotationGestureRequest,
    lease: Lease,
  ): Promise<DockAnnotationAck> {
    if (
      !finitePoint(request.origin) ||
      Math.abs(request.origin.x - hold.origin.x) > 0.5 ||
      Math.abs(request.origin.y - hold.origin.y) > 0.5 ||
      request.tool !== hold.tool
    )
      return reject('stale');
    const frozen = this.freeze(session, hold, request, lease);
    if (!frozen) return reject('invalid');
    if (session.mode === 'still') return this.commitStill(frozen);
    const result = session.queue.then(() =>
      lease.expired ? reject('failed') : this.commitLive(frozen),
    );
    // The next commit waits for this one, but never past its deadline.
    session.queue = Promise.race([
      result,
      new Promise((resolve) => this.native.setTimeout(() => resolve(undefined), COMMIT_TIMEOUT_MS)),
    ]).catch(() => undefined);
    return result;
  }

  // -------------------------------------------------------------------------
  // Commit
  // -------------------------------------------------------------------------

  private freeze(
    session: Session,
    hold: Hold,
    request: DockAnnotationGestureRequest,
    lease: Lease,
  ): Frozen | null {
    const points = boundGesturePoints(request.points);
    if (!points.length) return null;
    // The pointerdown origin is authoritative for where the gesture began.
    points[0] = { ...hold.origin };
    const geometry = gestureOverlayGeometry(hold.tool, points);
    if (hold.tool !== 'pick' && !geometry) return null;
    const { x: dx, y: dy } = session.display.bounds;
    const centre = geometry
      ? (() => {
          const rect = dockGeometryRect(geometry);
          return { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
        })()
      : hold.origin;
    const host = this.host;
    return {
      session,
      lease,
      tool: hold.tool,
      display: session.display,
      origin: { ...hold.origin },
      end: hold.tool === 'pick' ? { ...hold.origin } : { ...points.at(-1)! },
      geometry,
      clipMs: hold.clipMs,
      markId: hold.markId,
      atEpochMs: hold.atEpochMs,
      excludeWindowIds: [
        ...new Set([...(host?.excludedWindowIds() ?? []), ...this.overlayWindowIds()]),
      ],
      elementPoint: { x: dx + centre.x, y: dy + centre.y },
    };
  }

  private commitStill(frozen: Frozen): DockAnnotationAck {
    const { session } = frozen;
    // A frozen image has no live element under it, and a pick needs one: never invent it.
    if (frozen.tool === 'pick') return this.refuse(session, 'pick', 'unavailable');
    const image = session.image;
    const view = image && dockAnnotationViewport(session.display.bounds, image, 'still');
    if (!image || !view || !session.still || !frozen.geometry) return reject('failed');
    const geometry = overlayGeometryToImage(frozen.geometry, view, image);
    if (!geometry) return reject('outside');
    return this.emitMark(frozen, geometry, null) ? { ok: true } : reject('stale');
  }

  private async commitLive(frozen: Frozen): Promise<DockAnnotationAck> {
    const { session, display } = frozen;
    const host = this.host;
    // Every await is fenced by the session and the commit deadline before any state changes.
    const live = () => !frozen.lease.expired && this.current(session);
    if (!host || !live()) return reject('stale');
    const { x: dx, y: dy } = display.bounds;
    const originGlobal = { x: dx + frozen.origin.x, y: dy + frozen.origin.y };
    const endGlobal = { x: dx + frozen.end.x, y: dy + frozen.end.y };
    const pick = frozen.tool === 'pick';
    const samePoint =
      originGlobal.x === frozen.elementPoint.x && originGlobal.y === frozen.elementPoint.y;

    // 1. The target: the app window (and for pick, its element) under the origin.
    const [originHit, elementHit] = await Promise.all([
      this.native.picker.hit(originGlobal, { element: pick || samePoint }),
      pick || samePoint
        ? Promise.resolve<DockElementHit | null>(null)
        : this.native.picker.hit(frozen.elementPoint, { element: true }),
    ]);
    if (!live()) return reject('stale');
    if (!originHit.checked) return this.refuse(session, 'target', 'unavailable');
    // Dock, menus, desktop, menu bar and other system surfaces are never targets.
    if (!originHit.window) {
      logger.info('Dock annotation mark refused: no app window under it', { tool: frozen.tool });
      return reject('outside');
    }
    const target = { ...originHit.window, bounds: { ...originHit.window.bounds } };
    if (!pick && !pointInRects(endGlobal, [target.bounds])) {
      logger.info('Dock annotation mark refused: it leaves its window', { tool: frozen.tool });
      return reject('outside');
    }
    // Intent's own main window: its page says where the browser panel is (never
    // markable) and which element is under the gesture.
    const own = await this.native.intentWindow(target.windowId, {
      panelPoints: pick ? [originGlobal] : [originGlobal, endGlobal, frozen.elementPoint],
      elementPoint: pick ? originGlobal : frozen.elementPoint,
    });
    if (!live()) return reject('stale');
    if (own.kind === 'failed') return reject('failed');
    // Intent's browser panel is a separate page: a drawn mark keeps its screenshot
    // without an element; a pick has nothing to name there.
    if (own.kind === 'intent' && own.inPanel && pick)
      return this.refuse(session, 'pick', 'unavailable');
    let ax: DockAxElement | null;
    if (own.kind === 'intent') {
      ax = own.inPanel ? null : own.element;
      if (pick && (!ax || !toDockMarkElement(ax)))
        return this.refuse(session, 'pick', 'unavailable');
    } else if (pick) {
      if (originHit.access !== 'granted')
        return this.refuse(
          session,
          'pick',
          originHit.access === 'permission' ? 'permission' : 'unavailable',
        );
      ax = originHit.element;
      if (!ax || !toDockMarkElement(ax)) return this.refuse(session, 'pick', 'unavailable');
    } else {
      ax = (samePoint ? originHit : elementHit)?.element ?? null;
    }
    const frozenElement = ax ? { ...ax, rect: { ...ax.rect } } : null;

    // 2. Clean capture of the dock display without the dock, its popups or this overlay.
    const captured = await host
      .capture(display, frozen.excludeWindowIds)
      .catch((): DockNativeResult<DockAnnotationCaptured> => ({ ok: false, error: 'failed' }));
    if (!live() || !sameDisplay(display, host.dockDisplay())) return reject('stale');
    if (!captured.ok) {
      // A drawn mark is never dropped silently: the dock says why (Settings for permission).
      logger.warn('Dock annotation capture failed; the mark was not made', {
        error: captured.error,
        detail: 'detail' in captured ? captured.detail : undefined,
      });
      return this.refuse(
        session,
        'capture',
        captured.error === 'permission' ? 'permission' : 'unavailable',
      );
    }
    const shot = captured.value;
    if (
      !shot.png?.length ||
      !Number.isInteger(shot.width) ||
      !Number.isInteger(shot.height) ||
      shot.width <= 0 ||
      shot.height <= 0
    )
      return reject('failed');
    // A frame of another display (or a cropped one) never lines up with the gesture.
    const aspect = display.bounds.width / display.bounds.height;
    if (Math.abs(shot.width / shot.height - aspect) > aspect * 0.01) return reject('failed');

    // 3. Late-capture fence: the target window must not have moved or changed meanwhile.
    const after = await this.native.picker.hit(originGlobal, { element: false });
    if (!live() || !sameDisplay(display, host.dockDisplay())) return reject('stale');
    if (!after.checked || !sameTarget(after.window, target)) return reject('stale');

    const hash = this.native.hash(shot.png);
    const previous = session.image;
    // Without two comparable hashes a change cannot be shown, so the image is kept.
    const comparable = !!previous?.hash && !!hash;
    const reuse =
      !!previous &&
      !session.navigation &&
      previous.width === shot.width &&
      previous.height === shot.height &&
      (!comparable ||
        dockHashDistance(previous.hash, hash) <= DOCK_ANNOTATION_LIMITS.hashThreshold);
    const image: SessionImage = reuse
      ? previous!
      : { width: shot.width, height: shot.height, hash };
    const view = dockAnnotationViewport(display.bounds, image, session.mode);
    if (!view) return reject('failed');

    let geometry: DockMarkGeometry | null;
    let element: DockMarkElement | null = null;
    if (pick) {
      const rect = frozenElement!.rect;
      geometry = overlayGeometryToImage(
        { kind: 'rect', x: rect.x - dx, y: rect.y - dy, w: rect.width, h: rect.height },
        view,
        image,
      );
      element = toDockMarkElement(frozenElement);
    } else {
      geometry = overlayGeometryToImage(frozen.geometry!, view, image);
      if (geometry && frozenElement) {
        const { rect } = frozenElement;
        const inside = shapeMostlyInside(dockGeometryRect(frozen.geometry!), {
          x: rect.x - dx,
          y: rect.y - dy,
          w: rect.width,
          h: rect.height,
        });
        element = inside ? toDockMarkElement(frozenElement) : null;
      }
    }
    if (!geometry) return reject('outside');

    let capture: DockCapturedPixels | undefined;
    if (!reuse) {
      // Keep the capture's actual metadata; the hash is this controller's own dHash
      // so session comparisons are always like with like.
      const scale =
        typeof shot.displayScale === 'number' &&
        Number.isFinite(shot.displayScale) &&
        shot.displayScale > 0
          ? shot.displayScale
          : display.scaleFactor;
      const capturedAt =
        typeof shot.capturedAt === 'string' && shot.capturedAt
          ? shot.capturedAt
          : new Date(this.native.now()).toISOString();
      const identity =
        shot.image &&
        shot.image.width === shot.width &&
        shot.image.height === shot.height &&
        shot.image.displayScale === scale
          ? { image: { ...shot.image, ...(hash ? { hash } : {}) } }
          : {};
      capture = {
        base64: shot.png.toString('base64'),
        mimeType: 'image/png',
        width: shot.width,
        height: shot.height,
        displayScale: scale,
        capturedAt,
        ...(hash ? { hash } : {}),
        ...identity,
      };
      session.image = image;
      session.navigation = false;
      // Outlines of the previous image no longer describe the screen.
      if (previous) {
        session.marks = [];
        this.publish(session);
      }
    }
    return this.emitMark(frozen, geometry, element, capture) ? { ok: true } : reject('stale');
  }

  /** A genuine permission/availability failure: no capture, no mark, and the dock is told. */
  private refuse(
    session: Session,
    kind: DockAnnotationIssue['kind'],
    error: DockAnnotationIssue['error'],
  ): DockAnnotationAck {
    const issue: DockAnnotationIssue = { sessionId: session.id, kind, error };
    for (const listener of [...this.issueListeners]) {
      try {
        listener(issue);
      } catch (err) {
        logger.warn('Dock annotation issue listener failed', { error: err });
      }
    }
    return reject(error);
  }

  private emitMark(
    frozen: Frozen,
    geometry: DockMarkGeometry,
    element: DockMarkElement | null,
    capture?: DockCapturedPixels,
  ): boolean {
    if (frozen.lease.expired || !this.current(frozen.session)) return false;
    this.emit({
      type: 'mark',
      sessionId: frozen.session.id,
      tool: frozen.tool,
      geometry,
      element,
      ...(capture ? { capture } : {}),
      markId: frozen.markId,
      gestureAtEpochMs: frozen.atEpochMs,
      ...(frozen.clipMs !== undefined && Number.isFinite(frozen.clipMs) && frozen.clipMs >= 0
        ? { clipMs: Math.round(frozen.clipMs) }
        : {}),
    });
    return true;
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  private current(session: Session): boolean {
    return (
      this.session === session &&
      !session.ended &&
      session.window === this.window &&
      usable(session.window)
    );
  }

  private validStill(still: StartRequest['still']): still is NonNullable<StartRequest['still']> {
    const pixels = still?.pixels;
    return (
      !!still &&
      typeof still.imageId === 'string' &&
      !!still.imageId &&
      !!pixels &&
      typeof pixels.base64 === 'string' &&
      pixels.base64.length > 0 &&
      ['image/png', 'image/jpeg', 'image/webp'].includes(pixels.mimeType) &&
      Number.isInteger(pixels.width) &&
      Number.isInteger(pixels.height) &&
      pixels.width > 0 &&
      pixels.height > 0
    );
  }

  private finish(session: Session, notify: boolean): void {
    if (session.ended) return;
    session.ended = true;
    if (this.revealing === session) this.revealing = null;
    if (session.hold) this.release(session);
    for (const waiter of session.readyWaiters.splice(0)) waiter(false);
    if (this.session === session) {
      this.session = null;
      this.stopNavigation?.();
      this.stopNavigation = null;
      this.stopRouting?.();
      this.stopRouting = null;
      this.hideWindow();
    }
    if (notify) this.emit({ type: 'annotation-ended', sessionId: session.id });
  }

  /** Drop the held gesture; unless it is being committed, its reservation is cancelled. */
  private release(session: Session, outcome: 'cancelled' | null = 'cancelled'): void {
    const hold = session.hold;
    if (!hold) return;
    hold.cancelTimeout();
    session.hold = null;
    if (outcome) this.settle(session, hold, outcome);
  }

  private settle(session: Session, hold: Hold, outcome: DockGestureOutcome): void {
    try {
      this.host?.onGestureSettled?.(session.id, hold.markId, outcome);
    } catch (error) {
      logger.warn('Dock annotation gesture-settled hook failed', { error });
    }
  }

  private emit(event: DockEvidenceNativeEvent): void {
    for (const listener of [...this.listeners]) {
      try {
        listener(event);
      } catch (error) {
        logger.warn('Dock annotation listener failed', { error });
      }
    }
  }

  private stateOf(session: Session): DockAnnotationOverlayState {
    const { bounds } = session.display;
    return {
      sessionId: session.id,
      mode: session.mode,
      tool: session.tool,
      display: { width: bounds.width, height: bounds.height },
      image: session.image ? { width: session.image.width, height: session.image.height } : null,
      still: session.still
        ? {
            imageId: session.still.imageId,
            width: session.still.pixels.width,
            height: session.still.pixels.height,
          }
        : null,
      marks: session.marks,
      marksRevision: session.marksRevision,
      excluded: this.localExcluded(session),
      pick: session.mode === 'still' ? 'unavailable' : pickStatus(this.native.picker.access()),
      displayId: session.display.id,
      workArea: localWorkArea(session.display),
      dock: this.localDock(session),
      mouse: session.mouse,
      media: this.media,
    };
  }

  /** The dock's painted shell in overlay-local DIP, when it is on this display. */
  private localDock(session: Session): DockToolbarAnchor | null {
    let anchor: DockToolbarAnchor | null = null;
    try {
      anchor = this.host?.dockAnchor?.() ?? null;
    } catch {
      anchor = null;
    }
    const rect = anchor?.rect;
    if (
      !anchor ||
      !rect ||
      ![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) ||
      rect.width <= 0 ||
      rect.height <= 0
    )
      return null;
    const { x, y } = session.display.bounds;
    return {
      rect: { x: rect.x - x, y: rect.y - y, width: rect.width, height: rect.height },
      shape: anchor.shape,
      ...(anchor.side ? { side: anchor.side } : {}),
    };
  }

  private publish(session: Session | null): void {
    const window = this.window;
    if (!usable(window)) return;
    try {
      window.webContents.send(
        DOCK_ANNOTATION_CHANNELS.STATE,
        session && !session.ended ? this.stateOf(session) : null,
      );
    } catch (error) {
      logger.warn('Failed to publish dock annotation state', { error });
    }
  }

  private localExcluded(session: Session): DockAnnotationRect[] {
    const { x, y } = session.display.bounds;
    return (this.host?.excludedRects() ?? [])
      .filter((rect) => [rect?.x, rect?.y, rect?.width, rect?.height].every(Number.isFinite))
      .map((rect) => ({ x: rect.x - x, y: rect.y - y, width: rect.width, height: rect.height }));
  }

  private insideDisplay(session: Session, point: DockImagePoint): boolean {
    const { width, height } = session.display.bounds;
    return point.x >= 0 && point.y >= 0 && point.x < width && point.y < height;
  }

  private excludedAt(session: Session, local: DockImagePoint): boolean {
    return (
      pointInRects(local, this.localExcluded(session)) ||
      (!!session.toolbar && pointInRects(local, [session.toolbar]))
    );
  }

  private setInteractive(session: Session, interactive: boolean): void {
    if (session.interactive === interactive || !usable(session.window)) return;
    try {
      session.window.setIgnoreMouseEvents(!interactive, { forward: true });
      session.interactive = interactive;
    } catch (error) {
      logger.warn('Failed to route dock annotation pointer', { error });
    }
  }

  /** Pointer routing, dock-display tracking and excluded-rect publishing. */
  private route(): void {
    const session = this.session;
    if (!session || !session.revealed) return;
    if (!this.current(session)) {
      this.finish(session, true);
      return;
    }
    const host = this.host;
    if (!host || host.retired() || !sameDisplay(session.display, host.dockDisplay())) {
      this.finish(session, true);
      return;
    }
    const excluded = this.localExcluded(session);
    // The dock moving, expanding or collapsing republishes, so the tool bar follows it.
    const key = JSON.stringify([excluded, this.localDock(session)]);
    if (key !== session.excludedKey) {
      session.excludedKey = key;
      this.publish(session);
    }
    if (session.hold) {
      this.setInteractive(session, true);
      return;
    }
    const cursor = this.native.cursor();
    const local = {
      x: cursor.x - session.display.bounds.x,
      y: cursor.y - session.display.bounds.y,
    };
    // The tool bar takes clicks itself; it is never a gesture origin (excludedAt).
    const onToolbar = !!session.toolbar && pointInRects(local, [session.toolbar]);
    this.setInteractive(
      session,
      onToolbar ||
        (!session.mouse && this.insideDisplay(session, local) && !pointInRects(local, excluded)),
    );
  }

  private startRouting(): void {
    this.stopRouting?.();
    this.stopRouting = this.native.setInterval(() => this.route(), ROUTE_INTERVAL_MS);
    if (!this.stopDisplays)
      this.stopDisplays = this.native.onDisplaysChanged(() => {
        const session = this.session;
        if (session && !sameDisplay(session.display, this.host?.dockDisplay()))
          this.finish(session, true);
      });
  }

  private overlayFor(display: Display, backendId: string): BrowserWindow {
    this.cancelIdle?.();
    this.cancelIdle = null;
    let window = this.window;
    // A retained overlay is reused only for the same backend binding.
    if (usable(window) && this.windowBackendId === backendId) {
      window.setBounds({ ...display.bounds });
      return window;
    }
    this.destroyWindow();
    window = this.native.createWindow(display, backendId);
    this.window = window;
    this.windowBackendId = backendId;
    const current = window;
    const onGone = () => {
      if (this.window !== current) return;
      const session = this.session;
      if (session) this.finish(session, true);
      this.destroyWindow();
    };
    const onLoading = () => {
      // A reload loses the overlay's gesture state: the session cannot continue.
      const session = this.session;
      if (this.window === current && session?.ready) this.finish(session, true);
    };
    current.on('closed', onGone);
    current.webContents.on('render-process-gone', onGone);
    current.webContents.on('did-start-loading', onLoading);
    this.windowCleanup.push(() => {
      current.removeListener('closed', onGone);
      if (!current.webContents.isDestroyed()) {
        current.webContents.removeListener('render-process-gone', onGone);
        current.webContents.removeListener('did-start-loading', onLoading);
      }
    });
    return current;
  }

  private hideWindow(): void {
    const window = this.window;
    if (usable(window)) {
      try {
        window.setIgnoreMouseEvents(true, { forward: true });
        window.hide();
      } catch (error) {
        logger.warn('Failed to hide the dock annotation overlay', { error });
      }
      this.publish(null);
      this.announceWindows();
    }
    this.cancelIdle?.();
    this.cancelIdle = this.native.setTimeout(() => {
      this.cancelIdle = null;
      if (this.session) return;
      this.destroyWindow();
      // The accessibility helper idles with the overlay; the next session warms it again.
      this.native.picker.dispose();
    }, IDLE_DESTROY_MS);
  }

  private destroyWindow(): void {
    this.cancelIdle?.();
    this.cancelIdle = null;
    this.stopDisplays?.();
    this.stopDisplays = null;
    for (const cleanup of this.windowCleanup.splice(0)) cleanup();
    const window = this.window;
    this.window = null;
    this.windowBackendId = null;
    if (window && !window.isDestroyed()) window.destroy();
    this.announceWindows();
  }

  private announceWindows(): void {
    const ids = this.overlayWindowIds();
    const key = JSON.stringify(ids);
    if (key === this.lastWindowIds) return;
    this.lastWindowIds = key;
    for (const listener of [...this.windowListeners]) {
      try {
        listener(ids);
      } catch (error) {
        logger.warn('Dock annotation window listener failed', { error });
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Electron defaults
// ---------------------------------------------------------------------------

function routeUrl(route: string): string {
  if (process.env.NODE_ENV === 'development')
    return `http://127.0.0.1:${process.env.DEV_PORT || '5190'}${route}`;
  return `app://workspaces${route}`;
}

function createOverlayWindow(display: Display, backendId: string): BrowserWindow {
  const window = new BrowserWindow({
    ...display.bounds,
    show: false,
    frame: false,
    // Cover the full display (including under the menu bar) so marks line up with captures.
    enableLargerThanScreen: process.platform === 'darwin',
    transparent: true,
    // Nonactivating panel that never becomes key: the dock keeps keyboard focus.
    ...(process.platform === 'darwin' ? { type: 'panel' as const } : {}),
    focusable: false,
    acceptFirstMouse: true,
    backgroundColor: '#00000000',
    skipTaskbar: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, '../../../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // The overlay paints its first frame while still hidden (the ready handshake waits
      // for it); a throttled hidden window never runs that frame and the start times out.
      backgroundThrottling: false,
    },
  });
  // Classified as the dock annotation overlay before any document (even about:blank) loads.
  registerDockAnnotationWindow(window);
  // One step below the dock's floating level so the dock stays the composer above it.
  window.setAlwaysOnTop(true, 'floating', -1);
  if (process.platform === 'darwin')
    window.setVisibleOnAllWorkspaces(true, {
      visibleOnFullScreen: true,
      skipTransformProcessType: true,
    });
  window.setIgnoreMouseEvents(true, { forward: true });
  // The same backend binding as the dock survives the renderer bootstrap.
  stampWindowWithBackend(window, backendId);
  void window.loadURL(routeUrl('/dock-annotation')).catch((error) => {
    logger.warn('Failed to load the dock annotation overlay', { error });
  });
  return window;
}

function hashPng(png: Buffer): string | null {
  try {
    const image = nativeImage.createFromBuffer(png);
    if (image.isEmpty()) return null;
    const small = image.resize({ width: 17, height: 16, quality: 'good' });
    return dockDifferenceHash(new Uint8Array(small.toBitmap()), 'bgra');
  } catch {
    return null;
  }
}

export const dockAnnotationController = new DockAnnotationController(null, {
  createWindow: createOverlayWindow,
  cursor: () => screen.getCursorScreenPoint(),
  hash: hashPng,
  picker: createDockElementPicker(),
  intentWindow: inspectDockIntentWindow,
  now: Date.now,
  id: randomUUID,
  setInterval: (callback, ms) => {
    const timer = setInterval(callback, ms);
    return () => clearInterval(timer);
  },
  setTimeout: (callback, ms) => {
    const timer = setTimeout(callback, ms);
    return () => clearTimeout(timer);
  },
  onDisplaysChanged: (listener) => {
    const events = ['display-added', 'display-removed', 'display-metrics-changed'] as const;
    for (const name of events) screen.on(name as 'display-added', listener);
    return () => {
      for (const name of events) screen.removeListener(name as 'display-added', listener);
    };
  },
});

/**
 * Reports top-level navigations (including in-page route changes) of `contents` so
 * the next live mark starts a new session image. The dock and the markup overlay
 * are Intent's own surfaces, never the reviewed screen, so they never count.
 */
export function watchDockNavigation(
  contents: Pick<Electron.WebContents, 'on' | 'removeListener'>,
  isOwnSurface: () => boolean,
  notify: () => void,
): () => void {
  const report = () => {
    if (!isOwnSurface()) notify();
  };
  const reportInPage = (_event: Electron.Event, _url: string, isMainFrame: boolean) => {
    if (isMainFrame) report();
  };
  contents.on('did-navigate', report);
  contents.on('did-navigate-in-page', reportInPage);
  return () => {
    contents.removeListener('did-navigate', report);
    contents.removeListener('did-navigate-in-page', reportInPage);
  };
}

/** Register the overlay's IPC handlers; only the overlay's own main frame is served. */
export function setupDockAnnotationIPC(
  controller: DockAnnotationController = dockAnnotationController,
): () => void {
  const allowed = (event: IpcMainInvokeEvent) => controller.isOverlaySender(event);
  ipcMain.handle(DOCK_ANNOTATION_CHANNELS.READY, (event, request: DockAnnotationReadyRequest) =>
    allowed(event) ? controller.handleReady(request) : null,
  );
  ipcMain.handle(DOCK_ANNOTATION_CHANNELS.GET_STILL, (event, request: { sessionId?: unknown }) =>
    allowed(event) ? controller.handleStill(request) : null,
  );
  ipcMain.handle(
    DOCK_ANNOTATION_CHANNELS.TOOLBAR,
    (event, request: DockAnnotationToolbarRequest) =>
      allowed(event) ? controller.handleToolbar(request) : false,
  );
  ipcMain.handle(
    DOCK_ANNOTATION_CHANNELS.POINTER,
    (event, request: DockAnnotationPointerRequest) =>
      allowed(event) ? controller.handlePointer(request) : reject('stale'),
  );
  ipcMain.handle(
    DOCK_ANNOTATION_CHANNELS.GESTURE,
    (event, request: DockAnnotationGestureRequest) =>
      allowed(event) ? controller.handleGesture(request) : reject('stale'),
  );
  return () => {
    for (const channel of [
      DOCK_ANNOTATION_CHANNELS.READY,
      DOCK_ANNOTATION_CHANNELS.GET_STILL,
      DOCK_ANNOTATION_CHANNELS.TOOLBAR,
      DOCK_ANNOTATION_CHANNELS.POINTER,
      DOCK_ANNOTATION_CHANNELS.GESTURE,
    ])
      ipcMain.removeHandler(channel);
  };
}
