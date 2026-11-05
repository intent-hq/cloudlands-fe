import { DockMediaCaptureSchema, type DockMediaCapture } from '../../../shared/dock-media-edit';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { access } from 'node:fs/promises';
import path from 'node:path';
import {
  app,
  desktopCapturer,
  nativeImage,
  screen,
  systemPreferences,
  type BrowserWindow,
  type Display,
} from 'electron';
import {
  getDockPlacementSnapshot,
  getDockWindow,
  setDockHiddenForCapture,
  setDockHiddenForSelection,
} from '../../../main/dock-window';
import {
  getStrictBackendBindingForWebContents,
  onStrictBackendBindingRetired,
} from '../../../main/window-backend';
import type {
  DockCapturedPixels,
  DockCaptureMode,
  DockNativeResult,
} from '../../../shared/dock-evidence';
import { cgWindowIdFromMediaSourceId, createDockScreenRecorder } from './dock-screen-recorder';
import { Logger } from '../../../shared/logger';
import type {
  DockEvidenceBeginRequest,
  DockEvidenceBeginResult,
  DockEvidenceSession,
  DockEvidenceCaptureRequest,
  DockEvidencePixelsResult,
} from '../../../shared/dock-evidence-ipc';

export interface DockEvidenceOwner {
  sender: Electron.WebContents;
  frame: Electron.WebFrameMain;
}

/** Main-only authority passed to helper/overlay owners; never accepted from IPC. */
export interface DockEvidenceContext {
  scope: DockEvidenceSession;
  window: BrowserWindow;
  display: Display;
  backendId: string;
  isCurrent(): boolean;
  onDispose(listener: () => void): () => void;
}

type Binding = NonNullable<ReturnType<typeof getStrictBackendBindingForWebContents>>;
interface CapturedImage {
  png: Buffer;
  width: number;
  height: number;
}
type SelectedImage = CapturedImage & { displayScale: number; capture?: DockMediaCapture };

/** Injection is confined to native boundaries; tests exercise the real lifecycle. */
export interface DockEvidenceDependencies {
  dock(): BrowserWindow | null;
  binding(sender: Electron.WebContents): Binding | null;
  retired(sender: Electron.WebContents, listener: () => void): () => void;
  placement: typeof getDockPlacementSnapshot;
  displays(): Display[];
  permissionDenied(): boolean;
  hidden(window: BrowserWindow, hidden: boolean, restore: boolean): void;
  /**
   * Hides the dock window for a window/region selection, which can take seconds.
   * Unlike `hidden`, the dock document keeps its surface (draft, editor, mark chips).
   */
  hiddenForSelection(window: BrowserWindow, hidden: boolean, restore: boolean): void;
  /** Lets the window server apply a hide; a selection waits longer (the picker snapshots windows). */
  settle(ms?: number): Promise<void>;
  capture(display: Display): Promise<CapturedImage>;
  captureVisible?(
    window: BrowserWindow,
    display: Display,
    excluded: BrowserWindow[],
    windowIds: number[],
  ): Promise<DockNativeResult<DockCapturedPixels>>;
  /** The OS selection UI for a window or region; dismissing it fails with `detail: 'cancelled'`. */
  captureSelection?(
    mode: Exclude<DockCaptureMode, 'fullscreen'>,
    excludeWindowIds?: number[],
    signal?: AbortSignal,
  ): Promise<DockNativeResult<SelectedImage>>;
  id(): string;
  now(): number;
}

interface Session {
  scope: DockEvidenceSession;
  owner: DockEvidenceOwner;
  binding: Binding;
  disposed: boolean;
  cleanup: () => void;
  releaseCapture?: () => void;
  listeners: Set<() => void>;
  requests: Map<string, { source: string; promise: Promise<DockEvidencePixelsResult> | null }>;
}

const logger = new Logger('DockEvidenceSession');
const unavailable = (): DockEvidencePixelsResult => ({ ok: false, error: 'unavailable' });
/** The window picker lists windows as it starts: the hidden dock must be gone by then. */
const SELECTION_SETTLE_MS = 250;
const MAX_PNG_BYTES = 30 * 1024 * 1024;

/** A single capture lease; cancellation never lets a second capture race its restoration. */
export class DockEvidenceSessions {
  private active: Session | null = null;
  private capturing: Session | null = null;
  private exclusions: () => BrowserWindow[] = () => [];
  private exclusionIds: () => number[] = () => [];

