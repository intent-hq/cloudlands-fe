/**
 * Registry of the v1 hardware action-key actions (spec order): cycle all
 * workspace top-level agents, the global cross-workspace cycle family
 * (in-progress, attention, idle, unread, failed agents), stop agent, see
 * spec, toggle workspace sidebar tabs, new agent, new workspace, switch
 * panel layouts, and none/unassigned.
 *
 * Each entry carries a label (i18n getter), an icon, an availability
 * predicate, and an execute function. Both evaluate against an
 * `ActionKeyContext` (narrow structural state + dispatch + navigate +
 * composer focus), so the registry imports slice actions but no selectors
 * and no store instance — dependency-light per src/store/renderer/AGENTS.md
 * middleware conventions.
 */

import type { IconDefinition } from '@fortawesome/free-solid-svg-icons';
import {
  faArrowsRotate,
  faBan,
  faBell,
  faCircleXmark,
  faEnvelope,
  faFileLines,
  faFolderPlus,
  faMoon,
  faPersonRunning,
  faRobot,
  faStop,
  faTableColumns,
  faWindowRestore,
} from '@fortawesome/free-solid-svg-icons';
import { m } from '$shared/paraglide/messages.js';
import { type Workspace } from '$shared/types';
import { CHIEF_WORKSPACE_ID } from '$shared/types/branded-ids';
import { SPEC_NOTE_ID } from '$shared/constants/notes';
import { type Collection } from '$lib/store-shim/utils/collections/collection-utils';
import type { StoredAgentSession } from '$store/renderer/slices/agent-session/agent-session-types';
import { agentSessionStopChatRequested } from '$store/renderer/slices/agent-session/agent-session-slice';
import { openAgentTabRequested } from '$store/renderer/slices/app-layout/app-layout-slice';
import { applyPreset } from '$store/renderer/slices/panel-layout/panel-layout-slice';
import {
  setMultiSelectSidebarSelectedTabs,
  setShowCreateModal,
} from '$store/renderer/slices/sidebar-nav/sidebar-nav-slice';
import {
  createAgentWithSpecialistRequested,
  setActiveAgentId,
} from '$store/renderer/slices/workspace-agents/workspace-agents-slice';
import { openWorkspaceNote } from '$store/renderer/slices/workspace-navigation/workspace-navigation-slice';
import type { ActionKeyActionId } from './action-mapping';
import {
  collectCycleAgents,
  compareLastIdleDesc,
  isSessionIdle,
  isSessionInProgress,
  sessionHasFailed,
  sessionNeedsAttention,
  type CycleAgentEntry,
} from './agent-cycle';

/** The narrow slice of the app store state the action registry reads. */
export interface ActionKeyState {
  workspace: {
    activeWorkspaceId: string | null;
    workspaces: Collection<Workspace, 'id'>;
  };
  workspaceAgents: {
    byWorkspaceId: Record<
      string,
      { foregroundAgentIds: readonly string[]; activeAgentId: string | null }
    >;
  };
  agentSessions: { byAgentId: Record<string, StoredAgentSession> };
  unreadTracking: { unreadAgentIds: readonly string[] };
  sidebarNav: {
    multiSelectTabOrder: string[];
    multiSelectSelectedTabIdsByWorkspaceId: Record<string, string[]>;
  };
}

/** Everything an action needs to check availability and run. */
export interface ActionKeyContext {
  state: ActionKeyState;
  dispatch: (action: unknown) => unknown;
  /** Navigate the app to a route (workspace switching). */
  navigate: (route: string) => Promise<void>;
  /** Focus the chat composer of an agent's (open or opening) conversation tab. */
  focusComposer: (agentId: string) => void;
}

export interface ActionKeyDefinition {
  id: ActionKeyActionId;
  /** Localized label (getter so it re-evaluates on locale change). */
  readonly label: string;
  icon: IconDefinition;
  isAvailable(context: ActionKeyContext): boolean;
  /**
   * Optional specific hint for why the action is unavailable right now.
   * Returns a localized message, or `null` to fall back to the generic
   * "not available" hint. Only consulted when `isAvailable` is false.
   */
  getUnavailableHint?(context: ActionKeyContext): string | null;
  execute(context: ActionKeyContext): void;
}

/** Mirror of the sidebar TAB_DEFINITIONS ids (MultiSelectTabbedSidebar). */
const SIDEBAR_TAB_IDS = ['overview', 'agents', 'context', 'changes', 'files'] as const;

const LAYOUT_PRESETS = ['single', 'split-horizontal', 'split-vertical', 'three-column'] as const;

/** Transient per-workspace cursor for layout-preset cycling (UI-only). */
const layoutPresetCursor = new Map<string, number>();

function activeWorkspaceId(state: ActionKeyState): string | null {
  const wsId = state.workspace.activeWorkspaceId;
  if (typeof wsId !== 'string' || wsId.length === 0 || wsId === CHIEF_WORKSPACE_ID) return null;
  return wsId;
}

