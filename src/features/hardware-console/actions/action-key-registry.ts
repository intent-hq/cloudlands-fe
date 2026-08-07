/**
 * Registry of the v1 hardware action-key actions (spec order): cycle all
 * workspace top-level agents, the global cross-workspace cycle family
 * (in-progress, attention, idle, unread, failed agents), stop agent, see
 * spec, toggle workspace sidebar tabs, new agent, new workspace, switch
 * panel layouts, push to talk (hold-capable), and none/unassigned.
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
  faMicrophone,
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
import { getItems, type Collection } from '$lib/store-shim/utils/collections/collection-utils';
import type { StoredAgentSession } from '$store/renderer/slices/agent-session/agent-session-types';
import { agentSessionStopChatRequested } from '$store/renderer/slices/agent-session/agent-session-slice';
import { openAgentTabRequested } from '$store/renderer/slices/app-layout/app-layout-slice';
import { actionHudShown } from '$store/renderer/slices/hardware-console/hardware-console-slice';
import {
  setMultiSelectSidebarSelectedTabs,
  setShowCreateModal,
} from '$store/renderer/slices/sidebar-nav/sidebar-nav-slice';
import {
  createAgentWithSpecialistRequested,
  setActiveAgentId,
} from '$store/renderer/slices/workspace-agents/workspace-agents-slice';
import { openWorkspaceNote } from '$store/renderer/slices/workspace-navigation/workspace-navigation-slice';
import {
  resolveEffectiveVoiceEngine,
  type EffectiveVoiceEngineInputs,
} from '$features/voice/effective-voice-engine';
import { createLogger } from '$lib/utils/client-logger';
import { isVoiceRecordingSupported } from '../voice/voice-recorder';
import {
  handleVoiceKeyDown,
  handleVoiceKeyUp,
  isPttRecordingActive,
} from '../voice/ptt-controller';
import { showVoiceSetupToast } from '../voice/voice-setup-toast';
import type { ActionKeyActionId } from './action-mapping';
import {
  collectCycleAgents,
  compareLastIdleDesc,
  isSessionCyclable,
  isSessionIdle,
  isSessionInProgress,
  sessionHasFailed,
  sessionNeedsAttention,
  type CycleAgentEntry,
} from './agent-cycle';
import type { CycleScope, CycleScopeFamilyId } from './cycle-scope';

const logger = createLogger('HardwareConsoleActionKeyRegistry');

/** The narrow slice of the app store state the action registry reads. */
export interface ActionKeyState {
  workspace: {
    activeWorkspaceId: string | null;
    workspaces: Collection<Workspace, 'id'>;
  };
  workspaceAgents: {
    byWorkspaceId: Record<
      string,
      {
        agentIds: readonly string[];
        foregroundAgentIds: readonly string[];
        activeAgentId: string | null;
      }
    >;
  };
  agentSessions: { byAgentId: Record<string, StoredAgentSession> };
  hardwareConsole: { cycleScopeByFamily: Record<CycleScopeFamilyId, CycleScope> };
  sidebarNav: {
    multiSelectTabOrder: string[];
    multiSelectSelectedTabIdsByWorkspaceId: Record<string, string[]>;
    showCreateModal: boolean;
  };
  /** Engine preference + configuration reality for the push-to-talk gate. */
  voiceSettings: EffectiveVoiceEngineInputs;
}

/** Everything an action needs to check availability and run. */
export interface ActionKeyContext {
  state: ActionKeyState;
  dispatch: (action: unknown) => unknown;
  /** Navigate the app to a route (workspace switching). */
  navigate: (route: string) => Promise<void>;
  /** Focus the chat composer of an agent's (open or opening) conversation tab. */
  focusComposer: (agentId: string) => void;
  /** Show a subtle toast hint (same surface as the unavailable-action hint). */
  showHint: (message: string) => void;
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
  /**
   * Optional hold support: when present, the action is hold-capable —
   * `execute` runs on `keydown` (hold start) and `executeUp` on the
   * matching `keyup` (hold end). Actions without it keep the existing
   * press-only behavior (`execute` on keydown, keyup ignored). Release
   * runs without an availability re-check so an in-progress hold always
   * ends cleanly, and it must be idempotent — the Codex Micro's factory
   * 2U Mic keycap presses ACT10 + ACT11 together, so two slots mapped to
   * the same hold action deliver duplicate keydown/keyup pairs.
   */
  executeUp?(context: ActionKeyContext): void;
}

/** Mirror of the sidebar TAB_DEFINITIONS ids (MultiSelectTabbedSidebar). */
const SIDEBAR_TAB_IDS = ['overview', 'agents', 'context', 'changes', 'files'] as const;

const LAYOUT_PRESETS = ['planning', 'agents-row', 'changes', 'review'] as const;