  constructor(private readonly deps: DockEvidenceDependencies) {}

  /** Main-owned overlay/control windows only; never renderer-supplied IDs. */
  setCaptureExclusions(provider: () => BrowserWindow[]): void {
    this.exclusions = provider;
  }

  setCaptureExclusionIds(provider: () => number[]): void {
    this.exclusionIds = provider;
  }

  private ownerCurrent(owner: DockEvidenceOwner, binding: Binding): boolean {
    return (
      !owner.sender.isDestroyed() &&
      owner.sender.mainFrame === owner.frame &&
      this.deps.dock() === binding.window &&
      !binding.window.isDestroyed() &&
      this.deps.binding(owner.sender) === binding &&
      binding.frame === owner.frame
    );
  }

  private current(session: Session): boolean {
    return (
      this.active === session &&
      !session.disposed &&
      this.ownerCurrent(session.owner, session.binding)
    );
  }

  private matches(session: Session, owner: DockEvidenceOwner, scope: DockEvidenceSession): boolean {
    return (
      this.current(session) &&
      owner.sender === session.owner.sender &&
      owner.frame === session.owner.frame &&
      scope.sessionId === session.scope.sessionId &&
      scope.draftId === session.scope.draftId &&
      scope.workspaceId === session.scope.workspaceId &&
      scope.agentId === session.scope.agentId
    );
  }

  private dispose(session: Session): void {
    if (session.disposed) return;
    session.disposed = true;
    session.cleanup();
    session.releaseCapture?.();
    for (const listener of session.listeners) {
      try {
        listener();
      } catch {
        /* Retire every consumer even if one has already closed. */
      }
    }
    session.listeners.clear();
    session.requests.clear();
    if (this.active === session) this.active = null;
  }

  begin(owner: DockEvidenceOwner, request: DockEvidenceBeginRequest): DockEvidenceBeginResult {
    const binding = this.deps.binding(owner.sender);
    if (!binding || !this.ownerCurrent(owner, binding)) return { ok: false, error: 'unavailable' };
    const previous = this.active;
    if (
      previous &&
      this.current(previous) &&
      previous.binding === binding &&
      previous.scope.workspaceId === request.workspaceId &&
      previous.scope.agentId === request.agentId &&
      previous.scope.draftId === request.draftId
    )
      return { ok: true, value: { ...previous.scope } };
    const placement = this.deps.placement(binding.window);
    if (this.capturing || !binding.window.isVisible() || !placement || placement.captureHidden)
      return { ok: false, error: 'unavailable' };
    if (previous) this.dispose(previous);
    const session: Session = {
      scope: { ...request, sessionId: this.deps.id() },
      owner,
      binding,
      disposed: false,
      cleanup: () => {},
      listeners: new Set(),
      requests: new Map(),
    };
    this.active = session;
    session.cleanup = this.deps.retired(owner.sender, () => this.dispose(session));
    return { ok: true, value: { ...session.scope } };
  }

  cancel(owner: DockEvidenceOwner, request: DockEvidenceSession): DockNativeResult<boolean> {
    const session = this.active;
    if (!session || !this.matches(session, owner, request))
      return { ok: false, error: 'unavailable' };
    this.dispose(session);
    return { ok: true, value: true };
  }

  context(owner: DockEvidenceOwner, scope: DockEvidenceSession): DockEvidenceContext | null {
    const session = this.active;
    if (!session || !this.matches(session, owner, scope)) return null;
    const displayId = this.deps.placement(session.binding.window)?.displayId;
    const display = this.deps.displays().find((row) => row.id === displayId);
    if (!display) return null;
    return {
      scope: { ...session.scope },
      window: session.binding.window,
      display: { ...display, bounds: { ...display.bounds } },
      backendId: session.binding.backendId,
      isCurrent: () => this.current(session),
      onDispose: (listener) => {
        if (!this.current(session)) {
          listener();
          return () => {};
        }
        session.listeners.add(listener);
        return () => {
          session.listeners.delete(listener);
        };
      },
    };
  }

