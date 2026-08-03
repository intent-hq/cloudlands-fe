/**
 * Agent-key → workspace switching for the hardware console.
 *
 * Subscribes an input decoder to the shared manager's raw channel-2 stream
 * (`onRawMessage` — includes the CM2's bare joystick objects that never
 * reach `onNotification`) and, on agent-key presses, focuses the workspace
 * resolved for that key ({@link focusWorkspaceSlot}):
 * - first press (workspace not currently active): navigate to
 *   `/workspace/{id}` and land on the first agent tab needing attention
 *   (pending discussion/blocker request or wizard question — the LED
 *   engine's attention definition via `sessionNeedsAttention`); when none
 *   needs attention, the workspace's current tab (or first open tab) is
 *   shown;
 * - subsequent presses (workspace already active): cycle through the
 *   workspace's open tabs in order, wrapping around;
 * - no open tabs (either case): open the workspace's first top-level
 *   agent as a tab and focus its composer, reusing the action-key flow
 *   (`setActiveAgentId` + `openAgentTabRequested` + composer focus).
 *
 * A fresh decoder is created per connection so the Mic-coalescing device
 * model always matches the connected device.
 *
 * Dependency-light middleware module: AppClient-free, no selector imports —
 * slot resolution and tab/attention lookups read `appStore.state` directly
 * via pure helpers.
 */
import type { StoreMiddleware } from '$lib/store-shim/types';
import { store as appStore } from '$store/renderer/store';
import { createLogger } from '$lib/utils/client-logger';
import { navigateToRoute } from '$lib/utils/navigation.client';
import type { HardwareConsoleManager } from '../device/device-manager';
import { getHardwareConsoleManager } from '../instance';
import { HardwareInputDecoder } from '../input/input-decoder';
import type { LogicalKeyId } from '../input/types';
import {
  agentKeyToSlot,
  isKeyAssignableWorkspace,
  resolveKeySlots,
} from './key-assignment';
import { getItems } from '$lib/store-shim/utils/collections/collection-utils';
import { CHIEF_WORKSPACE_ID } from '$shared/types/branded-ids';
import {
  focusPanel,
  setActiveTab,
} from '$store/renderer/slices/panel-layout/panel-layout-slice';
import { openAgentTabRequested } from '$store/renderer/slices/app-layout/app-layout-slice';
import { setActiveAgentId } from '$store/renderer/slices/workspace-agents/workspace-agents-slice';
import { sessionNeedsAttention } from '../actions/agent-cycle';
import { focusAgentComposer } from '../actions/action-key-service';

const logger = createLogger('HardwareConsoleKeySwitch');

export interface KeySwitchDeps {
  /** Navigate the app to a route. Defaults to `navigateToRoute`. */
  navigate?: (route: string) => Promise<void>;
  /** Focus an agent tab's chat composer. Defaults to `focusAgentComposer`. */
  focusComposer?: (agentId: string) => void;
}

function resolveSlotWorkspaceId(slot: number): string | null {
  const state = appStore.state;
  const workspaces = getItems(state.workspace.workspaces).filter(
    (workspace) => workspace.id !== CHIEF_WORKSPACE_ID && isKeyAssignableWorkspace(workspace),
  );
  return (
    resolveKeySlots(
      state.hardwareConsole.keyPins,
      workspaces,
      state.hardwareConsole.excludedWorkspaceIds,
    )[slot] ?? null
  );
}

/** One open tab in the workspace's flattened panel order. */
interface OrderedTab {
  panelId: string;
  tabId: string;
  type: string;
  agentId?: string;
}

/** All open tabs of a workspace, flattened in panel order then tab order. */
function listOpenTabsInOrder(workspaceId: string): OrderedTab[] {
  const layout = appStore.state.panelLayout.byWorkspaceId[workspaceId];
  if (!layout) return [];
  return Object.values(layout.panels).flatMap((panel) =>
    panel.tabs.map((tab) => ({
      panelId: panel.id,
      tabId: tab.id,
      type: tab.type,
      agentId: tab.agentId,
    })),
  );
}

/** Make `tab` the active tab, moving panel focus when needed. */
function focusTab(workspaceId: string, tab: OrderedTab): void {
  const layout = appStore.state.panelLayout.byWorkspaceId[workspaceId];
  if (layout?.focusedPanelId !== tab.panelId) {
    appStore.dispatch(focusPanel(workspaceId, tab.panelId));
  }
  appStore.dispatch(setActiveTab(workspaceId, tab.tabId, tab.panelId));
}

/**
 * First open agent tab whose session needs attention — pending attention
 * request (discussion/blocker) or pending wizard question, per the shared
 * `sessionNeedsAttention` predicate (agrees with the LED engine) — or null
 * when none needs attention.
 */
