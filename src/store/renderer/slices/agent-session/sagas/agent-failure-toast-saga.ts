/**
 * Agent-failure toast saga — renders persistent bottom-left toasts from the
 * agent-failure registry.
 *
 * Grouping rule: failed TOP-LEVEL agents that share a failed base provider
 * and a groupable kind — a usage or rate limit (`errorCode:
 * "quota-exceeded"`) or a provider sign-in error — show ONE group toast once
 * 2+ agents share it (`agent-failure-group:<kind>:<base>`), with "Switch all…"
 * (a dialog that moves every member, and its tracked failed workers, to a
 * chosen provider/model and restarts it), "Retry all", and for sign-in
 * groups the login command. Delegated agents never get a toast or a row:
 * their coordinator handles them (monorepo#1991); a bulk switch moves them
 * with the coordinator but never retries them, so a mass action never
 * restarts an agent a coordinator is already recovering. Every other
 * failure — and a group's only member — keeps a per-agent toast.
 *
 * Per-agent toasts use a STABLE id (`agent-failure:<agentId>`) so the toast
 * updates in place when the same agent re-fails, and auto-dismiss when the
 * agent leaves error state or is deleted. Manual close leaves the registry
 * intact: the entry's `at` is recorded and the toast re-shows only when a
 * NEWER failure lands for that agent. A closed group toast re-shows only
 * when a NEW agent joins the group. When a second agent joins, the first
 * agent's per-agent toast is replaced by the group toast; a group that drops
 * to one member reverts to that member's per-agent toast.
 *
 * Retry calls `appClient.agents.retry(agentId, workspaceId)` for that one
 * agent; `ok:true` removes the entry from the registry (the daemon's
 * `agent:status-changed` event converges other state); `ok:false` keeps the
 * entry and surfaces a brief failure note on the toast — unless the daemon
 * rejected with not-found (`notFound: true`, monorepo#2806): the agent was
 * deleted, so the stale entry is removed and the toast dismissed instead of
 * offering Retry forever. The button is
 * disabled while the retry is in flight. The click also navigates to the
 * agent's workspace with its chat drawer open (chief-of-staff failures open
 * the sidebar Assistant panel instead), regardless of the retry RPC outcome.
 * Switch To performs the SAME navigation but never calls `agent.retry`.
 * Per-agent toasts for the current workspace are suppressed; a group toast
 * shows when at least one member is elsewhere. Failures remain tracked and
 * provider auth-status refreshes still run.
 */
import { buffers, eventChannel, type EventChannel } from 'redux-saga';
import {
  call,
  cancelled,
  fork,
  put,
  take,
  takeLeading,
  type SagaGenerator,
} from 'typed-redux-saga';
import type { AgentFailureNotifyProps } from '$lib/components/patterns/notify';