  capture(
    owner: DockEvidenceOwner,
    request: DockEvidenceCaptureRequest,
  ): Promise<DockEvidencePixelsResult> {
    const session = this.active;
    if (!session || !this.matches(session, owner, request)) return Promise.resolve(unavailable());
    const source = request.source ?? 'capture';
    const existing = session.requests.get(request.requestId);
    // Evicted bytes are never recaptured under an old identity.
    if (existing)
      return existing.source === source && existing.promise
        ? existing.promise
        : Promise.resolve(unavailable());
    if (this.capturing) return Promise.resolve(unavailable());
    if (session.requests.size >= 256) return Promise.resolve({ ok: false, error: 'limit' });
    const promise = this.captureOnce(session, request).then(
      (result) => (this.current(session) ? result : unavailable()),
      (): DockEvidencePixelsResult => ({ ok: false, error: 'failed' }),
    );
    session.requests.set(request.requestId, { source, promise });
    void promise.then(() => {
      const cached = [...session.requests.values()].filter((entry) => entry.promise);
      for (const entry of cached.slice(0, Math.max(0, cached.length - 4))) entry.promise = null;
    });
    return promise;
  }

  private async captureOnce(
    session: Session,
    request: DockEvidenceCaptureRequest,
  ): Promise<DockEvidencePixelsResult> {
    const window = session.binding.window;
    const placement = this.deps.placement(window);
    const selected = this.deps
      .displays()
      .find((candidate) => candidate.id === placement?.displayId);
    const display = selected ? { ...selected, bounds: { ...selected.bounds } } : undefined;
    if (!display || !placement || placement.captureHidden || !window.isVisible())
      return unavailable();
    if (this.deps.permissionDenied()) return { ok: false, error: 'permission' };
    this.capturing = session;
    const selection = request.mode && request.mode !== 'fullscreen' ? request.mode : null;
    const setHidden = selection ? this.deps.hiddenForSelection : this.deps.hidden;
    let hidden = false;
    const release = () => {
      session.releaseCapture = undefined;
      if (!hidden) return;
      hidden = false;
      if (this.deps.dock() !== window || window.isDestroyed()) return;
      try {
        setHidden(window, false, this.ownerCurrent(session.owner, session.binding));
      } catch {
        // A closing native window cannot be restored. Never substitute a new window.
      }
    };
    session.releaseCapture = release;
    const eligible = () =>
      this.current(session) &&
      this.deps.placement(window)?.displayId === display.id &&
      this.deps
        .displays()
        .some(
          (row) =>
            row.id === display.id &&
            row.scaleFactor === display.scaleFactor &&
            row.bounds.x === display.bounds.x &&
            row.bounds.y === display.bounds.y &&
            row.bounds.width === display.bounds.width &&
            row.bounds.height === display.bounds.height,
        );
    try {
      if (selection) {
        if (!this.deps.captureSelection) return unavailable();
        // The dock is the capture tool, never part of the selection.
        hidden = true;
        setHidden(window, true, false);
        await this.deps.settle(SELECTION_SETTLE_MS);
        if (!this.current(session)) return unavailable();
        const selectionAbort = new AbortController();
        const abortSelection = () => selectionAbort.abort();
        session.listeners.add(abortSelection);
        let selected: DockNativeResult<SelectedImage>;
        try {
        selected = await this.deps.captureSelection(selection, [window, ...this.exclusions()].filter((entry) => !entry.isDestroyed())
          .map((entry) => cgWindowIdFromMediaSourceId(entry.getMediaSourceId())).filter((id): id is number => id !== null), selectionAbort.signal);
        } finally { session.listeners.delete(abortSelection); }
        if (!this.current(session)) return unavailable();
        // Screen Recording can be turned off during a selection: the image would hold
        // only the desktop, and a dismissal must not hide the missing permission.
        if (this.deps.permissionDenied()) return { ok: false, error: 'permission' };
        if (!selected.ok) return selected;
        return this.pixels(session, request, selected.value, selected.value.displayScale);
      }
      let nativePixels: DockCapturedPixels | undefined;
      const excluded = this.exclusions().filter((surface) => !surface.isDestroyed());
      const excludedIds = [...this.exclusionIds()];
      if (this.deps.captureVisible) {
        const result = await this.deps.captureVisible(window, display, excluded, excludedIds);
        const currentExclusions = this.exclusions().filter((surface) => !surface.isDestroyed());
        if (
          !eligible() ||
          JSON.stringify(excludedIds) !== JSON.stringify(this.exclusionIds()) ||
          currentExclusions.length !== excluded.length ||
          currentExclusions.some((surface, index) => surface !== excluded[index])
        )
          return unavailable();
        if (result.ok) nativePixels = result.value;
        else if (result.error !== 'unavailable' || result.detail !== 'os-version') return result;
      }
      let captured: CapturedImage;
      if (nativePixels) {
        if (
          !Number.isFinite(nativePixels.displayScale) ||
          nativePixels.displayScale <= 0 ||
          !Number.isFinite(Date.parse(nativePixels.capturedAt))
        )
          return { ok: false, error: 'failed' };
        captured = {
          png: Buffer.from(nativePixels.base64, 'base64'),
          width: nativePixels.width,
          height: nativePixels.height,
        };
      } else {
        // Never photograph a live markup surface on the legacy hide fallback.
        if (excludedIds.length || excluded.some((surface) => surface.isVisible()))
          return unavailable();
        hidden = true;
        this.deps.hidden(window, true, false);
        await this.deps.settle();
        if (!eligible() || window.isVisible()) return unavailable();
        captured = await this.deps.capture(display);
        if (!eligible() || window.isVisible()) return unavailable();
      }
      return this.pixels(
        session,
        request,
        captured,
        nativePixels?.displayScale ?? display.scaleFactor,
        nativePixels,
      );
    } catch {
      return { ok: false, error: this.deps.permissionDenied() ? 'permission' : 'failed' };
    } finally {
      this.capturing = null;
      release();
    }
  }

