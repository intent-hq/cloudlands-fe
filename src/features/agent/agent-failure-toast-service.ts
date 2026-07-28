/**
 * Agent-failure toast service — renders one persistent bottom-left toast per
 * failure group from the agent-failure registry, with a Retry All action.
 *
 * Subscribes to `subscribeToAgentFailures()` and drives `toast.custom(...)`
 * with a STABLE per-group toast id (`agent-failure:<groupKey>`) so the toast
 * updates in place as agents join/leave the group, and auto-dismisses when a
 * group empties. Manual close leaves the registry intact: the group's newest
 * `at` is recorded and the toast re-shows only when a NEWER failure lands in
 * the group.
 *
 * Retry All calls `appClient.agents.retry(agentId, workspaceId)` for every
 * entry; `ok:true` removes the entry from the registry (the daemon's
 * `agent:status-changed` event converges other state — no store dispatches
 * here, mirroring ChatPanel.handleRetry semantics); `ok:false` keeps the
 * entry and surfaces a brief failure note on the toast. The button is
 * disabled while retries are in flight.
 *
 * Installed as a store middleware (`createAgentFailureToastMiddleware`) that
 * subscribes lazily on the first dispatched action — the same pattern as the
 * daemon-events bridge it rides alongside. Dependency-light per AGENTS.md:
 * no selector imports; names resolve via one-time reads off `appStore.state`
 * with graceful fallback to counts only. The toast lib and the Svelte
 * component are imported lazily (repo convention for non-component modules).
 */
import type { StoreMiddleware } from '$lib/store-shim/types';
import type { AgentSession, Workspace } from '$shared/types';
import { appClient } from '$lib/client';
import { store as appStore } from '$store/renderer/store';
import {
  getAgentFailureEntry,
  listAgentFailureGroups,
  removeAgentFailure,
  subscribeToAgentFailures,
  type AgentFailureGroup,
} from './agent-failure-registry';
import { createLogger } from '$lib/utils/client-logger';
import { m } from '$shared/paraglide/messages.js';

const logger = createLogger('AgentFailureToastService');

/** Cap on the representative error message length shown in the toast. */
const ERROR_SUMMARY_MAX_CHARS = 200;
/** Max resolved "Agent — Workspace" lines before collapsing to "+N more". */
const MAX_DETAIL_LINES = 5;

/** Per-group transient toast state (never Redux, gone on reload). */
interface GroupToastState {
  /** True while this group's toast is currently shown. */
  visible: boolean;
  /** True while Retry All requests are in flight (button disabled). */
  retrying: boolean;
  /** Brief note when some retries failed; cleared on the next attempt. */
  retryNote?: string;
  /** Newest entry `at` when the user manually closed the toast; the toast
   *  re-shows only when an entry NEWER than this lands in the group. */
  dismissedThroughAt?: number;
}

const stateByGroup = new Map<string, GroupToastState>();

let installed = false;
let unsubscribe: (() => void) | null = null;
/** Monotonic render generation — stale async renders are dropped. */
let renderGeneration = 0;

/** Stable toast id for a failure group (in-place sonner updates). */
export function agentFailureToastId(groupKey: string): string {
  return `agent-failure:${groupKey}`;
}

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

/** Newest failure timestamp in the group (entries are oldest-first). */
function newestAt(group: AgentFailureGroup): number {
  return group.entries[group.entries.length - 1]?.at ?? 0;
}

function buildToastProps(group: AgentFailureGroup, state: GroupToastState) {
  const count = group.entries.length;
  const firstAgentName = resolveAgentName(group.entries[0].agentId);
  const title =
    count === 1
      ? firstAgentName
        ? m.agent_failureToast_agentFailed_title({ name: firstAgentName })
        : m.agent_failureToast_agentsFailed_one()
      : m.agent_failureToast_agentsFailed_many({ count });
  const retryLabel =
    count === 1
      ? firstAgentName
        ? m.agent_failureToast_retryAgent_label({ name: firstAgentName })
        : m.agent_failureToast_retry_label()
      : m.agent_failureToast_retryAll_label({ count });

  // Lines are keyed by agentId — labels can collide (same-named agents in one
  // workspace) and duplicate keys crash Svelte 5 keyed each blocks.
  const detailLines: Array<{ key: string; label: string }> = [];
  for (const entry of group.entries.slice(0, MAX_DETAIL_LINES)) {
    const agentName = resolveAgentName(entry.agentId);
    if (!agentName) continue;
    const workspaceName = resolveWorkspaceName(entry.workspaceId);
    detailLines.push({
      key: entry.agentId,
      label: workspaceName
        ? m.agent_failureToast_agentWorkspace_label({ agent: agentName, workspace: workspaceName })
        : agentName,
    });
  }
  // Unlisted = beyond the cap PLUS skipped-unresolvable entries above.
  const unlistedCount = count - detailLines.length;
  if (detailLines.length > 0 && unlistedCount > 0) {
    detailLines.push({
      key: '__more__',
      label: m.agent_failureToast_moreCount_label({ count: unlistedCount }),
    });
  }

  return {
    title,
    errorSummary: truncate(group.error, ERROR_SUMMARY_MAX_CHARS),
    detailLines,
    retryLabel,
    retrying: state.retrying,
    retryNote: state.retryNote,
    onRetry: () => void retryGroup(group.groupKey),
    onClose: () => void closeGroupToast(group.groupKey),
  };
}

