import { WINDOW_CHANNELS } from '$shared/ipc/channels';
import type { DockPointerRect } from '$shared/dock-layout';

export const DOCK_EDGE_STRIP_WIDTH_PX = 8;

export function isPointerInDockEdgeStrip(pointerX: number, viewportWidth: number): boolean {
  return pointerX >= viewportWidth - DOCK_EDGE_STRIP_WIDTH_PX && pointerX < viewportWidth;
}

interface DockPointerBridge {
  invoke(channel: string, payload: unknown): Promise<unknown>;
  on?(channel: string, callback: (presence: unknown) => void): string;
  offById?(channel: string, listenerId: string): void;
}

export interface DockPointerRegionController {
  activate(regions: DockPointerRect[], revision?: number): void;
  deactivate(regions?: DockPointerRect[], revision?: number): void;
  destroy(): void;
}

function defaultBridge(): DockPointerBridge | undefined {
  if (typeof window === 'undefined') return undefined;
  return window.electronAPI;
}

function defaultSurface(): HTMLElement | null {
  return typeof document === 'undefined'
    ? null
    : document.querySelector<HTMLElement>('[data-dock-surface]');
}

/**
 * Signals active dock surfaces without coupling pointer events to dock UI design.
 *
 * Main also reports cursor presence over those regions from its poll, because the
 * non-key dock window does not reliably receive hover. A report that the real hover
 * state does not already reflect is replayed as pointerenter/pointerleave on the
 * surface, so the shell's own hover rules apply; real DOM hover always wins.
 */
export function createDockPointerRegionController(
  bridge: DockPointerBridge | undefined = defaultBridge(),
  surface: () => HTMLElement | null = defaultSurface,
): DockPointerRegionController {
  let lastSignal = '';
  let destroyed = false;
  let latestRevision: number | undefined;
  let replayedInside = false;
  let readySent = false;
  const replay = (presence: unknown): void => {
    const { inside, x, y } = (presence ?? {}) as { inside?: unknown; x?: unknown; y?: unknown };
    const element = surface();
    if (destroyed || !element || typeof inside !== 'boolean') return;
    if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x + y)) return;
    const hovered = element.matches(':hover');
    // Enter only when Chromium has not; leave only what was replayed and is not hovered.
    if (inside ? hovered : !replayedInside || hovered) {
      if (inside) replayedInside = false;
      return;
    }
    replayedInside = inside;
    const Event = typeof PointerEvent === 'function' ? PointerEvent : MouseEvent;
    element.dispatchEvent(
      new Event(inside ? 'pointerenter' : 'pointerleave', { clientX: x, clientY: y }),
    );
  };
  let presenceListener: string | undefined;
  try {
    presenceListener = bridge?.on?.(WINDOW_CHANNELS.DOCK_POINTER_PRESENCE_CHANGED, replay);
  } catch {
    // Presence is a fallback; regions still route real pointer events.
  }

  const signal = (active: boolean, regions: DockPointerRect[], revision?: number): void => {
    const nextSignal = JSON.stringify({ active, regions, revision });
    if (destroyed || lastSignal === nextSignal) return;
    if (revision !== undefined) latestRevision = revision;
    lastSignal = nextSignal;
    if (!bridge) return;
    try {
      void bridge
        .invoke(WINDOW_CHANNELS.SET_DOCK_POINTER_REGION, {
          active,
          // Plain copies: reactive proxies cannot cross IPC, and the call would drop silently.
          regions: regions.map(({ x, y, width, height }) => ({ x, y, width, height })),
          ...(revision === undefined ? {} : { revision }),
        })
        .then(() => {
          // Presence is subscribed and main holds the first live regions: the dock can
          // respond, so main may show it. Sent once per document.
          if (!active || readySent || destroyed) return;
          readySent = true;
          return bridge.invoke(WINDOW_CHANNELS.DOCK_RENDERER_READY, {});
        })
        .catch(() => undefined);
    } catch {
      // Pointer forwarding is best-effort and must not break renderer interaction.
    }
  };

  return {
    activate: (regions, revision) => signal(true, regions, revision),
    deactivate: (regions = [], revision) => signal(false, regions, revision),
    destroy: () => {
      if (destroyed) return;
      signal(false, [], latestRevision);
      destroyed = true;
      if (presenceListener)
        bridge?.offById?.(WINDOW_CHANNELS.DOCK_POINTER_PRESENCE_CHANGED, presenceListener);
    },
  };
}