  private pixels(
    session: Session,
    request: DockEvidenceCaptureRequest,
    captured: CapturedImage,
    displayScale: number,
    nativePixels?: DockCapturedPixels,
  ): DockEvidencePixelsResult {
    if (
      !captured.png.length ||
      !Number.isInteger(captured.width) ||
      !Number.isInteger(captured.height) ||
      captured.width <= 0 ||
      captured.height <= 0 ||
      !Number.isFinite(displayScale) ||
      displayScale <= 0
    )
      return { ok: false, error: 'failed' };
    if (captured.png.length > MAX_PNG_BYTES) return { ok: false, error: 'limit' };
    const id = this.deps.id();
    const capturedAt = nativePixels?.capturedAt ?? new Date(this.deps.now()).toISOString();
    const display = this.deps.displays().find((row) => row.id === this.deps.placement(session.binding.window)?.displayId);
    const capture = nativePixels?.capture ?? ('capture' in captured ? (captured as SelectedImage).capture : undefined) ?? { mode: request.mode ?? 'fullscreen' as const,
      frame: (!request.mode || request.mode === 'fullscreen') && display
        ? { displayId: display.id, rect: { x: display.bounds.x, y: display.bounds.y, w: display.bounds.width, h: display.bounds.height },
            coordinateSpace: 'screen-points-top-left' as const } : null };
    const pixels = {
      capture,
      base64: captured.png.toString('base64'),
      mimeType: 'image/png' as const,
      width: captured.width,
      height: captured.height,
      displayScale,
      capturedAt,
      ...(nativePixels?.hash ? { hash: nativePixels.hash } : {}),
    };
    return {
      ok: true,
      value: {
        ...session.scope,
        requestId: request.requestId,
        image: {
          id,
          contextItemId: `dock-evidence:${id}`,
          width: pixels.width,
          height: pixels.height,
          capture: pixels.capture,
          displayScale: pixels.displayScale,
          capturedAt,
          source: request.source ?? 'capture',
          ...(pixels.hash ? { hash: pixels.hash } : {}),
        },
        pixels,
      },
    };
  }
}

/** Long enough to choose calmly; a forgotten selection must not hold the capture lease. */
const SELECTION_TIMEOUT_MS = 5 * 60_000;

