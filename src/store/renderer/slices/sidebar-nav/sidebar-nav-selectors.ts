/**
 * Sidebar Nav Selectors
 */

import { store } from '../../store';
import type { StoreState } from '../../types';
import type { AgentSession } from '$shared/types';
import { agentActivityTimestamp } from '../workspace-agents/latest-active-agent';
import { CHIEF_WORKSPACE_ID, type ChiefThreadSummary } from './sidebar-nav-types';
import { getChiefThreadTitle } from './chief-thread-title';
import { CHIEF_PROMPT_VERSION, CHIEF_SPECIALIST_ID } from '$shared/chief-agent-config';
import {
  selectBackgroundHooks,
  selectBackgroundHooksSnapshotStatus,
} from '../background-hooks/background-hooks-selectors';
import {
  selectAgentReviewMonitors,
  selectPrMonitorsSnapshotStatus,
} from '../pr-monitor/pr-monitor-selectors';
import { selectScriptMonitors } from '../script-monitor/script-monitor-selectors';
import {
  selectAgentEventSubscriptions,
  selectAgentSubscriptions,
} from '../agent-subscription-ui/agent-subscription-ui-selectors';
import { selectPrincipalSnapshot } from '../principal/principal-selectors';
import {
  selectWorkspaceById,
  selectWorkspaceItems,
  selectWorkspaceUpdateContext,
} from '../workspace/workspace-selectors';
import { collectCustomWorkspaceLabels, isPinnedWorkspaceLabel } from './workspace-labels';

function getChiefSessions(state: StoreState): AgentSession[] {
  // When workspaceAgents has tracked agents for the Chief workspace, treat that as
  // the source of truth (soft-deletes remove from workspaceAgents but not from
  // agentSessions, so we must intersect to hide pending-deletion threads).
  const workspaceAgentState = state.workspaceAgents?.byWorkspaceId?.[CHIEF_WORKSPACE_ID];
  const trackedIds = workspaceAgentState?.agentIds;
  const trackedIdSet =
    trackedIds && trackedIds.length > 0 ? new Set(trackedIds.map((id) => String(id))) : null;

  const indexedIds = state.agentSessions?.agentIdsByWorkspace?.[CHIEF_WORKSPACE_ID] ?? [];
  const candidates: AgentSession[] =
    indexedIds.length > 0
      ? indexedIds
          .map((id) => state.agentSessions?.byAgentId?.[id])
          .filter((session): session is AgentSession => Boolean(session))
      : Object.values(state.agentSessions?.byAgentId ?? {}).filter(
          (session): session is AgentSession => session.workspaceId === CHIEF_WORKSPACE_ID,
        );

  if (!trackedIdSet) return candidates;
  return candidates.filter((session) => trackedIdSet.has(String(session.id)));
}

function hasCurrentChiefIdentity(session: AgentSession): boolean {
  return (
    session.metadata?.specialist === CHIEF_SPECIALIST_ID &&
    session.metadata?.chiefPromptVersion === CHIEF_PROMPT_VERSION
  );
}

function getChiefSessionMessageCount(session: AgentSession): number {
  return Math.max(session.messages.length, session.messageCount ?? 0);
}

function toChiefThreadSummary(session: AgentSession): ChiefThreadSummary {
  return {
    agentId: session.id,
    title: getChiefThreadTitle(session),
    isActive:
      session.isStreaming === true ||
      session.isProcessing === true ||
      session.isResponding === true,
    messageCount: getChiefSessionMessageCount(session),
  };
}

// ── Direct state selectors ──
export const selectPanelItem = store.createSelector((state) => state.sidebarNav.panelItem);

export const selectOnboardingActive = store.createSelector(
  (state) => state.sidebarNav.onboardingActive,
);

export const selectShowCreateModal = store.createSelector(
  (state) => state.sidebarNav.showCreateModal,
);

/**
 * Whether the connected daemon supports workspace labels (exact-integer
 * `workspaceLabels: 1` capability, PROTOCOL §5.1). Older daemons keep the
 * local-only pins and the UI hides the Label submenu.
 */
export const selectLabelsSupported = store.createSelector(
  (state): boolean => selectPrincipalSnapshot.select(state)?.capabilities.workspaceLabels === 1,
);

/** The label of one workspace, or `null` when it has none. */
export const selectWorkspaceLabel = store.createSelector<[workspaceId: string], string | null>(
  (state, workspaceId) => selectWorkspaceById.select(state, workspaceId)?.label ?? null,
);

/**
 * Distinct custom labels held by any workspace in the store (archived
 * included), A–Z. Derived from the workspaces themselves, so a label
 * disappears once no workspace holds it. Pinned is not included.
 */
export const selectWorkspaceLabelsInUse = store.createSelector((state): string[] =>
  collectCustomWorkspaceLabels(
    selectWorkspaceItems.select(state).map((workspace) => workspace.label),
  ),
);

const LABEL_UPDATE_FIELDS = ['id', 'label'];

/** Whether this client may set or clear the workspace's label (owner-only write). */
export const selectCanSetWorkspaceLabel = store.createSelector<[workspaceId: string], boolean>(
  (state, workspaceId) =>
    selectLabelsSupported.select(state) &&
    selectWorkspaceUpdateContext.select(state, workspaceId, LABEL_UPDATE_FIELDS) !== null,
);

