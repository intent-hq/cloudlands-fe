/**
 * Agent-failure toast service — renders one persistent bottom-left toast per
 * FAILED AGENT from the agent-failure registry, with Retry and Switch To
 * actions. There is deliberately no error grouping and no "Retry All": a
 * grouped mass-retry can accidentally restart agents a coordinator is
 * already recovering.
 *
 * Subscribes to `subscribeToAgentFailures()` and drives `toast.custom(...)`
 * with a STABLE per-agent toast id (`agent-failure:<agentId>`) so the toast
 * updates in place when the same agent re-fails, and auto-dismisses when the
 * agent leaves error state or is deleted. Manual close leaves the registry
 * intact: the entry's `at` is recorded and the toast re-shows only when a
 * NEWER failure lands for that agent.
 *
 * Retry calls `appClient.agents.retry(agentId, workspaceId)` for that one
 * agent; `ok:true` removes the entry from the registry (the daemon's
 * `agent:status-changed` event converges other state — no store dispatches
 * here, mirroring ChatPanel.handleRetry semantics); `ok:false` keeps the
 * entry and surfaces a brief failure note on the toast. The button is
 * disabled while the retry is in flight. The click also navigates to the
 * agent's workspace with its chat drawer open (chief-of-staff failures open
 * the sidebar Assistant panel instead), regardless of the retry RPC outcome.
 * Switch To performs the SAME navigation but never calls `agent.retry`.
 *
 * Installed as a store middleware (`createAgentFailureToastMiddleware`) that
 * subscribes lazily on the first dispatched action — the same pattern as the
 * daemon-events bridge it rides alongside. Dependency-light per AGENTS.md:
 * no selector imports; names resolve via one-time reads off `appStore.state`
 * with graceful fallbacks. The toast lib and the Svelte component are
 * imported lazily (repo convention for non-component modules).
 */
import type { StoreMiddleware } from '$lib/store-shim/types';
import type { AgentSession, Workspace } from '$shared/types';
import { appClient } from '$lib/client';
import { store as appStore } from '$store/renderer/store';
import {
  getAgentFailureEntry,
  listAgentFailureEntries,
  removeAgentFailure,
  subscribeToAgentFailures,
  type AgentFailureEntry,
} from './agent-failure-registry';
import { createLogger } from '$lib/utils/client-logger';
import { m } from '$shared/paraglide/messages.js';

const logger = createLogger('AgentFailureToastService');

/** Cap on the error message length shown in the toast. */
const ERROR_SUMMARY_MAX_CHARS = 200;

/** Per-agent transient toast state (never Redux, gone on reload). */
interface AgentToastState {
  /** True while this agent's toast is currently shown. */
  visible: boolean;
  /** True while this agent's retry request is in flight (button disabled). */
  retrying: boolean;
  /** Brief note when the retry failed; cleared on the next attempt. */
  retryNote?: string;
  /** Entry `at` when the user manually closed the toast; the toast re-shows
   *  only when a NEWER failure lands for this agent. */
  dismissedThroughAt?: number;
}

const stateByAgent = new Map<string, AgentToastState>();

let installed = false;
let unsubscribe: (() => void) | null = null;
/** Monotonic render generation — stale async renders are dropped. */
let renderGeneration = 0;

/** Stable toast id for a failed agent (in-place sonner updates). */
export function agentFailureToastId(agentId: string): string {
  return `agent-failure:${agentId}`;
}

/**
 * Wrapper class for the Sonner toast element — the component is content-only,
 * so the single wrapper border carries the destructive tint.
 */
const WRAPPER_CLASS = '!border-destructive/50';

/** Lazily pull the toast lib so this middleware-reachable module stays light.
 *  The import promise is cached — concurrent registry notifications must not
 *  race two first-time dynamic imports of the same module. */
let toastPromise: Promise<(typeof import('svelte-sonner'))['toast']> | null = null;
function getToast() {
  if (!toastPromise) toastPromise = import('svelte-sonner').then((module) => module.toast);
  return toastPromise;
}

/** Lazily pull the toast component (kept out of the static module graph). */
let toastComponentPromise: Promise<
  (typeof import('$lib/components/ui/toast/AgentFailureToast.svelte'))['default']
