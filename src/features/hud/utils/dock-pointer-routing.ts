import { WINDOW_CHANNELS } from '$shared/ipc/channels';
import { isPointInDockPointerRegions, type DockPointerRect } from '$shared/dock-layout';

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
  /** Preserve a real surface entry that can precede main's next cursor poll. */
  recordEnter?(): void;
  /** Republish the current surface and wait for a receipt from main. */
  flush?(): Promise<{ revision: number; version: number } | null>;
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
 * surface, so the shell's own hover rules apply. A fresh native exit and re-entry
 * can repair stale Chromium hover.
 */
export function createDockPointerRegionController(
  bridge: DockPointerBridge | undefined = defaultBridge(),
  surface: () => HTMLElement | null = defaultSurface,
): DockPointerRegionController {
  let lastSignal = '';
  let destroyed = false;
  let latestRevision: number | undefined;
  let readySent = false;
  let active = false;
  let publishedRegions: DockPointerRect[] = [];
  let nativeInside = false;
  let nativeOutside = false;
  let nativePoint: { x: number; y: number } | null = null;
  const replay = (presence: unknown): void => {
    const { inside, x, y, revision } = (presence ?? {}) as {
      inside?: unknown;
      x?: unknown;
      y?: unknown;
      revision?: unknown;
    };
    const element = surface();
    if (destroyed || !active || !element || typeof inside !== 'boolean') return;
    if (revision !== latestRevision) return;
    if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x + y)) return;
    // Main reports region membership, not motion. Ignore identical transition
    // points so a region-only membership flip cannot count as re-entry.
    if (inside !== isPointInDockPointerRegions({ x, y }, publishedRegions)) return;
    if (nativePoint?.x === x && nativePoint.y === y) return;
    nativePoint = { x, y };
    const hoverScope = element.closest('[data-dock-hover-scope]') ?? element;
    const hovered = hoverScope.matches(':hover');
    if (inside) {
      nativeInside = true;
      const reentered = nativeOutside;
      nativeOutside = false;
      if (hovered && !reentered) {
        return;
      }
    } else {
      nativeOutside = true;
      // Retain a native or real surface entry through capture, even when DOM hover had
      // already reflected it. Its outside resync must settle Shell dismissal.
      // An initial outside with no entry must not dismiss the first-run intro.
      if (!nativeInside && !hovered) return;
      nativeInside = false;
    }
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

  const signal = (nextActive: boolean, regions: DockPointerRect[], revision?: number): void => {
    const nextSignal = JSON.stringify({ active: nextActive, regions, revision });
    if (destroyed || lastSignal === nextSignal) return;
    const compatibleRegions =
      regions.length === publishedRegions.length &&
      regions.every((region, index) => {
        const previous = publishedRegions[index];
        return (
          region.x === previous.x &&
          region.y === previous.y &&
          region.width === previous.width &&
          region.height === previous.height
        );
      });
    // A metadata-only revision must not erase an admitted exit before its re-entry.
    if (!nextActive || (revision !== latestRevision && !compatibleRegions)) {
      nativePoint = null;
      nativeOutside = false;
    }
    latestRevision = revision;
    active = nextActive;
    publishedRegions = regions.map((region) => ({ ...region }));
    lastSignal = nextSignal;
    if (!bridge) return;
    try {
      void bridge
        .invoke(WINDOW_CHANNELS.SET_DOCK_POINTER_REGION, {
          active: nextActive,
          // Plain copies: reactive proxies cannot cross IPC, and the call would drop silently.
          regions: regions.map(({ x, y, width, height }) => ({ x, y, width, height })),
          ...(revision === undefined ? {} : { revision }),
        })
        .then(() => {
          // Presence is subscribed and main holds the first live regions: the dock can
          // respond, so main may show it. Sent once per document.
          if (!nextActive || readySent || destroyed) return;
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
    flush: async () => {
      if (
        !bridge ||
        destroyed ||
        !active ||
        !publishedRegions.length ||
        latestRevision === undefined
      )
        return null;
      const signal = lastSignal;
      const revision = latestRevision;
      try {
        const result = (await bridge.invoke(WINDOW_CHANNELS.SET_DOCK_POINTER_REGION, {
          active: true,
          revision,
          regions: publishedRegions.map(({ x, y, width, height }) => ({ x, y, width, height })),
        })) as { success?: boolean; version?: number } | null;
        if (
          destroyed ||
          signal !== lastSignal ||
          !active ||
          result?.success !== true ||
          typeof result.version !== 'number' ||
          !Number.isSafeInteger(result.version) ||
          (result.version ?? -1) < 0
        )
          return null;
        return { revision, version: result.version };
      } catch {
        return null;
      }
    },
    recordEnter: () => {
      nativeInside = true;
    },
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
