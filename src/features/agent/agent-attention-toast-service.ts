/**
 * Agent-attention toast service — renders one STICKY bottom-left toast per
 * `agent:attention-requested` event (PROTOCOL §6.5), with a "Switch To"
 * action that navigates to the reporting workspace and focuses that agent's
 * conversation tab.
 *
 * Stickiness contract: `duration: Number.POSITIVE_INFINITY` — the toast never
 * auto-dismisses; only the explicit close button or "Switch To" removes it.
 * The toast id is STABLE per agent (`agent-attention:<agentId>`) so a
 * re-raised request updates the existing toast in place instead of stacking.
 *
 * Fires for agents in ANY workspace — the daemon-events bridge feeds every
 * workspace's events through here without gating on the focused workspace.
 * The one exception is the already-viewing suppression: when the window is
 * focused AND the event's workspace is the current workspace tab AND the
 * raising agent's conversation tab is the active tab of a visible panel in
 * that workspace, the toast is skipped — the in-conversation notice (and
 * banner/indicators) are already in view, so the toast would be redundant.
 * Suppression only skips the toast; it never marks the request handled, and
 * the session-field-derived surfaces (banner/badge) are untouched.
 * "Switch To" therefore routes cross-workspace: `goto(/workspace/{wsId})`
 * first, then `openAgentTabRequested` so the already-installed
 * `createAppLayoutNavigationMiddleware` hydrates the session and opens (or
 * focuses) the agent's conversation tab in that workspace's panel layout.
 *
 * Dependency-light per AGENTS.md middleware conventions (this module is
 * reachable from the daemon-events bridge middleware): no static selector
 * imports (selectors are imported lazily at call time only); the toast lib,
 * the Svelte component, and the SvelteKit navigation helper are also
 * imported lazily.
 */
import { store as appStore } from '$store/renderer/store';
import { openAgentTabRequested } from '$store/renderer/slices/app-layout/app-layout-slice';
import { openWorkspaceTab } from '$store/renderer/slices/tab-state/tab-state-slice';
import { createLogger } from '$lib/utils/client-logger';
import { m } from '$shared/paraglide/messages.js';

const logger = createLogger('AgentAttentionToastService');

/** Cap on the attention-request reason length shown in the toast. */
const REASON_MAX_CHARS = 300;

/**
 * Wire payload of `agent:attention-requested` (self-sufficient per PROTOCOL),
 * minus the optional `parentAgentId`: events carrying a non-empty
 * `parentAgentId` (delegated agents — the parent handles the request) are
 * gated out by the daemon-events bridge and never reach this service.
 */
export interface AgentAttentionRequest {
  workspaceId: string;
  agentId: string;
  agentName: string;
  kind: 'discussion' | 'blocker';
  reason: string;
  /** ISO timestamp when the request was raised (event envelope timestamp). */
  timestamp?: string;
}

/** Stable toast id per agent (in-place sonner updates on re-raise). */
export function agentAttentionToastId(agentId: string): string {
  return `agent-attention:${agentId}`;
}

/**
 * Wrapper class for the Sonner toast element — the component is content-only,
 * so the single wrapper border carries the kind-flavored tint.
 */
function wrapperClass(kind: AgentAttentionRequest['kind']): string {
  return kind === 'blocker' ? '!border-danger/50' : '!border-primary/50';
}

/** Lazily pull the toast lib so this middleware-reachable module stays light.
 *  The import promise is cached — concurrent events must not race two
 *  first-time dynamic imports of the same module. */
let toastPromise: Promise<(typeof import('svelte-sonner'))['toast']> | null = null;
function getToast() {
  if (!toastPromise) toastPromise = import('svelte-sonner').then((module) => module.toast);
  return toastPromise;
}

/** Lazily pull the toast component (kept out of the static module graph). */
let toastComponentPromise: Promise<
  (typeof import('$lib/components/ui/toast'))['AgentAttentionToast']
