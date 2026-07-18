/**
 * Service for handling interrupted agents on connect/reconnect.
 *
 * Calls agent.listInterrupted when the backend connects or reconnects, and
 * shows the InterruptedAgentsModal if any agents need to be resolved. Guards
 * against double-showing on rapid reconnects using a per-epoch deduplication.
 */
import { Logger } from "$shared/logger";
import { onBackendReconnected, electronAPI } from "$lib/client/live/backend-transport";
import type { InterruptedAgent } from "$lib/client/app-client";

const BACKEND = {
  STATUS: "backend:status",
  NOTIFICATION: "backend:notification",
  REQUEST: "backend:request",
  SUBSCRIBE: "backend:subscribe",
  UNSUBSCRIBE: "backend:unsubscribe",
  GET_STATUS: "backend:get-status",
} as const;

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
      onShowInterruptedAgents?.(agents);
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
    checkedEpochs.clear();
    logger.info("Interrupted-agents service disposed");
  };
}
