/**
 * Encoder behaviors for the hardware console.
 *
 * Subscribes an input decoder to the shared manager's raw channel-2 stream
 * (`onRawMessage`) and wires the rotary encoder:
 * - rotate: cycles the app's active workspace across workspaces ordered by
 *   activity — one step per detent, direction honored (cw = toward more
 *   recent), clamping at the list ends — and shows a small HUD while
 *   rotating;
 * - click (`ENC_CLK` keydown): brings up the All-workspaces sidebar panel;
 *   clicks while it is open cycle its view mode Recent → Repo → Status.
 *
 * The HUD timer is action-driven in the middleware: `encoderHudShown` arms
 * it regardless of who dispatched it.
 *
 * Dependency-light middleware module: AppClient-free, no selector imports —
 * workspace ordering reads `appStore.state` via the pure helpers.
 */
import type { StoreMiddleware } from '$lib/store-shim/types';
import { store as appStore } from '$store/renderer/store';
import { createLogger } from '$lib/utils/client-logger';
import { navigateToRoute } from '$lib/utils/navigation.client';
import { getItems } from '$lib/store-shim/utils/collections/collection-utils';
import { CHIEF_WORKSPACE_ID } from '$shared/types/branded-ids';
import {
  encoderHudHidden,
  encoderHudShown,
} from '$store/renderer/slices/hardware-console/hardware-console-slice';
import type { HardwareConsoleManager } from '../device/device-manager';
import { getHardwareConsoleManager } from '../instance';
import { HardwareInputDecoder } from '../input/input-decoder';
import type { EncoderDirection } from '../input/types';
import { isKeyAssignableWorkspace } from '../assignment/key-assignment';
import {
  openPanel,
  setAllSpacesViewMode,
} from '$store/renderer/slices/sidebar-nav/sidebar-nav-slice';
import {
  cycleWorkspaceId,
  nextAllSpacesViewMode,
  orderWorkspacesForCycling,
} from './workspace-cycle';

const logger = createLogger('HardwareConsoleEncoder');

/** The cycling HUD hides after this much rotation inactivity. */
export const ENCODER_HUD_HIDE_MS = 1200;

export interface EncoderDeps {
  /** Navigate the app to a route. Defaults to `navigateToRoute`. */
  navigate?: (route: string) => Promise<void>;
  /** Dispatch into the app store. Defaults to `appStore.dispatch`. */
  dispatch?: (action: unknown) => void;
}

function resolveDeps(deps: EncoderDeps): Required<EncoderDeps> {
  return {
    navigate: deps.navigate ?? navigateToRoute,
    dispatch: deps.dispatch ?? ((action: unknown) => appStore.dispatch(action as never)),
  };
}

function cyclableWorkspaces() {
  const state = appStore.state;
  return getItems(state.workspace.workspaces).filter(
    (workspace) => workspace.id !== CHIEF_WORKSPACE_ID && isKeyAssignableWorkspace(workspace),
  );
}

function navigateToWorkspace(
  workspaceId: string,
  navigate: (route: string) => Promise<void>,
): void {
  void navigate(`/workspace/${workspaceId}`).catch((error: unknown) => {
    logger.warn('Failed to switch workspace from encoder', { workspaceId, error });
  });
}

/**
 * Handle one encoder detent. Exported for tests. Returns the workspace id
 * the detent navigated to, or null when there was nowhere to go (cycling
 * clamps at the ends of the activity-ordered list).
 */
export function handleEncoderRotate(
  direction: EncoderDirection,
  deps: EncoderDeps = {},
): string | null {
  const { navigate, dispatch } = resolveDeps(deps);
  const state = appStore.state;

  const ordered = orderWorkspacesForCycling(cyclableWorkspaces());
  const cursor = state.hardwareConsole.encoderHudWorkspaceId ?? state.workspace.activeWorkspaceId;
  const target = cycleWorkspaceId(
    ordered.map((workspace) => workspace.id),
    cursor,
    direction,
  );
  if (target === null) return null;
  dispatch(encoderHudShown(target));
  navigateToWorkspace(target, navigate);
  return target;
}

/**
 * Handle one encoder click. Exported for tests. First click opens the
 * All-workspaces sidebar panel (in its current view mode); clicks while it
 * is open cycle the view mode Recent → Repo → Status.
 */
export function handleEncoderClick(deps: EncoderDeps = {}): void {
  const { dispatch } = resolveDeps(deps);
  const nav = appStore.state.sidebarNav;
  if (nav.panelItem === 'all-workspaces') {
    dispatch(setAllSpacesViewMode(nextAllSpacesViewMode(nav.allSpacesViewMode)));
  } else {
    dispatch(openPanel('all-workspaces'));
  }
}

/**
 * Wire the encoder to a manager. Returns the teardown function.
 * Exported for tests; production installs via the middleware below.
 */
export function installHardwareConsoleEncoder(
  manager: HardwareConsoleManager,
  deps: EncoderDeps = {},
): () => void {
  const { dispatch } = resolveDeps(deps);
  let detachDecoder: (() => void) | null = null;

  const teardownDecoder = (): void => {
    detachDecoder?.();
    detachDecoder = null;
    dispatch(encoderHudHidden());
  };

  const setupDecoder = (): void => {
    detachDecoder?.();
    const decoder = new HardwareInputDecoder({
      deviceModel: manager.connectedDevice?.model ?? 'creator-micro-2',
    });
    const offRotate = decoder.on('encoderrotate', ({ direction }) => {
      handleEncoderRotate(direction, deps);
    });
    const offKeydown = decoder.on('keydown', ({ key }) => {
      if (key === 'ENC_CLK') handleEncoderClick(deps);
    });
    const offRaw = manager.onRawMessage((message) => decoder.handleMessage(message));
    detachDecoder = () => {
      offRaw();
      offRotate();
      offKeydown();
    };
  };

  const offStatus = manager.onStatusChange((status) => {
    if (status === 'connected') setupDecoder();
    else if (status === 'disconnected' || status === 'unavailable') teardownDecoder();
  });
  if (manager.status === 'connected') setupDecoder();

  return () => {
    offStatus();
    teardownDecoder();
  };
}

/**
 * Lazily installs the encoder wiring on the first dispatched action
 * (key-switch precedent) and drives the HUD inactivity timer from the
 * `encoderHudShown` action itself — the timer behaves identically whoever
 * dispatched it.
 */
export function createHardwareConsoleEncoderMiddleware(deps: EncoderDeps = {}): StoreMiddleware {
  const { dispatch } = resolveDeps(deps);
  let installed = false;
  let hudTimer: ReturnType<typeof setTimeout> | null = null;

  const clearHudTimer = (): void => {
    if (hudTimer !== null) clearTimeout(hudTimer);
    hudTimer = null;
  };

  const armHudTimer = (): void => {
    clearHudTimer();
    hudTimer = setTimeout(() => {
      hudTimer = null;
      dispatch(encoderHudHidden());
    }, ENCODER_HUD_HIDE_MS);
  };

  return () => (next) => (action) => {
    if (!installed) {
      installed = true;
      const manager = getHardwareConsoleManager();
      installHardwareConsoleEncoder(manager, deps);
      void manager.start();
    }

    const result = next(action);

    const type = (action as { type?: string } | null | undefined)?.type;
    if (type === encoderHudShown.type) armHudTimer();
    else if (type === encoderHudHidden.type) clearHudTimer();

    return result;
  };
}