function foregroundAgentIds(state: ActionKeyState, wsId: string): readonly string[] {
  return state.workspaceAgents.byWorkspaceId[wsId]?.foregroundAgentIds ?? [];
}

function workspaceActiveAgentId(state: ActionKeyState, wsId: string): string | null {
  return state.workspaceAgents.byWorkspaceId[wsId]?.activeAgentId ?? null;
}

/** In-progress top-level agents everywhere, most-recently-idle first. */
function inProgressAgents(state: ActionKeyState): CycleAgentEntry[] {
  return collectCycleAgents(state, isSessionInProgress, compareLastIdleDesc);
}

/**
 * Focus one agent: mark it active, open (or focus) its conversation tab, and
 * focus its chat composer so typing starts immediately.
 */
function focusAgent(context: ActionKeyContext, wsId: string, agentId: string): void {
  context.dispatch(setActiveAgentId(wsId, agentId));
  context.dispatch(openAgentTabRequested(wsId, { agentId }));
  context.focusComposer(agentId);
}

/** One entry of the global cross-workspace cycle family. */
interface GlobalCycleSpec {
  id: ActionKeyActionId;
  icon: IconDefinition;
  getLabel(): string;
  /** Specific empty-state toast shown when the list is empty. */
  getEmptyHint(): string;
  collect(state: ActionKeyState): CycleAgentEntry[];
}

/**
 * Shared shape of the global cycle actions: collect the matching agents,
 * step to the entry after the currently focused one (wrapping), switch
 * workspace when needed, and focus the agent's tab + composer.
 */
function makeGlobalCycleAction(spec: GlobalCycleSpec): ActionKeyDefinition {
  return {
    id: spec.id,
    get label() {
      return spec.getLabel();
    },
    icon: spec.icon,
    isAvailable({ state }) {
      return spec.collect(state).length > 0;
    },
    getUnavailableHint() {
      // An empty list is the only way a global cycle action is unavailable.
      return spec.getEmptyHint();
    },
    execute(context) {
      const { state } = context;
      const entries = spec.collect(state);
      if (entries.length === 0) return;
      const wsId = activeWorkspaceId(state);
      const current = wsId === null ? null : workspaceActiveAgentId(state, wsId);
      const index = entries.findIndex(
        (entry) => entry.wsId === wsId && entry.agentId === String(current),
      );
      const next = entries[(index + 1) % entries.length];
      if (next.wsId !== wsId) {
        void context.navigate(`/workspace/${next.wsId}`);
      }
      focusAgent(context, next.wsId, next.agentId);
    },
  };
}

