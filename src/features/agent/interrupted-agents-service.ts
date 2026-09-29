/**
 * Service for handling interrupted agents on connect/reconnect.
 *
 * Calls agent.listInterrupted when the backend connects or reconnects, and
 * shows the InterruptedAgentsModal if any agents need to be resolved. Guards
 * against double-showing on rapid reconnects using a per-epoch deduplication.
 *
 * Cross-window reconciliation: while the modal is open, `agent:updated`
 * events for listed agents (forwarded by the daemon-events bridge —
 * `agent.resolveInterrupted` emits one per resolved agent on both arms,
 * PROTOCOL §5.35) debounce a re-query of `agent.listInterrupted`. Rows
 * resolved by another window/client are pruned; when everything is resolved
 * the modal closes silently (the resolving window already toasted). A startup
 * recovery failure hint also discovers newly retryable rows after reservation release.
 */
import { Logger } from '$shared/logger';
import { onBackendReconnected, electronAPI } from '$lib/client/live/backend-transport';
import type { InterruptedAgent, ResolveInterruptedResult } from '$lib/client/app-client';
import { m } from '$shared/paraglide/messages.js';

const BACKEND = {
  STATUS: 'backend:status',
  NOTIFICATION: 'backend:notification',
  REQUEST: 'backend:request',
  SUBSCRIBE: 'backend:subscribe',
  UNSUBSCRIBE: 'backend:unsubscribe',
  GET_STATUS: 'backend:get-status',
} as const;

/** Resolves arrive in bursts (one agent:updated per resolved agent). */
export const INTERRUPTED_RECONCILE_DEBOUNCE_MS = 400;

const logger = new Logger('InterruptedAgentsService');

/**
 * Handler invoked when interrupted agents should be shown to the user.
 * Call `install()` once at app boot to wire this up.
 */
let onShowInterruptedAgents: ((agents: InterruptedAgent[]) => void) | null = null;

/** Current connection epoch (incremented on each reconnect). */
let connectionEpoch = 0;

/** Agent ids currently listed by the open modal; null when it is closed. */
let openAgentIds: Set<string> | null = null;

/** Failure hints awaiting an authoritative read; ordinary updates never add ids. */
const discoveryAgentIds = new Map<string, number>();
let failureHintVersion = 0;
/** Locally dismissed/resolved ids stay hidden until the next connection. */
const dismissedAgentIds = new Set<string>();
/** Invalidates reads on a newer request, dismissal, disconnect, or disposal. */
let requestVersion = 0;
let initialCheckPending = false;
let connected = false;
let reconcileInFlight = false;
let reconcileAgain = false;

/** Debounce timer for the resolved-elsewhere reconciliation re-query. */
let reconcileTimer: ReturnType<typeof setTimeout> | null = null;

/** AppClient captured at install for the reconciliation re-query. */
let installedAppClient: any = null;

function clearReconcileTimer(): void {
  if (reconcileTimer) {
    clearTimeout(reconcileTimer);
    reconcileTimer = null;
  }
}

/**
 * Publish a (possibly empty) interrupted list to the modal and track the
 * open set. An empty list closes the modal silently — the layout's
 * `{#if agents.length > 0}` gate hides it without a toast.
 */
function showInterruptedAgents(agents: InterruptedAgent[]): void {
  openAgentIds = agents.length > 0 ? new Set(agents.map((agent) => agent.agentId)) : null;
  if (openAgentIds === null && discoveryAgentIds.size === 0) clearReconcileTimer();
  onShowInterruptedAgents?.(agents);
}

/**
 * Notify the service the modal closed locally (user dismissed it or resolved
 * the agents in this window). Stops the resolved-elsewhere watcher so a later
 * cross-window resolve cannot re-open a dismissed modal.
 */
export function notifyInterruptedAgentsModalClosed(): void {
  for (const id of [...(openAgentIds ?? []), ...discoveryAgentIds.keys()])
    dismissedAgentIds.add(id);
  discoveryAgentIds.clear();
  reconcileAgain = false;
  requestVersion += 1;
  openAgentIds = null;
  clearReconcileTimer();
}