/** Native selector returns the exact selected frame with its pixels. */
async function captureSelection(mode: Exclude<DockCaptureMode, 'fullscreen'>, excludeWindowIds: number[] = [], signal?: AbortSignal): Promise<DockNativeResult<SelectedImage>> {
  const release = dockEvidenceRecorder.reserveSelection();
  if (!release) return { ok: false, error: 'failed', detail: 'recording-busy' };
  try { return await captureSelectionReserved(mode, excludeWindowIds, signal); }
  finally { release(); }
}
async function captureSelectionReserved(mode: Exclude<DockCaptureMode, 'fullscreen'>, excludeWindowIds: number[] = [], signal?: AbortSignal): Promise<DockNativeResult<SelectedImage>> {
  if (process.platform !== 'darwin') return { ok: false, error: 'unavailable', detail: 'platform' };
  const roots = app.isPackaged ? [process.resourcesPath] : [path.join(app.getAppPath(), 'resources'), path.resolve(app.getAppPath(), '..', '..', 'resources')];
  let helper: string | undefined;
  for (const root of roots) {
    const candidate = path.join(root, 'dock-helper', 'intent-dock-capture-selector');
    try { await access(candidate); helper = candidate; break; } catch { /* known next layout */ }
  }
  if (!helper) return { ok: false, error: 'unavailable', detail: 'selection-helper-missing' };
  try {
    let childClosed: Promise<void> | undefined;
    const stdout = await (async () => {
      try {
        return await new Promise<string>((resolve, reject) => {
          const child = execFile(helper!, [mode, ...excludeWindowIds.map(String)],
            { timeout: SELECTION_TIMEOUT_MS, maxBuffer: 96 * 1024 * 1024, signal },
            (error, output) => error ? reject(error) : resolve(output));
          childClosed = new Promise<void>((done) => child.once('close', () => done()));
        });
      } finally { await childClosed; }
    })();
    const result = JSON.parse(stdout) as Record<string, unknown>;
    if (result.ok !== true) return result.error === 'cancelled' ? { ok: false, error: 'unavailable', detail: 'cancelled' }
      : { ok: false, error: result.error === 'permission' ? 'permission' : result.error === 'unavailable' ? 'unavailable' : 'failed' };
    const capture = DockMediaCaptureSchema.parse(result.capture);
    if (capture.mode !== mode || !capture.frame || typeof result.base64 !== 'string') throw new Error('selection-frame');
    const image = nativeImage.createFromBuffer(Buffer.from(result.base64, 'base64'));
    const size = image.getSize();
    if (image.isEmpty() || size.width !== result.width || size.height !== result.height) throw new Error('selection-size');
    return { ok: true, value: { png: image.toPNG(), ...size, capture, displayScale: size.width / capture.frame.rect.w } };
  } catch { return { ok: false, error: 'failed', detail: 'selection' }; }
}

/** Construction does not start a helper, recording, microphone or screenshot. */
export const dockEvidenceRecorder = createDockScreenRecorder();

export const dockEvidenceSessions = new DockEvidenceSessions({
  dock: getDockWindow,
  binding: getStrictBackendBindingForWebContents,
  retired: onStrictBackendBindingRetired,
  placement: getDockPlacementSnapshot,
  displays: () => screen.getAllDisplays(),
  permissionDenied: () =>
    process.platform === 'darwin' && systemPreferences.getMediaAccessStatus('screen') === 'denied',
  hidden: (window, hidden, restore) => {
    if (getDockWindow() !== window) return;
    // The capture lease must be released without displaying a replaced document.
    setDockHiddenForCapture(hidden, { window, restore });
  },
  hiddenForSelection: (window, hidden, restore) => {
    if (getDockWindow() !== window) return;
    setDockHiddenForSelection(hidden, { window, restore });
  },
  settle: (ms = 50) => new Promise((resolve) => setTimeout(resolve, ms)),
  capture: async (display) => {
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      fetchWindowIcons: false,
      thumbnailSize: {
        width: Math.round(display.bounds.width * display.scaleFactor),
        height: Math.round(display.bounds.height * display.scaleFactor),
      },
    });
    const source = sources.find((row) => row.display_id === String(display.id));
    if (!source || source.thumbnail.isEmpty()) throw new Error('Capture unavailable');
    const { width, height } = source.thumbnail.getSize();
    return { png: source.thumbnail.toPNG(), width, height };
  },
  id: randomUUID,
  captureSelection,
  captureVisible: async (window, display, excluded, windowIds) => {
    if (process.platform !== 'darwin')
      return { ok: false, error: 'unavailable', detail: 'os-version' };
    const ids = [window, ...excluded].map((surface) =>
      cgWindowIdFromMediaSourceId(surface.getMediaSourceId()),
    );
    if (ids.some((id) => id === null)) return { ok: false, error: 'unavailable' };
    if (windowIds.some((id) => !Number.isSafeInteger(id) || id <= 0 || id > 0xffffffff))
      return { ok: false, error: 'unavailable' };
    return dockEvidenceRecorder.captureStill({
      displayId: display.id,
      excludeWindowIds: [...new Set([...(ids as number[]), ...windowIds])],
    });
  },
  now: Date.now,
});