/** Transient per-workspace cursor for layout-preset cycling (UI-only). */
const layoutPresetCursor = new Map<string, number>();

function activeWorkspaceId(state: ActionKeyState): string | null {
  const wsId = state.workspace.activeWorkspaceId;
  if (typeof wsId !== 'string' || wsId.length === 0 || wsId === CHIEF_WORKSPACE_ID) return null;
  return wsId;
}

function workspaceActiveAgentId(state: ActionKeyState, wsId: string): string | null {
  return state.workspaceAgents.byWorkspaceId[wsId]?.activeAgentId ?? null;
}

/** The globally focused agent: the active workspace's active agent id. */
function focusedAgentId(state: ActionKeyState): string | null {
  const wsId = activeWorkspaceId(state);
  const current = wsId === null ? null : workspaceActiveAgentId(state, wsId);
  return current === null ? null : String(current);
}

/** The configured scope of a togglable cycle family (see cycle-scope.ts). */
function familyScope(state: ActionKeyState, familyId: CycleScopeFamilyId): CycleScope {
  return state.hardwareConsole.cycleScopeByFamily[familyId];
}

/** In-progress agents everywhere (per scope), most-recently-idle first. */
function inProgressAgents(state: ActionKeyState): CycleAgentEntry[] {
  return collectCycleAgents(
    state,
    isSessionInProgress,
    compareLastIdleDesc,
    familyScope(state, 'cycle-in-progress-agents'),
  );
}

/**
 * The unread-cycle walk: union of two walks, deduped by agent id — each
 * walk is in workspace order, and unread-workspace entries precede
 * attention-only entries: (a) the top-level agents of each unread
 * workspace (unread is workspace-level, BE-owned `workspace.attention`) —
 * a fixed top-level walk; and (b) every attention-requesting agent (the
 * LED attention definition), which follows the `cycle-attention-agents`
 * configured scope so the settings toggle also governs this portion.
 * `attentionAgentIds` records walk (b) membership independent of dedup
 * position, for the remaining-stop count.
 */
