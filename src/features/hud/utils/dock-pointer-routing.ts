import { WINDOW_CHANNELS } from '$shared/ipc/channels';

interface DockPointerBridge {
  invoke(channel: string, payload: { active: boolean }): Promise<unknown>;
}

export interface DockPointerRegionController {
  activate(): void;
  deactivate(): void;
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
  let active = false;
  let destroyed = false;

  const signal = (nextActive: boolean): void => {
    if (destroyed || active === nextActive) return;
    active = nextActive;
    if (!bridge) return;
    try {
      void bridge
        .invoke(WINDOW_CHANNELS.SET_DOCK_POINTER_REGION, { active: nextActive })
        .catch(() => undefined);
    } catch {
      // Pointer forwarding is best-effort and must not break renderer interaction.
    }
  };

  return {
    activate: () => signal(true),
    deactivate: () => signal(false),
    destroy: () => {
      if (destroyed) return;
      signal(false);
      destroyed = true;
    },
  };
}
