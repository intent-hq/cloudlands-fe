/**
 * Encoder behaviors for the hardware console.
 *
 * Subscribes an input decoder to the shared manager's raw channel-2 stream
 * (`onRawMessage`) and wires the rotary encoder:
 * - rotate: on Home's Workspaces list moves the selection (and its side
 *   preview) down or up in every mode; elsewhere adjusts the current agent's
 *   effort by default, or optionally steps across the open workspace tabs,
 *   left to right. All modes clamp at the ends;
 * - click (`ENC_CLK` keydown): opens the workspace selected on Home's
 *   Workspaces list, otherwise opens Home like the titlebar Home button.
 *   A press that opens Home holds it briefly, so a bounced or repeating
 *   press report cannot carry on into Home's kept selection.
 *
 * The HUD timer is action-driven in the device saga.
 *
 * Dependency-light device service: AppClient-free; effort writes run in a saga.
 */
import { store as appStore } from '$store/renderer/store';
import { createLogger } from '$lib/utils/client-logger';
import { navigateToRoute } from '$lib/utils/navigation.client';
import { openAndShowWorkspace } from '$lib/utils/show-workspace';
import {
  encoderHudHidden,
  encoderEffortRotated,
  encoderInputStopped,
  encoderHudShown,
} from '$store/renderer/slices/hardware-console/hardware-console-slice';
import type { HardwareConsoleManager } from '../device/device-manager';
import { HardwareInputDecoder } from '../input/input-decoder';
import type { PhysicalKnobDirection } from '../input/types';
import { isConsoleOwner } from '../owner-gate';
import { stepWorkspaceTab, visibleWorkspaceTabs } from './workspace-cycle';
import { getWorkspaceTabGroupList } from '$store/renderer/slices/tab-state/tab-state-slice';
import { resolveOpenWorkspaceTabGroupId } from '$store/renderer/slices/tab-state/tab-groups';
import { getVisibleWorkspaceId } from '$features/workspace/visible-workspace';
import { currentRoutePath } from '$lib/utils/workspace-route-path';
import { getHomeEncoderTarget, stepHomeSelection } from '$features/home/home-encoder-target';

const logger = createLogger('HardwareConsoleEncoder');

/** The encoder HUD hides after this much rotation inactivity. */
export const ENCODER_HUD_HIDE_MS = 1200;

/**
 * After a press opens Home, presses this close together are the same gesture
 * (switch bounce, held-knob repeat) and keep Home open. Each one extends it;
 * turning the knob on Home ends it.
 */
const ENCODER_HOME_SETTLE_MS = 750;

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

/**
 * The tabs the strip shows, in order, with `cursor` treated as current so a
 * detent landing in a group opens it. Mirrors `selectWorkspaceTabOrder` and
 * `selectOpenWorkspaceTabGroupId`, read straight from state: device services
 * load before selectors can be created.
 */
function visibleTabOrder(cursor: string | null): string[] {
  const { tabState, userPreferences } = appStore.state;
  const order = tabState.workspaceStacks.flat();
  if (userPreferences?.labsTabGroupsEnabled !== true) return order;
  const groups = getWorkspaceTabGroupList(tabState);
  const openGroupId = resolveOpenWorkspaceTabGroupId(
    groups,
    cursor ?? tabState.currentTabId,
    tabState.openTabGroupId,
  );
  return visibleWorkspaceTabs(order, groups, openGroupId);
}

function navigateToWorkspace(
  workspaceId: string,
  showWorkspace: (workspaceId: string) => Promise<unknown>,
): void {
  // A newer jump supersedes earlier ones, so rapid detents only tab the
  // workspace the rotation lands on.
  void showWorkspace(workspaceId).catch((error: unknown) => {
    logger.warn('Failed to open workspace from encoder', { workspaceId, error });
  });
}

/**
 * Handle one Switch tabs detent. Returns the workspace id the detent
 * navigated to, or null when there was nowhere to go (the tab strip ends).
 */
function handleEncoderRotate(
  direction: PhysicalKnobDirection,
  deps: EncoderDeps = {},
): string | null {
  const { showWorkspace, dispatch, getCurrentWorkspaceId } = resolveDeps(deps);
  const state = appStore.state;

  const cursor = state.hardwareConsole.encoderHudWorkspaceId ?? getCurrentWorkspaceId();
  const target = stepWorkspaceTab(visibleTabOrder(cursor), cursor, direction);
  if (target === null) return null;
  dispatch(encoderHudShown(target));
  navigateToWorkspace(target, showWorkspace);
  return target;
}

/** Home's Workspaces list while it is on screen, with its row ids. */
function visibleHomeList() {
  const target = getHomeEncoderTarget();
  const ids = currentRoutePath() === '/' ? target?.ids() : null;
  return target && ids ? { target, ids } : null;
}

/**
 * Move Home's workspace selection one row. Returns false when Home's
 * Workspaces list is not on screen, leaving the detent to the mode's path.
 */
function handleHomeRotate(direction: PhysicalKnobDirection): boolean {
  const home = visibleHomeList();
  if (!home) return false;
  const next = stepHomeSelection(home.ids, home.target.selectedId(), direction);
  if (next !== null) home.target.select(next);
  return true;
}

/**
 * The workspace previewed from Home's Workspaces list, if any. Its row may sit
 * in a collapsed group; the preview still shows it.
 */
function selectedHomeWorkspaceId(): string | null {
  return visibleHomeList()?.target.selectedId() ?? null;
}

/**
 * Open the workspace selected on Home's list; otherwise open Home, matching
 * the titlebar Home button and its shortcut. `holdHome` skips the selection.
 * Returns whether it opened Home.
 */
function handleEncoderClick(deps: EncoderDeps, holdHome: boolean): boolean {
  const { navigate, showWorkspace } = resolveDeps(deps);
  const selectedId = holdHome ? null : selectedHomeWorkspaceId();
  if (selectedId !== null) {
    navigateToWorkspace(selectedId, showWorkspace);
    return false;
  }
  void navigate('/').catch((error: unknown) => {
    logger.warn('Failed to open Home from encoder', { error });
  });
  return true;
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
  let homeHeldUntil = 0;

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
      const workspaceId = resolveDeps(deps).getCurrentWorkspaceId();
      if (workspaceId === null && handleHomeRotate(direction)) {
        homeHeldUntil = 0;
        return;
      }
      if (encoderBehavior === 'workspace-switch') handleEncoderRotate(direction, deps);
      else dispatch(encoderEffortRotated(direction, workspaceId));
    });
    const offKeydown = decoder.on('keydown', ({ key }) => {
      if (key !== 'ENC_CLK' || !isOwner()) return;
      const now = Date.now();
      const openedHome = handleEncoderClick(deps, now < homeHeldUntil);
      homeHeldUntil = openedHome ? now + ENCODER_HOME_SETTLE_MS : 0;
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