/** The registry, in spec order. `none` is last (explicit unassigned entry). */
export const ACTION_KEY_REGISTRY: readonly ActionKeyDefinition[] = [
  {
    id: 'cycle-workspace-agents',
    get label() {
      return m.hardwareConsole_actionKey_cycleWorkspaceAgents_label();
    },
    icon: faArrowsRotate,
    isAvailable({ state }) {
      const wsId = activeWorkspaceId(state);
      return wsId !== null && foregroundAgentIds(state, wsId).length > 0;
    },
    getUnavailableHint({ state }) {
      // Specific empty-state hint only when a workspace is active but has no
      // agents; without an active workspace the generic hint applies.
      if (activeWorkspaceId(state) === null) return null;
      return m.hardwareConsole_actionKey_noActiveAgents_message();
    },
    execute(context) {
      const { state } = context;
      const wsId = activeWorkspaceId(state);
      if (wsId === null) return;
      const ids = foregroundAgentIds(state, wsId).map(String);
      if (ids.length === 0) return;
      const current = workspaceActiveAgentId(state, wsId);
      const index = current === null ? -1 : ids.indexOf(String(current));
      focusAgent(context, wsId, ids[(index + 1) % ids.length]);
    },
  },
  makeGlobalCycleAction({
    id: 'cycle-in-progress-agents',
    icon: faPersonRunning,
    getLabel: () => m.hardwareConsole_actionKey_cycleInProgressAgents_label(),
    getEmptyHint: () => m.hardwareConsole_actionKey_noActiveAgents_message(),
    collect: inProgressAgents,
  }),
  makeGlobalCycleAction({
    id: 'cycle-attention-agents',
    icon: faBell,
    getLabel: () => m.hardwareConsole_actionKey_cycleAttentionAgents_label(),
    getEmptyHint: () => m.hardwareConsole_actionKey_noAttentionAgents_message(),
    collect: (state) => collectCycleAgents(state, sessionNeedsAttention),
  }),
  makeGlobalCycleAction({
    id: 'cycle-idle-agents',
    icon: faMoon,
    getLabel: () => m.hardwareConsole_actionKey_cycleIdleAgents_label(),
    getEmptyHint: () => m.hardwareConsole_actionKey_noIdleAgents_message(),
    collect: (state) => collectCycleAgents(state, isSessionIdle),
  }),
  makeGlobalCycleAction({
    id: 'cycle-unread-agents',
    icon: faEnvelope,
    getLabel: () => m.hardwareConsole_actionKey_cycleUnreadAgents_label(),
    getEmptyHint: () => m.hardwareConsole_actionKey_noUnreadAgents_message(),
    collect: (state) =>
      collectCycleAgents(state, (_session, agentId) =>
        state.unreadTracking.unreadAgentIds.includes(agentId),
      ),
  }),
  makeGlobalCycleAction({
    id: 'cycle-failed-agents',
    icon: faCircleXmark,
    getLabel: () => m.hardwareConsole_actionKey_cycleFailedAgents_label(),
    getEmptyHint: () => m.hardwareConsole_actionKey_noFailedAgents_message(),
    collect: (state) => collectCycleAgents(state, sessionHasFailed),
  }),
  {
    id: 'stop-agent',
    get label() {
      return m.hardwareConsole_actionKey_stopAgent_label();
    },
    icon: faStop,
    isAvailable({ state }) {
      const wsId = activeWorkspaceId(state);
      if (wsId === null) return false;
      const agentId = workspaceActiveAgentId(state, wsId);
      return agentId !== null && isSessionInProgress(state.agentSessions.byAgentId[agentId]);
    },
    execute(context) {
      const { state, dispatch } = context;
      const wsId = activeWorkspaceId(state);
      if (wsId === null) return;
      const agentId = workspaceActiveAgentId(state, wsId);
      if (agentId === null || !isSessionInProgress(state.agentSessions.byAgentId[agentId])) return;
      dispatch(agentSessionStopChatRequested(agentId));
      // The user plausibly types next (correction/new direction).
      context.focusComposer(agentId);
    },
  },
  {
    id: 'see-spec',
    get label() {
      return m.hardwareConsole_actionKey_seeSpec_label();
    },
    icon: faFileLines,
    isAvailable({ state }) {
      return activeWorkspaceId(state) !== null;
    },
    execute({ state, dispatch }) {
      const wsId = activeWorkspaceId(state);
      if (wsId === null) return;
      dispatch(openWorkspaceNote(wsId, SPEC_NOTE_ID));
    },
  },
  {
    id: 'toggle-sidebar-tabs',
    get label() {
      return m.hardwareConsole_actionKey_toggleSidebarTabs_label();
    },
    icon: faTableColumns,
    isAvailable({ state }) {
      return activeWorkspaceId(state) !== null;
    },
    execute({ state, dispatch }) {
      const wsId = activeWorkspaceId(state);
      if (wsId === null) return;
      const order =
        state.sidebarNav.multiSelectTabOrder.length > 0
          ? state.sidebarNav.multiSelectTabOrder
          : [...SIDEBAR_TAB_IDS];
      const selected = state.sidebarNav.multiSelectSelectedTabIdsByWorkspaceId[wsId] ?? [];
      const currentIndex = selected.length === 1 ? order.indexOf(selected[0]) : -1;
      dispatch(
        setMultiSelectSidebarSelectedTabs(wsId, [order[(currentIndex + 1) % order.length]]),
      );
    },
  },
  {
    id: 'new-agent',
    get label() {
      return m.hardwareConsole_actionKey_newAgent_label();
    },
    icon: faRobot,
    isAvailable({ state }) {
      return activeWorkspaceId(state) !== null;
    },
    execute({ state, dispatch }) {
      const wsId = activeWorkspaceId(state);
      if (wsId === null) return;
      dispatch(createAgentWithSpecialistRequested(wsId, null));
    },
  },
  {
    id: 'new-workspace',
    get label() {
      return m.hardwareConsole_actionKey_newWorkspace_label();
    },
    icon: faFolderPlus,
    isAvailable() {
      return true;
    },
    execute({ dispatch }) {
      dispatch(setShowCreateModal(true));
    },
  },
  {
    id: 'switch-window-layouts',
    get label() {
      return m.hardwareConsole_actionKey_switchWindowLayouts_label();
    },
    icon: faWindowRestore,
    isAvailable({ state }) {
      return activeWorkspaceId(state) !== null;
    },
    execute({ state, dispatch }) {
      const wsId = activeWorkspaceId(state);
      if (wsId === null) return;
      const next = ((layoutPresetCursor.get(wsId) ?? -1) + 1) % LAYOUT_PRESETS.length;
      layoutPresetCursor.set(wsId, next);
      dispatch(applyPreset(wsId, LAYOUT_PRESETS[next]));
    },
  },
  {
    id: 'none',
    get label() {
      return m.hardwareConsole_actionKey_none_label();
    },
    icon: faBan,
    isAvailable() {
      return false;
    },
    execute() {
      // Unassigned — nothing to do.
    },
  },
];

/** Registry lookup by action id. */
export function getActionKeyDefinition(id: ActionKeyActionId): ActionKeyDefinition {
  const definition = ACTION_KEY_REGISTRY.find((entry) => entry.id === id);
  if (!definition) throw new Error(`Unknown action key action: ${id}`);
  return definition;
}