> | null = null;
function getToastComponent() {
  if (!toastComponentPromise) {
    toastComponentPromise = import('$lib/components/ui/toast').then(
      (module) => module.AgentAttentionToast,
    );
  }
  return toastComponentPromise;
}

/**
 * Lazily pull the connected key-slot resolver (imports the store/selectors).
 * The badge is optional: an import or resolution failure degrades to a `null`
 * key slot so the toast still renders (badge-less), and a failed import is
 * not cached so a later call can retry it.
 */
type KeySlotResolver = (workspaceId: string | undefined) => number | null;
let keySlotResolverPromise: Promise<KeySlotResolver> | null = null;
function getKeySlotResolver(): Promise<KeySlotResolver> {
  if (!keySlotResolverPromise) {
    keySlotResolverPromise = import('$features/hardware-console/assignment/connected-key-slot')
      .then((module): KeySlotResolver => {
        return (workspaceId) => {
          try {
            return module.resolveConnectedWorkspaceKeySlot(workspaceId);
          } catch (error) {
            logger.warn('Key-slot resolution failed — toast renders without badge', { error });
            return null;
          }
        };
      })
      .catch((error): KeySlotResolver => {
        keySlotResolverPromise = null;
        logger.warn('Key-slot resolver unavailable — toast renders without badge', { error });
        return () => null;
      });
  }
  return keySlotResolverPromise;
}

function truncate(text: string, maxChars: number): string {
  return text.length > maxChars ? `${text.slice(0, maxChars - 1)}…` : text;
}

/**
 * True when the user is already (likely) looking at the raising agent's
 * conversation: the window is focused, the event's workspace is the current
 * workspace tab, and the agent's conversation tab is the active tab of a
 * visible panel in that workspace.
 *
 * Visibility comes from `panelLayout` — the slice that tab clicks actually
 * update (`setActiveTab` → `panel.activeTabId`); `workspaceAgents.activeAgentId`
 * is NOT synced by tab selection, so it must not be used here. "Viewing" means
 * the agent tab is active in ANY visible panel (not just the focused one): a
 * side-by-side column showing the conversation still puts the in-conversation
 * notice in view. When a panel is expanded (`expandedPanelId`), only that
 * panel is visible, so only it counts.
 *
 * Dependency-light per the module doc: state is read straight off
 * `appStore.state` (no selector imports — `selectCurrentWorkspaceTabId` reads
 * `tabState.currentTabId`, mirrored here; the `focus-first-unread-agent.ts`
 * pattern). Focus parity note (see web-notification-service.ts): Electron
 * keys suppression off the FOCUSED WINDOW viewing the workspace
 * (multi-window); the toast renders in the single renderer window, so this
 * collapses to `document.hasFocus()` + the active workspace/panel tabs.
 */
function isUserViewingAgent(workspaceId: string, agentId: string): boolean {
  if (typeof document === 'undefined' || !document.hasFocus()) return false;
  const state = appStore.state;
  if (state.tabState?.currentTabId !== workspaceId) return false;
  const layout = state.panelLayout?.byWorkspaceId[workspaceId];
  if (!layout) return false;
  const visiblePanels = layout.expandedPanelId
    ? [layout.panels[layout.expandedPanelId]]
    : Object.values(layout.panels);
  return visiblePanels.some((panel) => {
    const activeTab = panel?.tabs.find((tab) => tab.id === panel.activeTabId);
    return activeTab?.type === 'agent' && activeTab.agentId === agentId;
  });
}

/**
 * "Switch To": dismiss the toast, activate the reporting workspace, navigate
 * to it, then open/focus the agent's conversation tab. Explicit tab activation
 * keeps tab state synchronized with route navigation.
 */
export async function switchToAttentionAgent(workspaceId: string, agentId: string): Promise<void> {
  const toast = await getToast();
  toast.dismiss(agentAttentionToastId(agentId));
  appStore.dispatch(openWorkspaceTab(workspaceId));
  try {
    const { navigateToRoute } = await import('$lib/utils/navigation.client');
    await navigateToRoute(`/workspace/${workspaceId}`);
  } catch (error) {
    logger.warn('Switch To navigation failed', { workspaceId, agentId, error });
  }
  appStore.dispatch(openAgentTabRequested(workspaceId, { agentId }));
}