import { groupAgentFailures, type AgentFailureGroup } from '$features/agent/agent-failure-groups';
import {
  getAgentFailureEntry,
  listAgentFailureEntries,
  removeAgentFailure,
  subscribeToAgentFailures,
  type AgentFailureEntry,
} from '$features/agent/agent-failure-registry';
import { appClient } from '$lib/client';
import { createLogger } from '$lib/utils/client-logger';
import { navigateToRoute } from '$lib/utils/navigation.client';
import { showWorkspaceSaga } from '$lib/utils/show-workspace';
import { m } from '$shared/paraglide/messages.js';
import { CHIEF_WORKSPACE_ID } from '$shared/types/branded-ids';
import { selectProviderLoadingMap } from '../../agent-availability/agent-availability-selectors';
import {
  checkSingleProviderRequested,
  providerLoginRequested,
} from '../../agent-availability/agent-availability-slice';
import { openAgentTabRequested } from '../../app-layout/app-layout-slice';
import {
  selectProviderAuthFailureGuidance,
  selectTerminalLoginProviderId,
  type ProviderAuthFailureGuidance,
} from '../../provider-catalog/provider-catalog-selectors';
import { providerCatalogLoaded } from '../../provider-catalog/provider-catalog-slice';
import { openPanel, setChiefActiveAgentId } from '../../sidebar-nav/sidebar-nav-slice';
import { forwardToastWhenHidden } from '$lib/utils/machine-toast-forward';
import { selectIsRailMachineShown } from '../../machine-rail/machine-rail-selectors';
import { selectCurrentWorkspaceTabId } from '../../tab-state/tab-state-selectors';
import { selectWorkspaceById } from '../../workspace/workspace-selectors';
import { selectAgentSession } from '../agent-session-selectors';
import {
  providerSwitchConfirmRequested,
  providerSwitchDialogClosed,
  providerSwitchRetryAllRequested,
} from '../../provider-switch-dialog/provider-switch-dialog-slice';
import {
  closeGroupToastState,
  confirmSwitchDialog,
  currentClassifier,
  dismissGroupToast,
  groupToastId,
  openSwitchDialog,
  renderGroup,
  retryAllFromDialog,
  retryAllFromToast,
  type BulkHold,
  type GroupEmitter,
  type GroupToastState,
} from './agent-failure-group-saga';

const logger = createLogger('AgentFailureToastSaga');

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
  /** Entry `at` of the last auth failure that triggered a forced provider
   *  auth-status refresh — one refresh per failure, not per re-render. */
  authRefreshedAt?: number;
  /** Entry `at` of the last failure rendered, so a hidden machine forwards
   *  each failure once rather than on every re-render. */
  announcedAt?: number;
}

type FailureMessage =
  | { kind: 'snapshot'; entries: AgentFailureEntry[] }
  | { kind: 'retry'; agentId: string }
  | { kind: 'switch-to'; agentId: string }
  | { kind: 'run-login'; providerId: string }
  | { kind: 'close'; agentId: string }
  | { kind: 'switch-all'; groupKey: string }
  | { kind: 'retry-all'; groupKey: string }
  | { kind: 'close-group'; groupKey: string };

type FailureEmitter = (message: FailureMessage) => void;

/** Stable toast id for a failed agent (in-place sonner updates). */
function toastId(agentId: string): string {
  return `agent-failure:${agentId}`;
}

function truncate(text: string): string {
  return text.length > ERROR_SUMMARY_MAX_CHARS
    ? `${text.slice(0, ERROR_SUMMARY_MAX_CHARS - 1)}…`
    : text;
}

async function loadToastArtifacts() {
  const { notify } = await import('$lib/components/patterns/notify');
  return notify;
}