/**
 * Modal resume/abandon handler (`agent.resolveInterrupted`, PROTOCOL §5.35).
 * Resolves only the explicit IDs. Keep watching unresolved agents while the
 * dialog remains open; callers display per-agent failures and can retry.
 */
export async function resolveInterruptedAgents(
  appClient: any,
  resumeIds: string[],
  abandonIds: string[],
): Promise<ResolveInterruptedResult> {
  if (resumeIds.length === 0 && abandonIds.length === 0)
    return { resumed: [], abandoned: [], failed: [] };
  const abandonOnly = resumeIds.length === 0;
  try {
    const params: { resume?: string[]; abandon?: string[] } = {};
    if (resumeIds.length > 0) params.resume = resumeIds;
    if (abandonIds.length > 0) params.abandon = abandonIds;

    const result: ResolveInterruptedResult = await appClient.agents.resolveInterrupted(params);
    for (const id of [...result.resumed, ...result.abandoned]) {
      dismissedAgentIds.add(id);
      discoveryAgentIds.delete(id);
      openAgentIds?.delete(id);
    }
    if (openAgentIds?.size === 0) {
      openAgentIds = null;
      if (discoveryAgentIds.size === 0) clearReconcileTimer();
    }
    logger.info('Resolved interrupted agents', { result });
    import('$lib/components/patterns/notify')
      .then(({ notify }) => {
        const resumed = result.resumed.length;
        const abandoned = result.abandoned.length;
        const failed = result.failed.length;
        if (resumed > 0)
          notify.success(
            resumed === 1
              ? m.layout_appShell_resumedAgents_one({ count: resumed })
              : m.layout_appShell_resumedAgents_many({ count: resumed }),
          );
        if (abandonOnly && abandoned > 0)
          notify.info(
            abandoned === 1
              ? m.layout_appShell_abandonedAgents_one({ count: abandoned })
              : m.layout_appShell_abandonedAgents_many({ count: abandoned }),
          );
        if (failed > 0)
          notify.error(
            failed === 1
              ? m.layout_appShell_resolveFailedCount_one({ count: failed })
              : m.layout_appShell_resolveFailedCount_many({ count: failed }),
          );
      })
      .catch(() => {});
    return result;
  } catch (error) {
    logger.error('Failed to resolve interrupted agents', { error });
    import('$lib/components/patterns/notify')
      .then(({ notify }) => {
        notify.error(
          abandonOnly
            ? m.layout_appShell_abandonInterruptedFailed_error()
            : m.layout_appShell_resolveInterruptedFailed_error(),
        );
      })
      .catch(() => {});
    throw error;
  }
}

/**
 * Ordinary updates reconcile only listed agents. A startup failure hint may
 * discover that agent, but listInterrupted remains authoritative if another
 * client already resolved it. Dismissed agents stay hidden for this connection.
 */
export function notifyInterruptedAgentUpdated(
  agentId: string,
  startupRecoveryFailed = false,
): void {
  if (!connected || !installedAppClient) return;
  if (startupRecoveryFailed && !dismissedAgentIds.has(agentId))
    discoveryAgentIds.set(agentId, ++failureHintVersion);
  else if (!openAgentIds?.has(agentId)) return;
  clearReconcileTimer();
  reconcileTimer = setTimeout(() => {
    reconcileTimer = null;
    void reconcileInterruptedAgents();
  }, INTERRUPTED_RECONCILE_DEBOUNCE_MS);
}

/**
 * The global event subscription is live. Catch up failures from its connection
 * gap, without clearing local dismissals or starting an overlapping read.
 */
export function notifyInterruptedAgentsSubscriptionReady(): void {
  if (!connected || !installedAppClient) return;
  initialCheckPending = true;
  clearReconcileTimer();
  void reconcileInterruptedAgents();
}

