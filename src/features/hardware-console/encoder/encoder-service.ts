/**
 * Encoder behaviors for the hardware console.
 *
 * Subscribes an input decoder to the shared manager's raw channel-2 stream
 * (`onRawMessage`) and wires the rotary encoder:
 * - rotate: adjusts the current agent's effort by default; optionally cycles
 *   workspaces ordered by activity. Both modes clamp at the ends and show a
 *   small HUD naming the choice;
 * - click (`ENC_CLK` keydown): brings up the All-workspaces sidebar panel;
 *   clicks while it is open cycle its view mode Recent → Repo → Status.
 *
 * The HUD timer is action-driven in the device saga.
 *
 * Dependency-light device service: AppClient-free; effort writes run in a saga.
 */
import { store as appStore } from '$store/renderer/store';
import { createLogger } from '$lib/utils/client-logger';
import { navigateToRoute } from '$lib/utils/navigation.client';
import { getItems } from '@augmentcode/themis/utils/collections/collection-utils';
import { CHIEF_WORKSPACE_ID } from '$shared/types/branded-ids';
import {
  encoderHudHidden,
  encoderEffortRotated,
  encoderInputStopped,
  encoderHudShown,
} from '$store/renderer/slices/hardware-console/hardware-console-slice';
import type { HardwareConsoleManager } from '../device/device-manager';
import { HardwareInputDecoder } from '../input/input-decoder';
import type { EncoderDirection } from '../input/types';
import { isKeyAssignableWorkspace } from '../assignment/key-assignment';
import { isConsoleOwner } from '../owner-gate';
import {
  openPanel,
  setAllSpacesViewMode,
} from '$store/renderer/slices/sidebar-nav/sidebar-nav-slice';
import {
  cycleWorkspaceId,
  nextAllSpacesViewMode,
  orderWorkspacesForCycling,
} from './workspace-cycle';
import { selectCurrentWorkspaceTabId } from '$store/renderer/slices/tab-state/tab-state-selectors';

const logger = createLogger('HardwareConsoleEncoder');

/** The encoder HUD hides after this much rotation inactivity. */
export const ENCODER_HUD_HIDE_MS = 1200;

export interface EncoderDeps {
  /** Navigate the app to a route. Defaults to `navigateToRoute`. */
  navigate?: (route: string) => Promise<void>;
  /** Dispatch into the app store. Defaults to `appStore.dispatch`. */
  dispatch?: (action: unknown) => void;
  /** Console-owner gate (#1928). Defaults to the store-backed `isConsoleOwner`. */
  isOwner?: () => boolean;
  /** Current workspace-tab seam. */
  getCurrentWorkspaceId?: () => string | null;
}

function resolveDeps(deps: EncoderDeps): Required<EncoderDeps> {
  return {
    navigate: deps.navigate ?? navigateToRoute,
    dispatch: deps.dispatch ?? ((action: unknown) => appStore.dispatch(action as never)),
    isOwner: deps.isOwner ?? isConsoleOwner,
    getCurrentWorkspaceId:
      deps.getCurrentWorkspaceId ?? (() => selectCurrentWorkspaceTabId.select(appStore.state)),
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
function handleEncoderRotate(direction: EncoderDirection, deps: EncoderDeps = {}): string | null {
  const { navigate, dispatch, getCurrentWorkspaceId } = resolveDeps(deps);
  const state = appStore.state;

  const ordered = orderWorkspacesForCycling(cyclableWorkspaces());
  const cursor = state.hardwareConsole.encoderHudWorkspaceId ?? getCurrentWorkspaceId();
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
function handleEncoderClick(deps: EncoderDeps = {}): void {
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
 * Exported for tests; production installation is owned by the device saga.
 */
export function installHardwareConsoleEncoder(
  manager: HardwareConsoleManager,
  deps: EncoderDeps = {},
): () => void {
  const { dispatch, isOwner } = resolveDeps(deps);
  let detachDecoder: (() => void) | null = null;

  const teardownDecoder = (): void => {
    detachDecoder?.();
    detachDecoder = null;
    dispatch(encoderInputStopped());
    dispatch(encoderHudHidden());
  };

  const setupDecoder = (): void => {
    teardownDecoder();
    const decoder = new HardwareInputDecoder({
      deviceModel: manager.connectedDevice?.model ?? 'creator-micro-2',
    });
    const offRotate = decoder.on('encoderrotate', ({ direction }) => {
      if (!isOwner()) return;
      const { encoderBehavior, encoderBehaviorHydrated } = appStore.state.hardwareConsole;
      if (!encoderBehaviorHydrated) return;
      if (encoderBehavior === 'workspace-switch') handleEncoderRotate(direction, deps);
      else {
        dispatch(encoderEffortRotated(direction, resolveDeps(deps).getCurrentWorkspaceId()));
      }
    });
    const offKeydown = decoder.on('keydown', ({ key }) => {
      if (key === 'ENC_CLK' && isOwner()) handleEncoderClick(deps);
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
