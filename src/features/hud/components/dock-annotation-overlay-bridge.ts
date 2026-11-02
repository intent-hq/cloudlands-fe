/**
 * IPC bridge of the dock annotation overlay window. The overlay is an isolated
 * transparent window with no app store: main pushes its whole state, and the
 * overlay answers with pointer/gesture requests and a ready handshake once a
 * session's first frame (and still pixels) are painted.
 */
import { electronAPI, isElectron } from '$lib/electron-bridge';
import {
  DOCK_ANNOTATION_CHANNELS,
  type DockAnnotationAck,
  type DockAnnotationOverlayState,
  type DockAnnotationOverlayTransport,
} from '$shared/dock-annotation';

export interface DockAnnotationOverlayView {
  overlay: DockAnnotationOverlayState | null;
  stillUrl: string | null;
}

const STALE: DockAnnotationAck = { ok: false, reason: 'stale' };

async function call<T>(channel: string, payload: unknown, fallback: T): Promise<T> {
  if (!isElectron()) return fallback;
  try {
    return ((await electronAPI().invoke(channel, payload)) as T) ?? fallback;
  } catch {
    return fallback;
  }
}

export function connectDockAnnotationOverlay(
  onChange: (view: DockAnnotationOverlayView) => void,
  painted: () => Promise<void>,
): { transport: DockAnnotationOverlayTransport; dispose: () => void } {
  let view: DockAnnotationOverlayView = { overlay: null, stillUrl: null };
  let stillKey: string | null = null;
  let announced: string | null = null;
  let disposed = false;

  const publish = (next: DockAnnotationOverlayView) => {
    view = next;
    if (!disposed) onChange(next);
  };

  async function apply(next: DockAnnotationOverlayState | null): Promise<void> {
    const key = next?.still ? `${next.sessionId}:${next.still.imageId}` : null;
    const keepStill = key === stillKey;
    stillKey = key;
    publish({ overlay: next, stillUrl: keepStill ? view.stillUrl : null });
    if (key && next && !keepStill) {
      const still = await call<{ dataUrl: string } | null>(
        DOCK_ANNOTATION_CHANNELS.GET_STILL,
        { sessionId: next.sessionId },
        null,
      );
      if (disposed || stillKey !== key) return;
      publish({ ...view, stillUrl: still?.dataUrl ?? null });
    }
    if (!next || announced === next.sessionId) return;
    await painted();
    if (disposed || view.overlay?.sessionId !== next.sessionId) return;
    announced = next.sessionId;
    const confirmed = await call<DockAnnotationOverlayState | null>(
      DOCK_ANNOTATION_CHANNELS.READY,
      { sessionId: next.sessionId },
      null,
    );
    if (!confirmed && view.overlay?.sessionId === next.sessionId) announced = null;
  }

  const onState = (next: DockAnnotationOverlayState | null) => void apply(next ?? null);

  if (isElectron()) {
    electronAPI().on(DOCK_ANNOTATION_CHANNELS.STATE, onState);
    void call<DockAnnotationOverlayState | null>(
      DOCK_ANNOTATION_CHANNELS.READY,
      { sessionId: null },
      null,
    ).then((initial) => {
      if (!disposed && initial && !view.overlay) void apply(initial);
    });
  }

  return {
    transport: {
      pointer: (request) => call(DOCK_ANNOTATION_CHANNELS.POINTER, request, STALE),
      gesture: (request) => call(DOCK_ANNOTATION_CHANNELS.GESTURE, request, STALE),
      toolbar: (request) => call(DOCK_ANNOTATION_CHANNELS.TOOLBAR, request, false),
    },
    dispose: () => {
      disposed = true;
      if (isElectron()) electronAPI().off(DOCK_ANNOTATION_CHANNELS.STATE, onState);
    },
  };
}