/** Reconcile survivors and explicitly announced failures, never unrelated rows. */
async function reconcileInterruptedAgents(): Promise<void> {
  if (!installedAppClient || !connected) return;
  if (!initialCheckPending && !openAgentIds && discoveryAgentIds.size === 0) return;
  const version = ++requestVersion;
  if (reconcileInFlight) {
    reconcileAgain = true;
    return;
  }
  reconcileInFlight = true;
  const discover = new Map(discoveryAgentIds);
  const initial = initialCheckPending;
  try {
    const agents: InterruptedAgent[] = await installedAppClient.agents.listInterrupted();
    if (version !== requestVersion) return;
    initialCheckPending = false;
    for (const [id, hintVersion] of discover) {
      if (discoveryAgentIds.get(id) === hintVersion) discoveryAgentIds.delete(id);
    }
    const survivors = agents.filter(
      (agent) =>
        !dismissedAgentIds.has(agent.agentId) &&
        (initial || openAgentIds?.has(agent.agentId) || discover.has(agent.agentId)),
    );
    if (survivors.length > 0 || openAgentIds) showInterruptedAgents(survivors);
  } catch (error) {
    logger.error('Failed to reconcile interrupted agents', { error });
  } finally {
    reconcileInFlight = false;
    if (reconcileAgain) {
      reconcileAgain = false;
      clearReconcileTimer();
      void reconcileInterruptedAgents();
    }
  }
}

/** Begin a fresh connection check, invalidating reads from the previous epoch. */
function checkInterruptedAgents(): void {
  connectionEpoch += 1;
  requestVersion += 1;
  connected = true;
  initialCheckPending = true;
  discoveryAgentIds.clear();
  dismissedAgentIds.clear();
  clearReconcileTimer();
  void reconcileInterruptedAgents();
}

/**
 * Install the interrupted-agents service. Call once at app boot.
 *
 * @param appClient - The live AppClient instance
 * @param showHandler - Callback to show the modal with interrupted agents
 * @returns Disposer function
 */
export function installInterruptedAgentsService(
  appClient: any,
  showHandler: (agents: InterruptedAgent[]) => void,
): () => void {
  onShowInterruptedAgents = showHandler;
  installedAppClient = appClient;

  const api = electronAPI();
  if (!api) {
    logger.warn('No electron API available, interrupted-agents service disabled');
    return () => {};
  }

  // Disposed flag prevents async catch-up from invoking handlers after teardown.
  let disposed = false;

  const installEpoch = connectionEpoch;

  // Catch-up: check if backend is already connected when we install.
  // The main process may have connected before the renderer mounted this
  // service (typical on app launch), so the initial "connected" event
  // was already broadcast. Query current status and check immediately if needed.
  void (async () => {
    try {
      const statusResult = (await api.invoke(BACKEND.GET_STATUS)) as
        { status?: string } | undefined;
      if (disposed || connectionEpoch !== installEpoch) return;
      if (statusResult?.status === 'connected') checkInterruptedAgents();
    } catch (error) {
      if (disposed) return;
      logger.warn('Failed to query backend status on install', { error });
    }
  })();

  // Listen for initial connection
  const initialListenerId = api.on(
    BACKEND.STATUS,
    (payload: { status?: string; reconnected?: boolean } | undefined) => {
      if (payload?.status === 'connected' && !payload.reconnected) checkInterruptedAgents();
      else if (payload?.status && payload.status !== 'connected') {
        connected = false;
        reconcileAgain = false;
        connectionEpoch += 1;
        requestVersion += 1;
        clearReconcileTimer();
      }
    },
  );

  // Listen for reconnects
  const offReconnect = onBackendReconnected(checkInterruptedAgents);

  logger.info('Interrupted-agents service installed');

  return () => {
    disposed = true;
    api.offById(BACKEND.STATUS, initialListenerId);
    offReconnect();
    onShowInterruptedAgents = null;
    installedAppClient = null;
    openAgentIds = null;
    clearReconcileTimer();
    connected = false;
    reconcileAgain = false;
    requestVersion += 1;
    discoveryAgentIds.clear();
    dismissedAgentIds.clear();
    logger.info('Interrupted-agents service disposed');
  };
}