/**
 * Render the current registry snapshot: show/update one toast per visible
 * group, dismiss toasts for groups that emptied. Serialized per generation —
 * a render started before a newer snapshot arrived is dropped.
 */
async function renderGroups(groups: AgentFailureGroup[]): Promise<void> {
  const generation = ++renderGeneration;
  const [toast, AgentFailureToast] = await Promise.all([getToast(), getToastComponent()]);
  if (generation !== renderGeneration) return;

  const liveKeys = new Set(groups.map((group) => group.groupKey));

  // Dismiss + forget toast state for groups that no longer exist.
  for (const [groupKey, state] of stateByGroup) {
    if (liveKeys.has(groupKey)) continue;
    if (state.visible) toast.dismiss(agentFailureToastId(groupKey));
    stateByGroup.delete(groupKey);
  }

  for (const group of groups) {
    let state = stateByGroup.get(group.groupKey);
    if (!state) {
      state = { visible: false, retrying: false };
      stateByGroup.set(group.groupKey, state);
    }

    // Manually closed: stay hidden unless a NEWER failure joined the group.
    if (state.dismissedThroughAt !== undefined) {
      if (newestAt(group) <= state.dismissedThroughAt) continue;
      state.dismissedThroughAt = undefined;
    }

    toast.custom(AgentFailureToast, {
      id: agentFailureToastId(group.groupKey),
      componentProps: buildToastProps(group, state),
      duration: Number.POSITIVE_INFINITY,
    });
    state.visible = true;
  }
}

/** Re-render one group's toast in place from the current registry snapshot. */
function rerenderGroup(groupKey: string): void {
  const groups = listAgentFailureGroups().filter((group) => group.groupKey === groupKey);
  if (groups.length === 0) return;
  const state = stateByGroup.get(groupKey);
  if (!state || !state.visible) return;
  void renderSingleGroup(groups[0], state);
}

async function renderSingleGroup(group: AgentFailureGroup, state: GroupToastState): Promise<void> {
  const [toast, AgentFailureToast] = await Promise.all([getToast(), getToastComponent()]);
  toast.custom(AgentFailureToast, {
    id: agentFailureToastId(group.groupKey),
    componentProps: buildToastProps(group, state),
    duration: Number.POSITIVE_INFINITY,
  });
}

/**
 * Retry every failed agent in the group via `agent.retry`. `ok:true` removes
 * the entry from the registry (its status-changed event reconciles the rest);
 * `ok:false` keeps it and surfaces a brief note on the updated toast.
 */
export async function retryGroup(groupKey: string): Promise<void> {
  const group = listAgentFailureGroups().find((candidate) => candidate.groupKey === groupKey);
  const state = stateByGroup.get(groupKey);
  if (!group || !state || state.retrying) return;

  state.retrying = true;
  state.retryNote = undefined;
  rerenderGroup(groupKey);

  const entries = [...group.entries];
  const results = await Promise.all(
    entries.map(async (entry) => {
      // Defensive only: LiveAgentsClient.retry already maps transport errors
      // to `{ ok: false }`, so this catch is a guard against future clients.
      try {
        const result = await appClient.agents.retry(entry.agentId, entry.workspaceId);
        return { entry, ok: result.ok === true };
      } catch (error) {
        logger.error('agent.retry threw', { agentId: entry.agentId, error });
        return { entry, ok: false };
      }
    }),
  );

  state.retrying = false;
  const failedCount = results.filter((result) => !result.ok).length;
  if (failedCount > 0) {
    state.retryNote =
      failedCount === 1
        ? m.agent_failureToast_retryFailed_one()
        : m.agent_failureToast_retryFailed_many({ count: failedCount });
  }

  // Removing entries notifies the subscription, which re-renders (or
  // dismisses) the toast with the surviving entries + retryNote. Only remove
  // when the registry still holds the entry snapshotted at retry start — if
  // the agent re-failed while its retry was in flight, `recordAgentFailure`
  // stored a fresh entry that this stale ok:true must not erase.
  let removedAny = false;
  for (const result of results) {
    if (!result.ok) continue;
    if (getAgentFailureEntry(result.entry.agentId) !== result.entry) continue;
    removedAny = removeAgentFailure(result.entry.agentId) || removedAny;
  }
  if (!removedAny) rerenderGroup(groupKey);
}

/**
 * Manual close: hide the toast but leave the registry intact. Records the
 * group's newest `at` so only a NEWER failure re-shows the toast.
 */
export async function closeGroupToast(groupKey: string): Promise<void> {
  const state = stateByGroup.get(groupKey);
  if (!state) return;
  const group = listAgentFailureGroups().find((candidate) => candidate.groupKey === groupKey);
  state.dismissedThroughAt = group ? newestAt(group) : Date.now();
  state.visible = false;
  const toast = await getToast();
  toast.dismiss(agentFailureToastId(groupKey));
}

/** Idempotent install: subscribe to the registry and render the snapshot. */
export function installAgentFailureToasts(): void {
  if (installed) return;
  installed = true;
  unsubscribe = subscribeToAgentFailures((groups) => void renderGroups(groups));
  const initial = listAgentFailureGroups();
  if (initial.length > 0) void renderGroups(initial);
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

/** Test-only — tear down the subscription and per-group toast state. */
export function __resetAgentFailureToastsForTests(): void {
  if (unsubscribe) unsubscribe();
  unsubscribe = null;
  installed = false;
  renderGeneration++;
  stateByGroup.clear();
}