/**
 * Lazily pull the connected key-slot resolver. The badge is optional: an
 * import or resolution failure degrades to a `null` key slot so the toast
 * still renders (badge-less), and a failed import is not cached so a later
 * call can retry it.
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

function createFailureChannel(): {
  channel: EventChannel<FailureMessage>;
  emit: FailureEmitter;
} {
  let emit: FailureEmitter = () => {};
  const channel = eventChannel<FailureMessage>((emitter) => {
    emit = emitter;
    const unsubscribe = subscribeToAgentFailures((entries) => {
      emitter({ kind: 'snapshot', entries });
    });
    emitter({ kind: 'snapshot', entries: listAgentFailureEntries() });
    return unsubscribe;
  }, buffers.expanding());
  return { channel, emit: (message) => emit(message) };
}

function* buildToastProps(
  entry: AgentFailureEntry,
  state: AgentToastState,
  emit: FailureEmitter,
): SagaGenerator<{
  componentProps: AgentFailureNotifyProps;
  authGuidance: ProviderAuthFailureGuidance | null;
}> {
  const session = yield* selectAgentSession.effect(entry.agentId);
  const agentName = session?.name && session.name.length > 0 ? session.name : undefined;
  const workspace = yield* selectWorkspaceById.effect(entry.workspaceId);
  const rawWorkspaceName = workspace?.title || workspace?.name;
  const workspaceName =
    typeof rawWorkspaceName === 'string' && rawWorkspaceName.length > 0
      ? rawWorkspaceName
      : undefined;
  const resolveKeySlot = yield* call(getKeySlotResolver);
  // Provider auth failure (matched against the catalog's authErrorPatterns):
  // the toast carries actionable login guidance alongside the raw error.
  const authGuidance = yield* selectProviderAuthFailureGuidance.effect(
    session?.provider,
    session?.model,
    entry.error,
  );
  const loginProviderId = yield* selectTerminalLoginProviderId.effect(
    session,
    authGuidance?.providerId,
  );
  const componentProps: AgentFailureNotifyProps = {
    title: agentName
      ? m.agent_failureToast_agentFailed_title({ name: agentName })
      : m.agent_failureToast_agentFailedUnknown_title(),
    errorSummary: truncate(entry.error),
    contextLine:
      agentName && workspaceName
        ? m.agent_failureToast_agentWorkspace_label({ agent: agentName, workspace: workspaceName })
        : workspaceName,
    retryLabel: agentName
      ? m.agent_failureToast_retryAgent_label({ name: agentName })
      : m.agent_failureToast_retry_label(),
    retrying: state.retrying,
    retryNote: state.retryNote,
    keySlot: resolveKeySlot(entry.workspaceId),
    loginCommandHint: authGuidance?.loginCommandHint,
    showClaudeDesktopNote: authGuidance?.showClaudeDesktopNote ?? false,
    ...(loginProviderId
      ? { onRunLogin: () => emit({ kind: 'run-login', providerId: loginProviderId }) }
      : {}),
    onRetry: () => emit({ kind: 'retry', agentId: entry.agentId }),
    onSwitchTo: () => emit({ kind: 'switch-to', agentId: entry.agentId }),
    onClose: () => emit({ kind: 'close', agentId: entry.agentId }),
  };
  return { componentProps, authGuidance };
}

function* renderEntry(
  entry: AgentFailureEntry,
  state: AgentToastState,
  emit: FailureEmitter,
): SagaGenerator<void> {
  const notify = yield* call(loadToastArtifacts);
  const { componentProps, authGuidance } = yield* call(buildToastProps, entry, state, emit);
  const currentWorkspaceId = yield* selectCurrentWorkspaceTabId.effect();
  const machineShown = yield* selectIsRailMachineShown.effect();
  const announce = state.announcedAt !== entry.at;
  state.announcedAt = entry.at;
  if (machineShown && currentWorkspaceId === entry.workspaceId) {
    if (state.visible) notify.dismiss(toastId(entry.agentId));
    state.visible = false;
  } else {
    if (announce) forwardToastWhenHidden('error', componentProps.title);
    notify.agentFailure(componentProps, {
      id: toastId(entry.agentId),
      duration: Number.POSITIVE_INFINITY,
    });
    state.visible = true;
  }
  yield* call(refreshAuthOnce, entry, state, authGuidance);
}

/**
 * Auth failure: force a provider auth-status refresh so provider cards /
 * settings flip to "Log in" without waiting for the next poll (the
 * checkSingleProviderRequested worker probes with force: true). One refresh
 * per failure — re-renders of the same entry don't re-probe. Runs for
 * grouped agents too.
 */
function* refreshAuthOnce(
  entry: AgentFailureEntry,
  state: AgentToastState,
  authGuidance: ProviderAuthFailureGuidance | null,
): SagaGenerator<void> {
  if (state.authRefreshedAt === entry.at || !authGuidance) return;
  state.authRefreshedAt = entry.at;
  // Burst guard: when several agents on the SAME provider fail together,
  // the first dispatch flips the provider's loading flag synchronously, so
  // the rest of the burst skips the put instead of stacking redundant
  // concurrent probes — the in-flight probe's result covers them all.
  const loadingMap = yield* selectProviderLoadingMap.effect();
  if (!loadingMap[authGuidance.providerId]) {
    yield* put(checkSingleProviderRequested(authGuidance.providerId));
  }
}

