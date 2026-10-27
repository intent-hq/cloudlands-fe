import { WINDOW_CHANNELS } from '$shared/ipc/channels';
import type { DockPointerRect } from '$shared/dock-layout';

export const DOCK_EDGE_STRIP_WIDTH_PX = 8;

export function isPointerInDockEdgeStrip(pointerX: number, viewportWidth: number): boolean {
  return pointerX >= viewportWidth - DOCK_EDGE_STRIP_WIDTH_PX && pointerX < viewportWidth;
}

interface DockPointerBridge {
  invoke(
    channel: string,
    payload: { active: boolean; regions: DockPointerRect[]; revision?: number },
  ): Promise<unknown>;
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

/** Signals active dock surfaces without coupling pointer events to dock UI design. */
export function createDockPointerRegionController(
  bridge: DockPointerBridge | undefined = defaultBridge(),
): DockPointerRegionController {
  let lastSignal = '';
  let destroyed = false;
  let latestRevision: number | undefined;

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
          regions,
          ...(revision === undefined ? {} : { revision }),
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
    },
  };
}
