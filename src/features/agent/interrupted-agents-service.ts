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
 * the modal closes silently (the resolving window already toasted).
 */
import { Logger } from "$shared/logger";
import { onBackendReconnected, electronAPI } from "$lib/client/live/backend-transport";
import type { InterruptedAgent } from "$lib/client/app-client";
import { m } from "$shared/paraglide/messages.js";

const BACKEND = {
  STATUS: "backend:status",
  NOTIFICATION: "backend:notification",
  REQUEST: "backend:request",
  SUBSCRIBE: "backend:subscribe",
  UNSUBSCRIBE: "backend:unsubscribe",
  GET_STATUS: "backend:get-status",
} as const;

/** Resolves arrive in bursts (one agent:updated per resolved agent). */
export const INTERRUPTED_RECONCILE_DEBOUNCE_MS = 400;

const logger = new Logger("InterruptedAgentsService");

/**
 * Handler invoked when interrupted agents should be shown to the user.
 * Call `install()` once at app boot to wire this up.
 */
let onShowInterruptedAgents: ((agents: InterruptedAgent[]) => void) | null = null;

/** Current connection epoch (incremented on each reconnect). */
let connectionEpoch = 0;

/** Set of epochs we've already checked for interrupted agents. */
const checkedEpochs = new Set<number>();

/** Agent ids currently listed by the open modal; null when it is closed. */
let openAgentIds: Set<string> | null = null;

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
  if (openAgentIds === null) clearReconcileTimer();
  onShowInterruptedAgents?.(agents);
}

/**
 * Notify the service the modal closed locally (user dismissed it or resolved
 * the agents in this window). Stops the resolved-elsewhere watcher so a later
 * cross-window resolve cannot re-open a dismissed modal.
 */
export function notifyInterruptedAgentsModalClosed(): void {
  openAgentIds = null;
  clearReconcileTimer();
}

/**
 * Modal resume/abandon handler (`agent.resolveInterrupted`, PROTOCOL §5.35).
 * Stops the cross-window watcher (the modal closed locally), sends the
 * resolve, and toasts per-arm results. Omits empty arrays per the intentd
 * router contract.
 */
export async function resolveInterruptedAgents(
  appClient: any,
  resumeIds: string[],
  abandonIds: string[],
): Promise<void> {
  notifyInterruptedAgentsModalClosed();
  if (resumeIds.length === 0 && abandonIds.length === 0) return;
  const abandonOnly = resumeIds.length === 0;
  try {
    const params: { resume?: string[]; abandon?: string[] } = {};
    if (resumeIds.length > 0) params.resume = resumeIds;
    if (abandonIds.length > 0) params.abandon = abandonIds;

    const result = await appClient.agents.resolveInterrupted(params);
    logger.info("Resolved interrupted agents", { result });
    import("svelte-sonner")
      .then(({ toast }) => {
        const resumed = result.resumed.length;
        const abandoned = result.abandoned.length;
        const failed = result.failed.length;
        if (resumed > 0)
          toast.success(
            resumed === 1
              ? m.layout_appShell_resumedAgents_one({ count: resumed })
              : m.layout_appShell_resumedAgents_many({ count: resumed }),
          );
        if (abandonOnly && abandoned > 0)
          toast.info(
            abandoned === 1
              ? m.layout_appShell_abandonedAgents_one({ count: abandoned })
              : m.layout_appShell_abandonedAgents_many({ count: abandoned }),
          );
        if (failed > 0)
          toast.error(
            failed === 1
              ? m.layout_appShell_resolveFailedCount_one({ count: failed })
              : m.layout_appShell_resolveFailedCount_many({ count: failed }),
          );
      })
      .catch(() => {});
  } catch (error) {
    logger.error("Failed to resolve interrupted agents", { error });
    import("svelte-sonner")
      .then(({ toast }) => {
        toast.error(
          abandonOnly
            ? m.layout_appShell_abandonInterruptedFailed_error()
            : m.layout_appShell_resolveInterruptedFailed_error(),
        );
      })
      .catch(() => {});
  }
}

/**
 * Bridge hook: an `agent:updated` event arrived (daemon-events bridge). When
 * the agent is listed by the open modal, debounce a `agent.listInterrupted`
 * re-query and reconcile. No-ops when the modal is closed or the agent is
 * not listed.
 */