/** Local pin list (`intent:pinned-workspaces`), the source of pins on older daemons. */
export const selectLocalPinnedWorkspaceIds = store.createSelector(
  (state) => state.sidebarNav.pinnedWorkspaceIds,
);

/**
 * Pinned workspace ids: workspaces labelled `"pinned"` when the daemon
 * supports labels, otherwise the local pin list.
 */
export const selectPinnedWorkspaceIds = store.createSelector((state): string[] => {
  if (!selectLabelsSupported.select(state)) return state.sidebarNav.pinnedWorkspaceIds;
  return selectWorkspaceItems
    .select(state)
    .filter((workspace) => isPinnedWorkspaceLabel(workspace.label))
    .map((workspace) => workspace.id as string);
});

export const selectMultiSelectSidebarSelectedTabIds = store.createSelector(
  (state, workspaceId: string): string[] =>
    state.sidebarNav.multiSelectSelectedTabIdsByWorkspaceId[workspaceId] ?? ['overview'],
);

export const selectWorkspaceNoteOrder = store.createSelector(
  (state, workspaceId: string): string[] =>
    state.sidebarNav.noteOrderByWorkspaceId[workspaceId] ?? [],
);

export const selectWorkspaceCollapsedNoteIds = store.createSelector(
  (state, workspaceId: string): string[] =>
    state.sidebarNav.collapsedNoteIdsByWorkspaceId[workspaceId] ?? [],
);

export const selectChiefActiveAgentId = store.createSelector(
  (state): string | null => state.sidebarNav.chiefActiveAgentId,
);

export const selectAssistantThreadActivity = store.createSelector((state, agentId: string) => {
  const session = state.agentSessions.byAgentId[agentId];
  if (session?.workspaceId !== CHIEF_WORKSPACE_ID)
    return { hooks: 0, monitors: 0, subscriptions: 0 };
  const hooks =
    selectBackgroundHooksSnapshotStatus.select(state, CHIEF_WORKSPACE_ID) === 'ready'
      ? selectBackgroundHooks
          .select(state, CHIEF_WORKSPACE_ID)
          .filter(
            (hook) =>
              hook.agentId === agentId && (hook.state === 'scheduled' || hook.state === 'running'),
          ).length
      : (session.waitingOnHooks?.length ?? 0);
  const prs =
    selectPrMonitorsSnapshotStatus.select(state, CHIEF_WORKSPACE_ID) === 'ready'
      ? selectAgentReviewMonitors
          .select(state, CHIEF_WORKSPACE_ID, agentId)
          .filter((monitor) => monitor.state === 'active').length
      : (session.waitingOnPrMonitors?.length ?? 0);
  const scripts = selectScriptMonitors.select(state, CHIEF_WORKSPACE_ID);
  const scriptCount =
    scripts.status === 'unsupported'
      ? 0
      : scripts.status === 'ready'
        ? scripts.monitors.filter(
            (monitor) => monitor.agentId === agentId && monitor.state === 'active',
          ).length
        : (session.waitingOnScriptMonitors?.length ?? 0);
  const watches =
    session.isWaitingForOtherAgents === false
      ? 0
      : (session.waitingForAgentIds?.length ??
        (selectAgentSubscriptions.select(state, CHIEF_WORKSPACE_ID, agentId).length ||
          (session.isWaitingForOtherAgents ? 1 : 0)));
  const events = selectAgentEventSubscriptions
    .select(state, CHIEF_WORKSPACE_ID, agentId)
    .filter((subscription) => subscription.subscriberAgentId === agentId).length;
  return { hooks, monitors: prs + scriptCount, subscriptions: watches + events };
});

export const selectStatsOverlayOpen = store.createSelector(
  (state): boolean => state.sidebarNav.statsOverlayOpen,
);

// ── Derived selectors ──

/** Chief thread history sorted by latest activity. */
export const selectChiefThreads = store.createSelector((state): ChiefThreadSummary[] =>
  getChiefSessions(state)
    .slice()
    .sort((a, b) => agentActivityTimestamp(b) - agentActivityTimestamp(a))
    .map(toChiefThreadSummary),
);

/** Latest Chief thread created with the current runtime identity contract. */
export const selectCurrentChiefThread = store.createSelector((state): ChiefThreadSummary | null => {
  const current = getChiefSessions(state)
    .filter(hasCurrentChiefIdentity)
    .sort((a, b) => agentActivityTimestamp(b) - agentActivityTimestamp(a))[0];

  return current ? toChiefThreadSummary(current) : null;
});

/** Latest blank Chief thread created with the current prompt identity contract. */
export const selectReusableChiefThread = store.createSelector(
  (state): ChiefThreadSummary | null => {
    const reusable = getChiefSessions(state)
      .filter(
        (session) =>
          getChiefSessionMessageCount(session) === 0 &&
          !session.lastMessageId &&
          hasCurrentChiefIdentity(session),
      )
      .sort((a, b) => agentActivityTimestamp(b) - agentActivityTimestamp(a))[0];

    return reusable ? toChiefThreadSummary(reusable) : null;
  },
);