> | null = null;
function getToastComponent() {
  if (!toastComponentPromise) {
    toastComponentPromise = import('$lib/components/ui/toast/AgentFailureToast.svelte').then(
      (module) => module.default,
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

/** One-time agent-name read off `appStore.state` (no selector imports). */
function resolveAgentName(agentId: string): string | undefined {
  const state = appStore.state as {
    agentSessions?: { byAgentId?: Record<string, AgentSession> };
  };
  const name = state.agentSessions?.byAgentId?.[agentId]?.name;
  return typeof name === 'string' && name.length > 0 ? name : undefined;
}

/** One-time workspace-name read off `appStore.state` (no selector imports). */
function resolveWorkspaceName(workspaceId: string): string | undefined {
  const state = appStore.state as {
    workspace?: { workspaces?: { map?: Record<string, Workspace> } };
  };
  const workspace = state.workspace?.workspaces?.map?.[workspaceId];
  const name = workspace?.title || workspace?.name;
  return typeof name === 'string' && name.length > 0 ? name : undefined;
}

function truncate(text: string, maxChars: number): string {
  return text.length > maxChars ? `${text.slice(0, maxChars - 1)}…` : text;
}

function buildToastProps(
  entry: AgentFailureEntry,
  state: AgentToastState,
  resolveKeySlot: (workspaceId: string | undefined) => number | null,
) {
  const agentName = resolveAgentName(entry.agentId);
  const workspaceName = resolveWorkspaceName(entry.workspaceId);
  const title = agentName
    ? m.agent_failureToast_agentFailed_title({ name: agentName })
    : m.agent_failureToast_agentFailedUnknown_title();
  const contextLine =
    agentName && workspaceName
      ? m.agent_failureToast_agentWorkspace_label({ agent: agentName, workspace: workspaceName })
      : (workspaceName ?? undefined);

  return {
    title,
    errorSummary: truncate(entry.error, ERROR_SUMMARY_MAX_CHARS),
    contextLine,
    retryLabel: agentName
      ? m.agent_failureToast_retryAgent_label({ name: agentName })
      : m.agent_failureToast_retry_label(),
    retrying: state.retrying,
    retryNote: state.retryNote,
    keySlot: resolveKeySlot(entry.workspaceId),
    onRetry: () => void retryAgent(entry.agentId),
    onSwitchTo: () => void switchToAgent(entry.agentId),
    onClose: () => void closeAgentToast(entry.agentId),
  };
}

/**
 * Render the current registry snapshot: show/update one toast per visible
 * failed agent, dismiss toasts for agents that recovered or were deleted.
 * Serialized per generation — a render started before a newer snapshot
 * arrived is dropped.
 */
async function renderEntries(entries: AgentFailureEntry[]): Promise<void> {
  const generation = ++renderGeneration;
  const [toast, AgentFailureToast, resolveKeySlot] = await Promise.all([
    getToast(),
    getToastComponent(),
    getKeySlotResolver(),
  ]);
  if (generation !== renderGeneration) return;

  const liveAgentIds = new Set(entries.map((entry) => entry.agentId));

  // Dismiss + forget toast state for agents no longer in the registry.
  for (const [agentId, state] of stateByAgent) {
    if (liveAgentIds.has(agentId)) continue;
    if (state.visible) toast.dismiss(agentFailureToastId(agentId));
    stateByAgent.delete(agentId);
  }

  for (const entry of entries) {
    let state = stateByAgent.get(entry.agentId);
    if (!state) {
      state = { visible: false, retrying: false };
      stateByAgent.set(entry.agentId, state);
    }

    // Manually closed: stay hidden unless a NEWER failure landed.
    if (state.dismissedThroughAt !== undefined) {
      if (entry.at <= state.dismissedThroughAt) continue;
      state.dismissedThroughAt = undefined;
    }

    toast.custom(AgentFailureToast, {
      id: agentFailureToastId(entry.agentId),
      componentProps: buildToastProps(entry, state, resolveKeySlot),
      duration: Number.POSITIVE_INFINITY,
      class: WRAPPER_CLASS,
    });
    state.visible = true;
  }
}

/** Re-render one agent's toast in place from the current registry snapshot. */
function rerenderAgent(agentId: string): void {
  const entry = getAgentFailureEntry(agentId);
  if (!entry) return;
  const state = stateByAgent.get(agentId);
  if (!state || !state.visible) return;
  void renderSingleEntry(entry, state);
}

async function renderSingleEntry(entry: AgentFailureEntry, state: AgentToastState): Promise<void> {
  const [toast, AgentFailureToast, resolveKeySlot] = await Promise.all([
    getToast(),
    getToastComponent(),
    getKeySlotResolver(),
  ]);
  toast.custom(AgentFailureToast, {
    id: agentFailureToastId(entry.agentId),
    componentProps: buildToastProps(entry, state, resolveKeySlot),
    duration: Number.POSITIVE_INFINITY,
    class: WRAPPER_CLASS,
  });
}

/**
 * Navigate to a failed agent: route to its workspace, then dispatch
 * `openAgentTabRequested` so `createAppLayoutNavigationMiddleware` hydrates
 * the session and opens/focuses the agent's conversation tab (query params
 * alone are not read back into drawer state on workspace load).
 * Chief-of-staff failures (the hidden chief virtual workspace) open the
 * sidebar Assistant panel and select the chat thread instead — mirrors
 * `handleNotificationNavigate`'s chief branch. Navigation modules are
 * lazy-imported so this middleware-reachable module stays dependency-light.
 * Never rejects; errors are logged.
 */
async function navigateToFailedAgent(entry: AgentFailureEntry): Promise<void> {
  try {
    const { CHIEF_WORKSPACE_ID } = await import('$shared/types/branded-ids');
    if (entry.workspaceId === CHIEF_WORKSPACE_ID) {
      const { openPanel, setChiefActiveAgentId } = await import(
        '$store/renderer/slices/sidebar-nav/sidebar-nav-slice'
      );
      appStore.dispatch(setChiefActiveAgentId(entry.agentId));
      appStore.dispatch(openPanel('chief'));
      return;
    }
    const { navigateToRoute } = await import('$lib/utils/navigation.client');
    await navigateToRoute(`/workspace/${entry.workspaceId}`);
    const { openAgentTabRequested } = await import(
      '$store/renderer/slices/app-layout/app-layout-slice'
    );
    appStore.dispatch(openAgentTabRequested(entry.workspaceId, { agentId: entry.agentId }));
  } catch (error) {
    logger.warn('Failed to navigate to failed agent', {
      agentId: entry.agentId,
      workspaceId: entry.workspaceId,
      error,
    });
  }
}

/**
 * Retry ONE failed agent via `agent.retry`. `ok:true` removes the entry from
 * the registry (its status-changed event reconciles the rest); `ok:false`
 * keeps it and surfaces a brief note on the updated toast. The click also
 * navigates to the agent regardless of the retry RPC outcome (a failed retry
 * still shows its note on the toast).
 */
export async function retryAgent(agentId: string): Promise<void> {
  const entry = getAgentFailureEntry(agentId);
  const state = stateByAgent.get(agentId);
  if (!entry || !state || state.retrying) return;

  state.retrying = true;
  state.retryNote = undefined;
  rerenderAgent(agentId);

  void navigateToFailedAgent(entry);
  // Defensive only: LiveAgentsClient.retry already maps transport errors to
  // `{ ok: false }`, so this catch is a guard against future clients.
  let ok = false;
  try {
    const result = await appClient.agents.retry(entry.agentId, entry.workspaceId);
    ok = result.ok === true;
  } catch (error) {
    logger.error('agent.retry threw', { agentId: entry.agentId, error });
  }

  state.retrying = false;
  if (!ok) state.retryNote = m.agent_failureToast_retryFailed_error();

  // Removing the entry notifies the subscription, which dismisses the toast.
  // Only remove when the registry still holds the entry snapshotted at retry
  // start — if the agent re-failed while its retry was in flight,
  // `recordAgentFailure` stored a fresh entry that this stale ok:true must
  // not erase.
  let removed = false;
  if (ok && getAgentFailureEntry(agentId) === entry) {
    removed = removeAgentFailure(agentId);
  }
  if (!removed) rerenderAgent(agentId);
}

/**
 * Switch To: navigate to the failed agent WITHOUT retrying it — same
 * navigation as Retry (chief branch included), no `agent.retry` call.
 */
export async function switchToAgent(agentId: string): Promise<void> {
  const entry = getAgentFailureEntry(agentId);
  if (!entry) return;
  await navigateToFailedAgent(entry);
}

/**
 * Manual close: hide the toast but leave the registry intact. Records the
 * entry's `at` so only a NEWER failure re-shows the toast.
 */
export async function closeAgentToast(agentId: string): Promise<void> {
  const state = stateByAgent.get(agentId);
  if (!state) return;
  const entry = getAgentFailureEntry(agentId);
  state.dismissedThroughAt = entry ? entry.at : Date.now();
  state.visible = false;
  const toast = await getToast();
  toast.dismiss(agentFailureToastId(agentId));
}

/** Idempotent install: subscribe to the registry and render the snapshot. */
export function installAgentFailureToasts(): void {
  if (installed) return;
  installed = true;
  unsubscribe = subscribeToAgentFailures((entries) => void renderEntries(entries));
  const initial = listAgentFailureEntries();
  if (initial.length > 0) void renderEntries(initial);
}

/**
 * Lazily install on the first dispatched action so the renderer store is
 * fully constructed before we touch `appClient`/`appStore` — the same
 * pattern as `createDaemonEventsBridgeMiddleware`.
 */
export function createAgentFailureToastMiddleware(): StoreMiddleware {
  return () => (next) => (action) => {
    if (!installed) installAgentFailureToasts();
    return next(action);
  };
}

/** Test-only — tear down the subscription and per-agent toast state. */
export function __resetAgentFailureToastsForTests(): void {
  if (unsubscribe) unsubscribe();
  unsubscribe = null;
  installed = false;
  renderGeneration++;
  stateByAgent.clear();
}