export function notifyInterruptedAgentUpdated(agentId: string): void {
  if (!openAgentIds || !openAgentIds.has(agentId)) return;
  clearReconcileTimer();
  reconcileTimer = setTimeout(() => {
    reconcileTimer = null;
    void reconcileInterruptedAgents();
  }, INTERRUPTED_RECONCILE_DEBOUNCE_MS);
}

/**
 * Re-query `agent.listInterrupted` (resolved rows drop out immediately,
 * PROTOCOL §5.35) and prune the modal to the still-listed survivors. All
 * resolved → publish an empty list, closing the modal silently.
 */
async function reconcileInterruptedAgents(): Promise<void> {
  if (!openAgentIds || !installedAppClient) return;
  try {
    const agents: InterruptedAgent[] = await installedAppClient.agents.listInterrupted();
    if (!openAgentIds) return; // Modal closed while the re-query was in flight.
    const survivors = agents.filter((agent) => openAgentIds!.has(agent.agentId));
    logger.info("Reconciled interrupted agents after cross-window resolve", {
      before: openAgentIds.size,
      after: survivors.length,
    });
    showInterruptedAgents(survivors);
  } catch (error) {
    logger.error("Failed to reconcile interrupted agents", { error });
  }
}

/**
 * Check for interrupted agents and show modal if needed.
 * Deduplicates per-epoch so rapid reconnects don't show the modal twice.
 */
async function checkInterruptedAgents(appClient: any, epoch: number): Promise<void> {
  if (checkedEpochs.has(epoch)) {
    logger.debug("Already checked interrupted agents for epoch", { epoch });
    return;
  }
  checkedEpochs.add(epoch);

  try {
    logger.debug("Checking for interrupted agents", { epoch });
    const agents = await appClient.agents.listInterrupted();
    if (agents.length > 0) {
      logger.info("Found interrupted agents", { count: agents.length, epoch });
      showInterruptedAgents(agents);
    } else if (openAgentIds) {
      // Reconnect-epoch path with the modal open: the fresh (empty) list
      // replaces the stale one — everything was resolved during the outage.
      logger.info("No interrupted agents on re-check; closing stale modal", { epoch });
      showInterruptedAgents([]);
    } else {
      logger.debug("No interrupted agents found", { epoch });
    }
  } catch (error) {
    // -32601 (method not found) is handled by LiveAgentsClient and returns
    // empty array, so any error here is unexpected.
    logger.error("Failed to check interrupted agents", { error, epoch });
  }
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
    logger.warn("No electron API available, interrupted-agents service disabled");
    return () => {};
  }

  // Disposed flag prevents async catch-up from invoking handlers after teardown.
  let disposed = false;

  // Catch-up: check if backend is already connected when we install.
  // The main process may have connected before the renderer mounted this
  // service (typical on app launch), so the initial "connected" event
  // was already broadcast. Query current status and check immediately if needed.
  void (async () => {
    try {
      const statusResult = (await api.invoke(BACKEND.GET_STATUS)) as
        | { status?: string }
        | undefined;
      if (disposed) return;
      if (statusResult?.status === "connected") {
        connectionEpoch += 1;
        const epoch = connectionEpoch;
        logger.debug("Backend already connected on install (catch-up)", { epoch });
        void checkInterruptedAgents(appClient, epoch);
      }
    } catch (error) {
      if (disposed) return;
      logger.warn("Failed to query backend status on install", { error });
    }
  })();

  // Listen for initial connection
  const initialListenerId = api.on(
    BACKEND.STATUS,
    (payload: { status?: string; reconnected?: boolean } | undefined) => {
      if (payload?.status === "connected" && !payload.reconnected) {
        connectionEpoch += 1;
        const epoch = connectionEpoch;
        logger.debug("Backend connected (initial)", { epoch });
        void checkInterruptedAgents(appClient, epoch);
      }
    },
  );

  // Listen for reconnects
  const offReconnect = onBackendReconnected(() => {
    connectionEpoch += 1;
    const epoch = connectionEpoch;
    logger.debug("Backend reconnected", { epoch });
    void checkInterruptedAgents(appClient, epoch);
  });

  logger.info("Interrupted-agents service installed");

  return () => {
    disposed = true;
    api.offById(BACKEND.STATUS, initialListenerId);
    offReconnect();
    onShowInterruptedAgents = null;
    installedAppClient = null;
    openAgentIds = null;
    clearReconcileTimer();
    checkedEpochs.clear();
    logger.info("Interrupted-agents service disposed");
  };
}
