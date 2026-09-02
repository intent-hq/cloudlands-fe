/**
 * Agent-failure toast saga — renders one persistent bottom-left toast per
 * FAILED AGENT from the agent-failure registry, with Retry and Switch To
 * actions. There is deliberately no error grouping and no "Retry All": a
 * grouped mass-retry can accidentally restart agents a coordinator is
 * already recovering.
 *
 * Subscribes to `subscribeToAgentFailures()` through an eventChannel and
 * drives `toast.custom(...)` with a STABLE per-agent toast id
 * (`agent-failure:<agentId>`) so the toast updates in place when the same
 * agent re-fails, and auto-dismisses when the agent leaves error state or is
 * deleted. Manual close leaves the registry intact: the entry's `at` is
 * recorded and the toast re-shows only when a NEWER failure lands for that
 * agent.
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
 */
import { buffers, eventChannel, type EventChannel } from 'redux-saga';
import type { ComponentProps } from 'svelte';
import { call, cancelled, fork, put, take, type SagaGenerator } from 'typed-redux-saga';

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
import { m } from '$shared/paraglide/messages.js';
import { CHIEF_WORKSPACE_ID } from '$shared/types/branded-ids';
import { selectProviderLoadingMap } from '../../agent-availability/agent-availability-selectors';
import { checkSingleProviderRequested } from '../../agent-availability/agent-availability-slice';
import { openAgentTabRequested } from '../../app-layout/app-layout-slice';
import {
  selectProviderAuthFailureGuidance,
  type ProviderAuthFailureGuidance,
} from '../../provider-catalog/provider-catalog-selectors';
import { providerCatalogLoaded } from '../../provider-catalog/provider-catalog-slice';
import { openPanel, setChiefActiveAgentId } from '../../sidebar-nav/sidebar-nav-slice';
import { selectWorkspaceById } from '../../workspace/workspace-selectors';
import { selectAgentSession } from '../agent-session-selectors';

const logger = createLogger('AgentFailureToastSaga');

/** Cap on the error message length shown in the toast. */
const ERROR_SUMMARY_MAX_CHARS = 200;

/**
 * Wrapper class for the Sonner toast element — the component is content-only,
 * so the single wrapper border carries the destructive tint.
 */
const WRAPPER_CLASS = '!border-destructive/50';

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
}

type FailureMessage =
  | { kind: 'snapshot'; entries: AgentFailureEntry[] }
  | { kind: 'retry'; agentId: string }
  | { kind: 'switch-to'; agentId: string }
  | { kind: 'close'; agentId: string };

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
  const [{ toast }, component] = await Promise.all([
    import('svelte-sonner'),
    import('$lib/components/ui/toast/AgentFailureToast.svelte'),
  ]);
  return { toast, AgentFailureToast: component.default };
}

/** Toast component props, derived from the dynamic import to avoid a static import edge. */
type AgentFailureToastProps = ComponentProps<
  Awaited<ReturnType<typeof loadToastArtifacts>>['AgentFailureToast']
>;

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
  componentProps: AgentFailureToastProps;
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
  const componentProps: AgentFailureToastProps = {
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
  const { toast, AgentFailureToast } = yield* call(loadToastArtifacts);
  const { componentProps, authGuidance } = yield* call(buildToastProps, entry, state, emit);
  toast.custom(AgentFailureToast, {
    id: toastId(entry.agentId),
    componentProps,
    duration: Number.POSITIVE_INFINITY,
    class: WRAPPER_CLASS,
  });
  state.visible = true;
  // Auth failure: force a provider auth-status refresh so provider cards /
  // settings flip to "Log in" without waiting for the next poll (the
  // checkSingleProviderRequested worker probes with force: true). One
  // refresh per failure — re-renders of the same entry don't re-probe.
  if (state.authRefreshedAt !== entry.at && authGuidance) {
    state.authRefreshedAt = entry.at;
    // Burst guard: when several agents on the SAME provider fail together,
    // the first dispatch flips the provider's loading flag synchronously,
    // so the rest of the burst skips the put instead of stacking
    // redundant concurrent probes — the in-flight probe's result covers
    // them all.
    const loadingMap = yield* selectProviderLoadingMap.effect();
    if (!loadingMap[authGuidance.providerId]) {
      yield* put(checkSingleProviderRequested(authGuidance.providerId));
    }
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

/**
 * Render a registry snapshot: show/update one toast per visible failed
 * agent, dismiss toasts for agents that recovered or were deleted.
 */
function* renderSnapshot(
  entries: AgentFailureEntry[],
  states: Map<string, AgentToastState>,
  emit: FailureEmitter,
): SagaGenerator<void> {
  const liveAgentIds = new Set(entries.map((entry) => entry.agentId));
  for (const [agentId, state] of states) {
    if (liveAgentIds.has(agentId)) continue;
    if (state.visible) {
      const { toast } = yield* call(loadToastArtifacts);
      toast.dismiss(toastId(agentId));
    }
    states.delete(agentId);
  }
  for (const entry of entries) {
    let state = states.get(entry.agentId);
    if (!state) {
      state = { visible: false, retrying: false };
      states.set(entry.agentId, state);
    }
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
 * failures (the hidden chief virtual workspace) open the sidebar Assistant
 * panel and select the chat thread instead — mirrors
 * `handleNotificationNavigate`'s chief branch. Never throws; errors are
 * logged.
 */
function* navigateToFailedAgent(entry: AgentFailureEntry): SagaGenerator<void> {
  try {
    if (entry.workspaceId === CHIEF_WORKSPACE_ID) {
      yield* put(setChiefActiveAgentId(entry.agentId));
      yield* put(openPanel('chief'));
      return;
    }
    yield* call(navigateToRoute, `/workspace/${entry.workspaceId}`);
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
  const { toast } = yield* call(loadToastArtifacts);
  toast.dismiss(toastId(agentId));
}

export function* agentFailureToastSaga(): SagaGenerator<void> {
  const states = new Map<string, AgentToastState>();
  const { channel, emit } = createFailureChannel();
  try {
    yield* fork(rerenderOnCatalogHydration, emit);
    while (true) {
      const message: FailureMessage = yield* take(channel);
      if (message.kind === 'snapshot') {
        yield* call(renderSnapshot, message.entries, states, emit);
      } else if (message.kind === 'retry') {
        yield* fork(retryAgent, message.agentId, states, emit);
      } else if (message.kind === 'switch-to') {
        yield* fork(switchToAgent, message.agentId);
      } else {
        yield* call(closeAgentToast, message.agentId, states);
      }
    }
  } finally {
    channel.close();
    if (states.size > 0) {
      const { toast } = yield* call(loadToastArtifacts);
      for (const agentId of states.keys()) toast.dismiss(toastId(agentId));
    }
    states.clear();
  }
}