function findFirstAttentionTab(tabs: readonly OrderedTab[]): OrderedTab | null {
  const sessions = appStore.state.agentSessions?.byAgentId ?? {};
  for (const tab of tabs) {
    if (tab.type !== 'agent' || !tab.agentId) continue;
    if (sessionNeedsAttention(sessions[tab.agentId])) return tab;
  }
  return null;
}

/**
 * With no open tabs, open the workspace's first top-level agent as a tab
 * and focus its composer (the action-key focusAgent flow). No-op (returns
 * false) when the workspace has no top-level agents.
 */
function openFirstTopLevelAgent(workspaceId: string, deps: KeySwitchDeps): boolean {
  const agentId =
    appStore.state.workspaceAgents.byWorkspaceId[workspaceId]?.foregroundAgentIds[0] ?? null;
  if (agentId === null) return false;
  appStore.dispatch(setActiveAgentId(workspaceId, agentId));
  appStore.dispatch(openAgentTabRequested(workspaceId, { agentId }));
  (deps.focusComposer ?? focusAgentComposer)(agentId);
  return true;
}

/**
 * Focus the workspace behind a hardware key slot. Reusable behavior shared
 * with the Settings device graphic:
 * - workspace not active: navigate to it and land on the first agent tab
 *   requiring attention; with none pending, keep the workspace's current
 *   tab (or activate the first open tab when no tab is active yet);
 * - workspace already active: cycle to the next open tab in order (wrap);
 * - no open tabs (either case): open the first top-level agent as a tab.
 */
export function focusWorkspaceSlot(workspaceId: string, deps: KeySwitchDeps = {}): void {
  const tabs = listOpenTabsInOrder(workspaceId);
  const layout = appStore.state.panelLayout.byWorkspaceId[workspaceId];
  const focusedPanelId = layout?.focusedPanelId ?? null;
  const activeTabId = focusedPanelId ? (layout?.panels[focusedPanelId]?.activeTabId ?? null) : null;

  if (appStore.state.workspace.activeWorkspaceId !== workspaceId) {
    const navigate = deps.navigate ?? navigateToRoute;
    void navigate(`/workspace/${workspaceId}`).catch((error: unknown) => {
      logger.warn('Failed to switch workspace from agent key', { workspaceId, error });
    });
    if (tabs.length === 0) {
      openFirstTopLevelAgent(workspaceId, deps);
      return;
    }
    const attentionTab = findFirstAttentionTab(tabs);
    if (attentionTab) {
      focusTab(workspaceId, attentionTab);
    } else if (activeTabId === null) {
      focusTab(workspaceId, tabs[0]);
    }
    return;
  }

  // Already active: cycle through the open tabs in order, wrapping around.
  if (tabs.length === 0) {
    openFirstTopLevelAgent(workspaceId, deps);
    return;
  }
  const currentIndex = tabs.findIndex(
    (tab) => tab.panelId === focusedPanelId && tab.tabId === activeTabId,
  );
  focusTab(workspaceId, tabs[(currentIndex + 1) % tabs.length]);
}

/**
 * Handle one agent-key press. Exported for tests. Returns the workspace id
 * that was targeted, or null when the key had no assignment.
 */
export function handleAgentKeyEvent(
  key: LogicalKeyId,
  deps: KeySwitchDeps = {},
): string | null {
  const slot = agentKeyToSlot(key);
  if (slot === null) return null;
  const workspaceId = resolveSlotWorkspaceId(slot);
  if (workspaceId === null) return null;
  focusWorkspaceSlot(workspaceId, deps);
  return workspaceId;
}

/**
 * Wire agent-key switching to a manager. Returns the teardown function.
 * Exported for tests; production installs via the middleware below.
 */
export function installHardwareConsoleKeySwitching(
  manager: HardwareConsoleManager,
  deps: KeySwitchDeps = {},
): () => void {
  let detachDecoder: (() => void) | null = null;

  const teardownDecoder = (): void => {
    detachDecoder?.();
    detachDecoder = null;
  };

  const setupDecoder = (): void => {
    teardownDecoder();
    const decoder = new HardwareInputDecoder({
      deviceModel: manager.connectedDevice?.model ?? 'creator-micro-2',
    });
    const offKeydown = decoder.on('keydown', ({ key }) => {
      handleAgentKeyEvent(key, deps);
    });
    const offRaw = manager.onRawMessage((message) => decoder.handleMessage(message));
    detachDecoder = () => {
      offRaw();
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

let installed = false;

/**
 * Lazily install on the first dispatched action (same pattern as the
 * connection-toast middleware): starts the shared manager — idempotent, a
 * no-op without WebHID — and wires agent-key switching.
 */
export function createHardwareConsoleKeySwitchMiddleware(): StoreMiddleware {
  return () => (next) => (action) => {
    if (!installed) {
      installed = true;
      const manager = getHardwareConsoleManager();
      installHardwareConsoleKeySwitching(manager);
      void manager.start();
    }
    return next(action);
  };
}