function collectUnreadCycleEntries(state: ActionKeyState): {
  entries: CycleAgentEntry[];
  attentionAgentIds: Set<string>;
} {
  const unreadWorkspaceIds = new Set<string>(
    getItems(state.workspace.workspaces)
      .filter((workspace) => workspace.attention === 'unread')
      .map((workspace) => workspace.id),
  );
  const unreadEntries = collectCycleAgents(state, isSessionCyclable).filter((entry) =>
    unreadWorkspaceIds.has(entry.wsId),
  );
  const attentionEntries = collectCycleAgents(
    state,
    sessionNeedsAttention,
    undefined,
    familyScope(state, 'cycle-attention-agents'),
  );
  const seen = new Set<string>();
  const entries = [...unreadEntries, ...attentionEntries].filter((entry) => {
    if (seen.has(entry.agentId)) return false;
    seen.add(entry.agentId);
    return true;
  });
  return { entries, attentionAgentIds: new Set(attentionEntries.map((entry) => entry.agentId)) };
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

/**
 * Per-family round-robin cursor: the agent id a cycle action last stepped
 * to. The state-derived anchor (active workspace + its active agent) lags
 * after a cross-workspace hop — `navigate()` resolves before the route
 * mounts and dispatches `setActiveWorkspaceId`, and the workspace loader
 * may re-point `activeAgentId` — so anchoring on it alone re-entered the
 * walk at the same position press after press. Transient UI-only state
 * (like `layoutPresetCursor` below).
 */
const lastCycledAgentByAction = new Map<ActionKeyActionId, string>();

/** Reset the cycle cursors (test isolation). */
export function resetActionKeyCycleCursors(): void {
  lastCycledAgentByAction.clear();
}

/** One entry of the global cross-workspace cycle family. */
interface GlobalCycleSpec {
  id: ActionKeyActionId;
  icon: IconDefinition;
  getLabel(): string;
  /** Specific empty-state toast shown when the list is empty. */
  getEmptyHint(): string;
  /** Toast shown when the only candidate is already the focused agent. */
  getSingleCandidateHint(): string;
  /**
   * Optional HUD label for a successful step, given how many stops remain
   * to visit after this one. Families without it show the plain label.
   */
  getHudLabel?(remaining: number): string;
  /**
   * Optional override of the remaining-stop count fed to `getHudLabel`.
   * The default, `entries.length - 1`, is right when every candidate
   * needs its own visit; override it when one step clears several
   * entries at once (e.g. workspace-level unread).
   */
  countRemaining?(state: ActionKeyState, entries: CycleAgentEntry[], next: CycleAgentEntry): number;
  collect(state: ActionKeyState): CycleAgentEntry[];
}

/**
 * Shared shape of the global cycle actions: collect the matching agents,
 * step to the entry after the walk anchor (the family's own cursor when it
 * is still a candidate, else the focused agent, wrapping), switch workspace
 * when needed, and focus the agent's tab + composer. The cursor is
 * preferred because the state anchor can lag or be re-pointed between
 * presses (async navigation, workspace loaders) — anchoring on it alone is
 * what trapped the walk on one agent. When the only candidate is already
 * focused there is nothing to switch between — a toast says so instead of
 * a silent no-op.
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
      const focused = focusedAgentId(state);
      if (entries.length === 1 && entries[0].agentId === focused) {
        lastCycledAgentByAction.set(spec.id, entries[0].agentId);
        context.showHint(spec.getSingleCandidateHint());
        return;
      }
      const cursor = lastCycledAgentByAction.get(spec.id);
      let index = cursor === undefined ? -1 : entries.findIndex((e) => e.agentId === cursor);
      if (index === -1 && focused !== null) {
        index = entries.findIndex((e) => e.agentId === focused);
      }
      const next = entries[(index + 1) % entries.length];
      lastCycledAgentByAction.set(spec.id, next.agentId);
      // Successful step: surface what the button did in the bottom-center
      // HUD (the middleware hides it after inactivity).
      const remaining = spec.countRemaining?.(state, entries, next) ?? entries.length - 1;
      context.dispatch(actionHudShown(spec.getHudLabel?.(remaining) ?? spec.getLabel()));
      if (next.wsId !== activeWorkspaceId(state)) {
        void context.navigate(`/workspace/${next.wsId}`);
      }
      focusAgent(context, next.wsId, next.agentId);
    },
  };
}

/** The registry, in spec order. `none` is last (explicit unassigned entry). */
export const ACTION_KEY_REGISTRY: readonly ActionKeyDefinition[] = [
  makeGlobalCycleAction({
    id: 'cycle-workspace-agents',
    icon: faArrowsRotate,
    getLabel: () => m.hardwareConsole_actionKey_cycleWorkspaceAgents_label(),
    getEmptyHint: () => m.hardwareConsole_actionKey_noAgents_message(),
    getSingleCandidateHint: () => m.hardwareConsole_actionKey_noOtherAgents_message(),
    collect: (state) => collectCycleAgents(state, isSessionCyclable),
  }),
  makeGlobalCycleAction({
    id: 'cycle-in-progress-agents',
    icon: faPersonRunning,
    getLabel: () => m.hardwareConsole_actionKey_cycleInProgressAgents_label(),
    getEmptyHint: () => m.hardwareConsole_actionKey_noInProgressAgents_message(),
    getSingleCandidateHint: () => m.hardwareConsole_actionKey_noOtherInProgressAgents_message(),
    collect: inProgressAgents,
  }),
  makeGlobalCycleAction({
    id: 'cycle-attention-agents',
    icon: faBell,
    getLabel: () => m.hardwareConsole_actionKey_cycleAttentionAgents_label(),
    getEmptyHint: () => m.hardwareConsole_actionKey_noAttentionAgents_message(),
    getSingleCandidateHint: () => m.hardwareConsole_actionKey_noOtherAttentionAgents_message(),
    collect: (state) =>
      collectCycleAgents(
        state,
        sessionNeedsAttention,
        undefined,
        familyScope(state, 'cycle-attention-agents'),
      ),
  }),
  makeGlobalCycleAction({
    id: 'cycle-idle-agents',
    icon: faMoon,
    getLabel: () => m.hardwareConsole_actionKey_cycleIdleAgents_label(),
    getEmptyHint: () => m.hardwareConsole_actionKey_noIdleAgents_message(),
    getSingleCandidateHint: () => m.hardwareConsole_actionKey_noOtherIdleAgents_message(),
    collect: (state) =>
      collectCycleAgents(state, isSessionIdle, undefined, familyScope(state, 'cycle-idle-agents')),
  }),
  makeGlobalCycleAction({
    id: 'cycle-unread-agents',
    icon: faEnvelope,
    getLabel: () => m.hardwareConsole_actionKey_cycleUnreadAgents_label(),
    getEmptyHint: () => m.hardwareConsole_actionKey_noUnreadAgents_message(),
    getSingleCandidateHint: () => m.hardwareConsole_actionKey_noOtherUnreadAgents_message(),
    getHudLabel: (remaining) =>
      remaining === 0
        ? m.hardwareConsole_actionKey_cycleUnreadAgents_label()
        : remaining === 1
          ? m.hardwareConsole_actionKey_cycleUnreadAgents_hudRemaining_one({ count: remaining })
          : m.hardwareConsole_actionKey_cycleUnreadAgents_hudRemaining_many({ count: remaining }),
    countRemaining: (state, entries, next) => {
      // Stepping to `next` visits its workspace, which clears the whole
      // workspace's unread flag — every unread-only entry of that workspace
      // stops being a candidate along with it. Attention entries persist
      // individually until handled, so they always count as their own stop.
      const { attentionAgentIds } = collectUnreadCycleEntries(state);
      return entries.filter(
        (entry) =>
          entry.agentId !== next.agentId &&
          (attentionAgentIds.has(entry.agentId) || entry.wsId !== next.wsId),
      ).length;
    },
    collect: (state) => collectUnreadCycleEntries(state).entries,
  }),
  makeGlobalCycleAction({
    id: 'cycle-failed-agents',
    icon: faCircleXmark,
    getLabel: () => m.hardwareConsole_actionKey_cycleFailedAgents_label(),
    getEmptyHint: () => m.hardwareConsole_actionKey_noFailedAgents_message(),
    getSingleCandidateHint: () => m.hardwareConsole_actionKey_noOtherFailedAgents_message(),
    collect: (state) =>
      collectCycleAgents(
        state,
        sessionHasFailed,
        undefined,
        familyScope(state, 'cycle-failed-agents'),
      ),
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
      dispatch(setMultiSelectSidebarSelectedTabs(wsId, [order[(currentIndex + 1) % order.length]]));
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
    execute({ state, dispatch }) {
      dispatch(setShowCreateModal(!state.sidebarNav.showCreateModal));
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
    execute({ state }) {
      const wsId = activeWorkspaceId(state);
      if (wsId === null) return;
      const next = ((layoutPresetCursor.get(wsId) ?? -1) + 1) % LAYOUT_PRESETS.length;
      layoutPresetCursor.set(wsId, next);
      const presetId = LAYOUT_PRESETS[next];
      // Dynamic import: panel-layout-adapter/preset-executor transitively pull
      // in selectors that call `store.createSelector` at module scope, which
      // would crash if evaluated eagerly here — this registry is imported by
      // middleware.ts during store construction, before `store` exists. See
      // panel-layout-persistence-service.ts for the same workaround.
      void Promise.all([
        import('$features/layout/panel-layout-adapter'),
        import('$features/layout/preset-executor'),
      ])
        .then(([{ getPanelLayoutManager }, { applyContentPreset }]) =>
          applyContentPreset(presetId, getPanelLayoutManager(wsId), {
            workspaceId: wsId,
            containerWidth: window.innerWidth,
            containerHeight: window.innerHeight,
          }),
        )
        .catch((error: unknown) => {
          logger.error('Failed to apply layout preset', { presetId, wsId, error });
        });
    },
  },
  {
    id: 'push-to-talk',
    get label() {
      return m.hardwareConsole_actionKey_pushToTalk_label();
    },
    icon: faMicrophone,
    isAvailable() {
      return isVoiceRecordingSupported();
    },
    getUnavailableHint() {
      return m.hardwareConsole_ptt_unavailable_message();
    },
    execute(context) {
      // No engine can transcribe ('unavailable': key missing on a host
      // with no OS dictation — Windows/Linux or a helper-missing mac, see
      // effective-voice-engine): surface the actionable setup toast
      // instead of recording audio that could never be transcribed. A
      // capable mac always resolves `os` (even pre-authorization, so the
      // permission prompt can fire) and is never gated here. A live
      // (latched) session is never gated — its stop-tap must always land.
      if (
        !isPttRecordingActive() &&
        resolveEffectiveVoiceEngine(context.state.voiceSettings) === 'unavailable'
      ) {
        showVoiceSetupToast();
        return;
      }
      // Keydown feeds the gesture decoder (hold = PTT, tap = latch, double
      // press = send, double press & hold = PTT + send); recording starts
      // on the first keydown. Permission denial surfaces via the
      // controller's error hint (getUserMedia only fails on first use).
      handleVoiceKeyDown(context);
    },
    executeUp(context) {
      handleVoiceKeyUp(context);
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

/**
 * Per-slot key faces resolved from an action mapping, for the settings
 * device graphic: the assigned action's icon plus its label for the hover
 * tooltip (`none` = blank face, no tooltip). Labels are getters delegating
 * to the registry so they re-evaluate on locale change.
 */
export function actionSlotIcons(
  mapping: readonly ActionKeyActionId[],
): { icon: IconDefinition | null; readonly label: string | null }[] {
  return mapping.map((actionId) => {
    const definition =
      actionId === 'none'
        ? null
        : (ACTION_KEY_REGISTRY.find((entry) => entry.id === actionId) ?? null);
    return {
      icon: definition?.icon ?? null,
      get label() {
        return definition?.label ?? null;
      },
    };
  });
}