/**
 * Re-render all registry entries once the provider catalog hydrates: a
 * failure that landed BEFORE `providers.catalog` arrived rendered without
 * login guidance (the selector had no rows to match against), and nothing
 * else re-renders an unchanged entry. The snapshot re-render rebuilds the
 * toast props — and runs the auth-refresh block — with the hydrated catalog.
 */
function* rerenderOnCatalogHydration(emit: FailureEmitter): SagaGenerator<void> {
  while (true) {
    yield* take(providerCatalogLoaded);
    emit({ kind: 'snapshot', entries: listAgentFailureEntries() });
  }
}

interface ToastStates {
  agents: Map<string, AgentToastState>;
  groups: Map<string, GroupToastState>;
  /** Latest grouping, for toast and dialog actions. */
  current: Map<string, AgentFailureGroup>;
  /** Members of in-flight bulk runs (see `BulkHold`). */
  held: Map<string, number>;
}

/**
 * Render a registry snapshot: one group toast per group of 2+ agents, one
 * per-agent toast per other failure; dismiss toasts for agents that
 * recovered or were deleted, and per-agent toasts of agents now grouped.
 */
function* renderSnapshot(
  entries: AgentFailureEntry[],
  states: ToastStates,
  emit: FailureEmitter,
  groupEmit: GroupEmitter,
): SagaGenerator<void> {
  const liveAgentIds = new Set(entries.map((entry) => entry.agentId));
  for (const [agentId, state] of states.agents) {
    if (liveAgentIds.has(agentId)) continue;
    if (state.visible) {
      const notify = yield* call(loadToastArtifacts);
      notify.dismiss(toastId(agentId));
    }
    states.agents.delete(agentId);
  }
  const classify = yield* call(currentClassifier);
  const { groups, singles } = groupAgentFailures(entries, classify);
  states.current = new Map(groups.map((group) => [group.key, group]));
  for (const [groupKey, state] of states.groups) {
    if (states.current.has(groupKey)) continue;
    if (state.visible) yield* call(dismissGroupToast, groupKey);
    states.groups.delete(groupKey);
  }
  const agentState = (agentId: string): AgentToastState => {
    let state = states.agents.get(agentId);
    if (!state) {
      state = { visible: false, retrying: false };
      states.agents.set(agentId, state);
    }
    return state;
  };
  for (const group of groups) {
    for (const entry of group.members) {
      const state = agentState(entry.agentId);
      if (state.visible) {
        const notify = yield* call(loadToastArtifacts);
        notify.dismiss(toastId(entry.agentId));
        state.visible = false;
      }
      const session = yield* selectAgentSession.effect(entry.agentId);
      const authGuidance = yield* selectProviderAuthFailureGuidance.effect(
        entry.provider ?? session?.provider,
        entry.model ?? session?.model,
        entry.error,
      );
      yield* call(refreshAuthOnce, entry, state, authGuidance);
    }
    let groupState = states.groups.get(group.key);
    if (!groupState) {
      groupState = { visible: false, retrying: false, announcedMembers: new Set() };
      states.groups.set(group.key, groupState);
    }
    yield* call(renderGroup, group, groupState, groupEmit);
  }
  for (const entry of singles) {
    const state = agentState(entry.agentId);
    if (states.held.has(entry.agentId)) continue;
    // Manually closed: stay hidden unless a NEWER failure landed.
    if (state.dismissedThroughAt !== undefined) {
      if (entry.at <= state.dismissedThroughAt) continue;
      state.dismissedThroughAt = undefined;
    }
    yield* call(renderEntry, entry, state, emit);
  }
}