/**
 * Show (or update in place) the sticky attention toast for one agent.
 * Kind-flavored: title, icon, and border tint differ for discussion vs
 * blocker. Never auto-dismisses (`duration: Infinity`).
 *
 * Skipped entirely when the user is already viewing the raising agent's
 * conversation (see {@link isUserViewingAgent}) — the in-conversation notice
 * is in view, so the toast is redundant. The skip does not dismiss an
 * existing toast for the agent and does not mark the request handled.
 */
export async function showAgentAttentionToast(request: AgentAttentionRequest): Promise<void> {
  const { workspaceId, agentId, agentName, kind, reason, timestamp } = request;
  if (isUserViewingAgent(workspaceId, agentId)) {
    logger.debug('User is already viewing the agent — suppressing attention toast', {
      workspaceId,
      agentId,
    });
    return;
  }
  const [toast, AgentAttentionToast, resolveConnectedWorkspaceKeySlot] = await Promise.all([
    getToast(),
    getToastComponent(),
    getKeySlotResolver(),
  ]);
  const title =
    kind === 'blocker'
      ? m.agent_attentionToast_blocker_title({ name: agentName })
      : m.agent_attentionToast_discussion_title({ name: agentName });
  toast.custom(AgentAttentionToast, {
    id: agentAttentionToastId(agentId),
    componentProps: {
      title,
      reason: truncate(reason, REASON_MAX_CHARS),
      kind,
      timestamp,
      keySlot: resolveConnectedWorkspaceKeySlot(workspaceId),
      onSwitchTo: () => void switchToAttentionAgent(workspaceId, agentId),
      onClose: () => void dismissAgentAttentionToast(agentId),
    },
    duration: Number.POSITIVE_INFINITY,
    class: wrapperClass(kind),
  });
}

/** Explicit user dismissal — the only other way the toast goes away. */
export async function dismissAgentAttentionToast(agentId: string): Promise<void> {
  const toast = await getToast();
  toast.dismiss(agentAttentionToastId(agentId));
}

/**
 * Payload for the transient workspace auto-unarchive toast — the daemon's
 * `workspace:updated` unarchive delta carrying the additive `autoUnarchive`
 * stamp (an agent turn start unarchived the workspace).
 */
export interface WorkspaceAutoUnarchiveNotice {
  workspaceId: string;
  agentId: string;
  agentName: string;
}

/**
 * Transient (default-duration) toast for a daemon-initiated auto-unarchive:
 * "<title> was unarchived — <agent> became active", with the same "Switch To"
 * routing as the attention toast. Fires for ANY workspace (no focused-
 * workspace gating), like the attention toast. The workspace title is
 * resolved from the store at toast time and degrades to the generic space
 * fallback when the entity is unknown. No undo/re-archive affordance by
 * design — the toast id is stable per workspace so bursts update in place.
 */
export async function showWorkspaceAutoUnarchiveToast(
  notice: WorkspaceAutoUnarchiveNotice,
): Promise<void> {
  const { workspaceId, agentId, agentName } = notice;
  const toast = await getToast();
  let title: string | undefined;
  try {
    const { selectWorkspaceById } =
      await import('$store/renderer/slices/workspace/workspace-selectors');
    title = selectWorkspaceById.select(appStore.state, workspaceId)?.title;
  } catch (error) {
    logger.warn('Workspace title resolution failed — toast uses fallback', { workspaceId, error });
  }
  toast.info(
    m.workspace_autoUnarchive_toast({
      title: title || m.workspace_page_space_title(),
      name: agentName,
    }),
    {
      id: `workspace-auto-unarchive:${workspaceId}`,
      action: {
        label: m.workspace_autoUnarchive_switchTo_label(),
        onClick: () => void switchToAttentionAgent(workspaceId, agentId),
      },
    },
  );
}
