/**
 * Encoder behaviors for the hardware console.
 *
 * Subscribes an input decoder to the shared manager's raw channel-2 stream
 * (`onRawMessage`) and wires the rotary encoder:
 * - rotate: adjusts the current agent's effort by default, or on Home's
 *   Workspaces list moves the selection (and its side preview) down or up;
 *   optionally cycles workspaces ordered by activity. All modes clamp at the
 *   ends;
 * - click (`ENC_CLK` keydown): opens Home, like the titlebar Home button.
 *
 * The HUD timer is action-driven in the device saga.
 *
 * Dependency-light device service: AppClient-free; effort writes run in a saga.
 */
import { store as appStore } from '$store/renderer/store';
import { createLogger } from '$lib/utils/client-logger';
import { navigateToRoute } from '$lib/utils/navigation.client';
import { openAndShowWorkspace } from '$lib/utils/show-workspace';
import { getItems } from '@themislib/themis/utils/collections/collection-utils';
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
import { cycleWorkspaceId, orderWorkspacesForCycling } from './workspace-cycle';
import { getVisibleWorkspaceId } from '$features/workspace/visible-workspace';
import { currentRoutePath } from '$lib/utils/workspace-route-path';
import { getHomeEncoderTarget, stepHomeSelection } from '$features/home/home-encoder-target';

const logger = createLogger('HardwareConsoleEncoder');

/** The encoder HUD hides after this much rotation inactivity. */
export const ENCODER_HUD_HIDE_MS = 1200;

export interface EncoderDeps {
  /** Navigate the app to a non-workspace route (Home). Defaults to `navigateToRoute`. */
  navigate?: (route: string) => Promise<void>;
  /** Jump to a workspace and open its tab. Defaults to `openAndShowWorkspace`. */
  showWorkspace?: (workspaceId: string) => Promise<unknown>;
  /** Dispatch into the app store. Defaults to `appStore.dispatch`. */
  dispatch?: (action: unknown) => void;
  /** Console-owner gate (#1928). Defaults to the store-backed `isConsoleOwner`. */
  isOwner?: () => boolean;
  /**
   * Visible-workspace seam. Defaults to `getVisibleWorkspaceId`: null on
   * Home and Settings, so rotation never steps from (or tunes the effort of)
   * the hidden last workspace tab.
   */
  getCurrentWorkspaceId?: () => string | null;
}

function resolveDeps(deps: EncoderDeps): Required<EncoderDeps> {
  return {
    navigate: deps.navigate ?? navigateToRoute,
    showWorkspace: deps.showWorkspace ?? openAndShowWorkspace,
    dispatch: deps.dispatch ?? ((action: unknown) => appStore.dispatch(action as never)),
    isOwner: deps.isOwner ?? isConsoleOwner,
    getCurrentWorkspaceId: deps.getCurrentWorkspaceId ?? getVisibleWorkspaceId,
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
  showWorkspace: (workspaceId: string) => Promise<unknown>,
): void {
  // Each detent jumps; the helper only tabs the workspace the rotation lands
  // on, because a newer jump supersedes the earlier ones.
  void showWorkspace(workspaceId).catch((error: unknown) => {
    logger.warn('Failed to switch workspace from encoder', { workspaceId, error });
  });
}

/**
 * Handle one encoder detent. Exported for tests. Returns the workspace id
 * the detent navigated to, or null when there was nowhere to go (cycling
 * clamps at the ends of the activity-ordered list).
 */
function handleEncoderRotate(direction: EncoderDirection, deps: EncoderDeps = {}): string | null {
  const { showWorkspace, dispatch, getCurrentWorkspaceId } = resolveDeps(deps);
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
  navigateToWorkspace(target, showWorkspace);
  return target;
}

/**
 * Move Home's workspace selection one row. Returns false when Home's
 * Workspaces list is not on screen, leaving the detent to the effort path.
 */
function handleHomeRotate(direction: EncoderDirection): boolean {
  const target = getHomeEncoderTarget();
  const ids = currentRoutePath() === '/' ? target?.ids() : null;
  if (!target || !ids) return false;
  const next = stepHomeSelection(ids, target.selectedId(), direction);
  if (next !== null) target.select(next);
  return true;
}

/**
 * Open Home, matching the titlebar Home button and its shortcut.
 */
function handleEncoderClick(deps: EncoderDeps = {}): void {
  const { navigate } = resolveDeps(deps);
  void navigate('/').catch((error: unknown) => {
    logger.warn('Failed to open Home from encoder', { error });
  });
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
        // Calibrate rotation to the physical Creator Micro 2 report
        // (intent-hq/intent#5947), shared with Codex Micro. Keep workspace
        // navigation's existing wire direction and catalog effort order intact.
        const physical = direction === 'cw' ? 'ccw' : 'cw';
        const workspaceId = resolveDeps(deps).getCurrentWorkspaceId();
        if (workspaceId === null && handleHomeRotate(physical)) return;
        dispatch(encoderEffortRotated(physical, workspaceId));
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
