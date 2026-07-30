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
 * "Switch To" therefore routes cross-workspace: `goto(/workspace/{wsId})`
 * first, then `openAgentTabRequested` so the already-installed
 * `createAppLayoutNavigationMiddleware` hydrates the session and opens (or
 * focuses) the agent's conversation tab in that workspace's panel layout.
 *
 * Dependency-light per AGENTS.md middleware conventions (this module is
 * reachable from the daemon-events bridge middleware): no selector imports;
 * the toast lib, the Svelte component, and the SvelteKit navigation helper
 * are imported lazily.
 */
import { store as appStore } from '$store/renderer/store';
import { openAgentTabRequested } from '$store/renderer/slices/app-layout/app-layout-slice';
import { createLogger } from '$lib/utils/client-logger';
import { m } from '$shared/paraglide/messages.js';

const logger = createLogger('AgentAttentionToastService');

/** Cap on the attention-request reason length shown in the toast. */
const REASON_MAX_CHARS = 300;

/** Wire payload of `agent:attention-requested` (self-sufficient per PROTOCOL). */
export interface AgentAttentionRequest {
  workspaceId: string;
  agentId: string;
  agentName: string;
  kind: 'discussion' | 'blocker';
  reason: string;
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
  return kind === 'blocker' ? '!border-destructive/50' : '!border-primary/50';
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
  (typeof import('$lib/components/ui/toast/AgentAttentionToast.svelte'))['default']
> | null = null;
function getToastComponent() {
  if (!toastComponentPromise) {
    toastComponentPromise = import('$lib/components/ui/toast/AgentAttentionToast.svelte').then(
      (module) => module.default,
    );
  }
  return toastComponentPromise;
}

function truncate(text: string, maxChars: number): string {
  return text.length > maxChars ? `${text.slice(0, maxChars - 1)}…` : text;
}

/**
 * "Switch To": dismiss the toast, navigate to the reporting workspace (a
 * cross-workspace `goto`), then open/focus the agent's conversation tab via
 * `openAgentTabRequested` — session hydration and tab dedup stay in the
 * app-layout navigation middleware. The tab dispatch runs even if the goto
 * fails (e.g. already on the page): panel-layout state is per-workspace, so
 * the tab is focused whenever that workspace is (next) shown.
 */
export async function switchToAttentionAgent(workspaceId: string, agentId: string): Promise<void> {
  const toast = await getToast();
  toast.dismiss(agentAttentionToastId(agentId));
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
 */
export async function showAgentAttentionToast(request: AgentAttentionRequest): Promise<void> {
  const [toast, AgentAttentionToast] = await Promise.all([getToast(), getToastComponent()]);
  const { workspaceId, agentId, agentName, kind, reason } = request;
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