/**
 * Navigate to a failed agent: route to its workspace, then dispatch
 * `openAgentTabRequested` so the app-layout navigation saga hydrates the
 * session and opens/focuses the agent's conversation tab (query params alone
 * are not read back into drawer state on workspace load). Chief-of-staff
 * failures (the hidden chief virtual workspace) open the homepage Assistant
 * and select the chat thread instead — mirrors
 * `handleNotificationNavigate`'s chief branch. Never throws; errors are
 * logged.
 */
function* navigateToFailedAgent(entry: AgentFailureEntry): SagaGenerator<void> {
  try {
    if (entry.workspaceId === CHIEF_WORKSPACE_ID) {
      yield* put(setChiefActiveAgentId(entry.agentId));
      yield* put(openPanel('chief'));
      yield* call(navigateToRoute, '/');
      return;
    }
    if (!(yield* call(showWorkspaceSaga, entry.workspaceId))) return;
    yield* put(openAgentTabRequested(entry.workspaceId, { agentId: entry.agentId }));
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
 * keeps it and surfaces a brief note on the updated toast — EXCEPT the
 * not-found rejection (`notFound: true`): the agent was deleted while the
 * toast sat open (its `agent:deleted` event was missed), so the stale entry
 * is removed and the toast dismissed instead of keep-and-note (logged at
 * WARN per the #1753 convention — an expected condition, not an error). The
 * click also navigates to the agent regardless of the retry RPC outcome (a
 * failed retry still shows its note on the toast).
 */
function* retryAgent(
  agentId: string,
  states: Map<string, AgentToastState>,
  emit: FailureEmitter,
): SagaGenerator<void> {
  const entry = getAgentFailureEntry(agentId);
  const state = states.get(agentId);
  if (!entry || !state || state.retrying) return;
  state.retrying = true;
  state.retryNote = undefined;
  yield* call(renderEntry, entry, state, emit);
  yield* fork(navigateToFailedAgent, entry);
  try {
    // Defensive only: LiveAgentsClient.retry already maps transport errors
    // to `{ ok: false }`, so this catch is a guard against future clients.
    let ok = false;
    let notFound = false;
    try {
      const result = yield* call(
        [appClient.agents, appClient.agents.retry],
        entry.agentId,
        entry.workspaceId,
      );
      ok = result.ok === true;
      notFound = result.ok === false && result.notFound === true;
    } catch (error) {
      logger.error('agent.retry threw', { agentId: entry.agentId, error });
    }
    state.retrying = false;
    if (notFound) {
      logger.warn('agent.retry target no longer exists — dropping stale failure entry', {
        agentId: entry.agentId,
        workspaceId: entry.workspaceId,
      });
    } else if (!ok) {
      state.retryNote = m.agent_failureToast_retryFailed_error();
    }

    // Removing the entry notifies the subscription, which dismisses the
    // toast. Only remove when the registry still holds the entry snapshotted
    // at retry start — if the agent re-failed while its retry was in flight,
    // `recordAgentFailure` stored a fresh entry that this stale ok:true (or
    // stale notFound) must not erase.
    let removed = false;
    if ((ok || notFound) && getAgentFailureEntry(agentId) === entry) {
      removed = removeAgentFailure(agentId);
    }
    if (!removed) {
      const current = getAgentFailureEntry(agentId);
      if (!current) return;
      // Respect a manual close that happened while the retry was in flight:
      // stay hidden unless a NEWER failure landed (mirrors renderSnapshot).
      if (state.dismissedThroughAt !== undefined) {
        if (current.at <= state.dismissedThroughAt) return;
        state.dismissedThroughAt = undefined;
      }
      yield* call(renderEntry, current, state, emit);
    }
  } finally {
    if (yield* cancelled()) state.retrying = false;
  }
}

/**
 * Switch To: navigate to the failed agent WITHOUT retrying it — same
 * navigation as Retry (chief branch included), no `agent.retry` call.
 */
function* switchToAgent(agentId: string): SagaGenerator<void> {
  const entry = getAgentFailureEntry(agentId);
  if (!entry) return;
  yield* call(navigateToFailedAgent, entry);
}

/**
 * Manual close: hide the toast but leave the registry intact. Records the
 * entry's `at` so only a NEWER failure re-shows the toast.
 */
function* closeAgentToast(
  agentId: string,
  states: Map<string, AgentToastState>,
): SagaGenerator<void> {
  const state = states.get(agentId);
  if (!state) return;
  const entry = getAgentFailureEntry(agentId);
  state.dismissedThroughAt = entry ? entry.at : Date.now();
  state.visible = false;
  const notify = yield* call(loadToastArtifacts);
  notify.dismiss(toastId(agentId));
}

export function* agentFailureToastSaga(): SagaGenerator<void> {
  const states: ToastStates = {
    agents: new Map(),
    groups: new Map(),
    current: new Map(),
    held: new Map(),
  };
  const { channel, emit } = createFailureChannel();
  const groupEmit: GroupEmitter = {
    switchAll: (groupKey) => emit({ kind: 'switch-all', groupKey }),
    retryAll: (groupKey) => emit({ kind: 'retry-all', groupKey }),
    runLogin: (providerId) => emit({ kind: 'run-login', providerId }),
    close: (groupKey) => emit({ kind: 'close-group', groupKey }),
  };
  const rerender = () => emit({ kind: 'snapshot', entries: listAgentFailureEntries() });
  const bulkHold: BulkHold = {
    hold: (agentIds) => {
      for (const id of agentIds) states.held.set(id, (states.held.get(id) ?? 0) + 1);
      rerender();
    },
    release: (agentIds) => {
      for (const id of agentIds) {
        const count = (states.held.get(id) ?? 1) - 1;
        if (count > 0) states.held.set(id, count);
        else states.held.delete(id);
      }
      rerender();
    },
  };
  try {
    yield* fork(rerenderOnCatalogHydration, emit);
    yield* takeLeading(providerSwitchConfirmRequested, confirmSwitchDialog, bulkHold);
    yield* takeLeading(providerSwitchRetryAllRequested, retryAllFromDialog, bulkHold);
    while (true) {
      const message: FailureMessage = yield* take(channel);
      if (message.kind === 'snapshot') {
        // Render the live registry, not the queued snapshot: snapshots queue
        // up while a bulk run settles agents, and a stale one would flash a
        // per-agent toast for an agent that already left.
        yield* call(renderSnapshot, listAgentFailureEntries(), states, emit, groupEmit);
      } else if (message.kind === 'retry') {
        yield* fork(retryAgent, message.agentId, states.agents, emit);
      } else if (message.kind === 'switch-to') {
        yield* fork(switchToAgent, message.agentId);
      } else if (message.kind === 'run-login') {
        yield* put(providerLoginRequested(message.providerId));
      } else if (message.kind === 'close') {
        yield* call(closeAgentToast, message.agentId, states.agents);
      } else if (message.kind === 'switch-all') {
        const group = states.current.get(message.groupKey);
        if (group) yield* fork(openSwitchDialog, group);
      } else if (message.kind === 'retry-all') {
        const group = states.current.get(message.groupKey);
        const state = states.groups.get(message.groupKey);
        if (group && state) yield* fork(retryAllFromToast, group, state, bulkHold);
      } else if (message.kind === 'close-group') {
        const state = states.groups.get(message.groupKey);
        if (state) {
          closeGroupToastState(states.current.get(message.groupKey), state);
          yield* call(dismissGroupToast, message.groupKey);
        }
      }
    }
  } finally {
    channel.close();
    yield* put(providerSwitchDialogClosed());
    if (states.agents.size > 0 || states.groups.size > 0) {
      const notify = yield* call(loadToastArtifacts);
      for (const agentId of states.agents.keys()) notify.dismiss(toastId(agentId));
      for (const groupKey of states.groups.keys()) notify.dismiss(groupToastId(groupKey));
    }
    states.agents.clear();
    states.groups.clear();
  }
}
