import { randomUUID } from 'node:crypto';
import {
  desktopCapturer,
  screen,
  systemPreferences,
  type BrowserWindow,
  type Display,
} from 'electron';
import {
  getDockPlacementSnapshot,
  getDockWindow,
  setDockHiddenForCapture,
} from '../../../main/dock-window';
import {
  getStrictBackendBindingForWebContents,
  onStrictBackendBindingRetired,
} from '../../../main/window-backend';
import type { DockCapturedPixels, DockNativeResult } from '../../../shared/dock-evidence';
import { cgWindowIdFromMediaSourceId, createDockScreenRecorder } from './dock-screen-recorder';
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

/** Injection is confined to native boundaries; tests exercise the real lifecycle. */
export interface DockEvidenceDependencies {
  dock(): BrowserWindow | null;
  binding(sender: Electron.WebContents): Binding | null;
  retired(sender: Electron.WebContents, listener: () => void): () => void;
  placement: typeof getDockPlacementSnapshot;
  displays(): Display[];
  permissionDenied(): boolean;
  hidden(window: BrowserWindow, hidden: boolean, restore: boolean): void;
  settle(): Promise<void>;
  capture(display: Display): Promise<CapturedImage>;
  captureVisible?(
    window: BrowserWindow,
    display: Display,
    excluded: BrowserWindow[],
    windowIds: number[],
  ): Promise<DockNativeResult<DockCapturedPixels>>;
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

const unavailable = (): DockEvidencePixelsResult => ({ ok: false, error: 'unavailable' });
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
    let hidden = false;
    const release = () => {
      session.releaseCapture = undefined;
      if (!hidden) return;
      hidden = false;
      if (this.deps.dock() !== window || window.isDestroyed()) return;
      try {
        this.deps.hidden(window, false, this.ownerCurrent(session.owner, session.binding));
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
      if (
        !captured.png.length ||
        !Number.isInteger(captured.width) ||
        !Number.isInteger(captured.height) ||
        captured.width <= 0 ||
        captured.height <= 0
      )
        return { ok: false, error: 'failed' };
      if (captured.png.length > MAX_PNG_BYTES) return { ok: false, error: 'limit' };
      const id = this.deps.id();
      const capturedAt = nativePixels?.capturedAt ?? new Date(this.deps.now()).toISOString();
      const pixels = {
        base64: captured.png.toString('base64'),
        mimeType: 'image/png' as const,
        width: captured.width,
        height: captured.height,
        displayScale: nativePixels?.displayScale ?? display.scaleFactor,
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
            displayScale: pixels.displayScale,
            capturedAt,
            source: request.source ?? 'capture',
            ...(pixels.hash ? { hash: pixels.hash } : {}),
          },
          pixels,
        },
      };
    } catch {
      return { ok: false, error: this.deps.permissionDenied() ? 'permission' : 'failed' };
    } finally {
      this.capturing = null;
      release();
    }
  }
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
  settle: () => new Promise((resolve) => setTimeout(resolve, 50)),
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
