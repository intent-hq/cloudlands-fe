/**
 * Agent mutation service — the post-saga consumer for the three orphaned
 * agent-session async-action triggers awaited by `agent-stream-lifecycle`:
 * `restoreAgentSessionRequested`, `activateAgentRequested`, and
 * `saveAgentSessionRequested`.
 *
 * These triggers lost their handlers when the saga runtime was removed (they
 * lived in `slices/workspace-agents/sagas/agent-creation-saga.ts` and
 * `agent-session-restore-saga.ts`), so the lifecycle's `await action.promise`
 * sites in `sendMessage()` hung forever and pressing Send produced no user
 * message or stream. This restores the resolve path WITHOUT re-adding a saga
 * and WITHOUT changing any dispatch site: `createAgentMutationMiddleware()`
 * observes dispatched actions and, after the reducer runs, services each
 * trigger by reading/refetching via the `AppClient` seam, persisting the
 * resolved session into Redux, and dispatching the per-dispatch
 * `action.success`/`action.failure` so the action's internal promise settles.
 *
 * Restore: read the existing agent session; if usable (backendSessionId set
 * and not Pending), resolve with it; otherwise `appClient.agents.get(agentId)`
 * and persist the result. Save: a no-op on the mock seam — the agent-session
 * slice IS the runtime state, there is no separate persistence layer to flush
 * — so the action resolves immediately with `undefined`. Activate: mark the
 * session ACTIVATING, refetch via `appClient.agents.get`, then persist as
 * ACTIVE (promoting `status` to Active when a backendSessionId is present);
 * on failure mark ERROR and reject.
 *
 * Dependency-light per src/store AGENTS.md: imports only the AppClient seam,
 * the configured store, the slice actions/types, store-free constants, shared
 * types, and the logger. No selector modules (importing them would evaluate
 * `store.createSelector` during middleware-chain construction); state is read
 * directly off `appStore.state.agentSessions.byAgentId`, mirroring the
 * sibling `agent-stream-service.ts`.
 */
import type { StoreMiddleware } from "@augmentcode/ag-redux-toolkit/types";
import type { AgentSession } from "$shared/types";
import { AgentStatus } from "$shared/types";
import { AgentActivationState } from "$shared/types/agent-session";
import { appClient } from "$lib/client";
import { store as appStore } from "$store/renderer/store";
import {
  bulkUpsertSessions,
  upsertSession,
} from "$store/renderer/slices/agent-session/agent-session-slice";
import {
  activateAgentRequested,
  restoreAgentSessionRequested,
  saveAgentSessionRequested,
} from "$store/renderer/slices/workspace-agents/workspace-agents-slice";
import { createLogger } from "$lib/utils/client-logger";

const logger = createLogger("AgentMutationService");

/** Direct one-time session read, dependency-light (no selector import). */
function readSession(agentId: string): AgentSession | undefined {
  const state = appStore.state as { agentSessions?: { byAgentId: Record<string, AgentSession> } };
  return state.agentSessions?.byAgentId[agentId];
}

/**
 * Persist a session into BOTH stores: `bulkUpsertSessions` populates the
 * agent-session slice (`byAgentId` = session + conversation) — the reducer
 * only consumes the bulk action — and `upsertSession` registers the agent id
 * in the workspace-agents index. Mirrors `agent-read-service` /
 * `agent-creation-service`.
 */
function persistSession(session: AgentSession): void {
  appStore.dispatch(bulkUpsertSessions([session]));
  appStore.dispatch(upsertSession(session));
}

function hasUsableAgentSession(session: AgentSession | undefined | null): session is AgentSession {
  return !!session?.backendSessionId && session.status !== AgentStatus.Pending;
}

function errorMessage(error: unknown, fallback: string): string {
  if (!error) return fallback;
  return error instanceof Error ? error.message : String(error);
}

function toError(error: unknown, fallback: string): Error {
  if (error instanceof Error) return error;
  return new Error(errorMessage(error, fallback));
}

async function handleRestore(
  action: ReturnType<typeof restoreAgentSessionRequested>,
): Promise<void> {
  const [wsId, agentId] = action.payload;
  try {
    const existing = readSession(agentId);
    if (hasUsableAgentSession(existing)) {
      appStore.dispatch(action.success(existing));
      return;
    }
    const fetched = await appClient.agents.get(agentId);
    if (fetched) {
      const wsScoped: AgentSession = {
        ...fetched,
        workspaceId: wsId as AgentSession["workspaceId"],
      };
      persistSession(wsScoped);
      appStore.dispatch(action.success(wsScoped));
      return;
    }
    appStore.dispatch(action.success(existing ?? null));
  } catch (error) {
    logger.error("Failed to restore agent session", error);
    appStore.dispatch(action.failure(toError(error, "Failed to restore agent session")));
  }
}

async function handleActivate(
  action: ReturnType<typeof activateAgentRequested>,
): Promise<void> {
  const [wsId, agentId] = action.payload;
  const existing = readSession(agentId);
  try {
    if (existing?.backendSessionId && existing.status === AgentStatus.Active) {
      appStore.dispatch(action.success(existing));
      return;
    }
    const activationAttempts = (existing?.activationAttempts || 0) + 1;
    if (existing) {
      persistSession({
        ...existing,
        workspaceId: wsId as AgentSession["workspaceId"],
        activationState: AgentActivationState.ACTIVATING,
        activationAttempts,
      });
    }
    const fetched = await appClient.agents.get(agentId);
    const source = fetched ?? existing ?? null;
    if (!source) {
      appStore.dispatch(action.success(null));
      return;
    }
    const activated: AgentSession = {
      ...source,
      workspaceId: wsId as AgentSession["workspaceId"],
      status: source.backendSessionId ? AgentStatus.Active : source.status,
      activationState: AgentActivationState.ACTIVE,
      activationAttempts,
    };
    persistSession(activated);
    appStore.dispatch(action.success(activated));
  } catch (error) {
    logger.error("Failed to activate agent", error);
    const message = errorMessage(error, "Failed to activate agent");
    if (existing) {
      persistSession({
        ...existing,
        workspaceId: wsId as AgentSession["workspaceId"],
        activationState: AgentActivationState.ERROR,
        lastActivationError: message,
      });
    }
    appStore.dispatch(action.failure(toError(error, "Failed to activate agent")));
  }
}

function handleSave(
  action: ReturnType<typeof saveAgentSessionRequested>,
): void {
  // The mock seam has no separate persistence layer — the agent-session slice
  // IS the runtime state. Resolve immediately so callers awaiting
  // `saveAction.promise` (agent-stream-lifecycle pre-send) can proceed.
  appStore.dispatch(action.success(undefined as never));
}

/**
 * Middleware that gives the agent-session mutation triggers real handlers:
 * after each action passes through the (no-op) reducer, it routes the trigger
 * to the matching handler. Errors inside handlers are caught and surfaced via
 * `action.failure` so the dispatch chain itself never throws.
 */
export function createAgentMutationMiddleware(): StoreMiddleware {
  return () => (next) => (action) => {
    const result = next(action);
    if (!action || typeof action !== "object") return result;
    const type = (action as { type?: unknown }).type;
    switch (type) {
      case restoreAgentSessionRequested.type:
        void handleRestore(action as ReturnType<typeof restoreAgentSessionRequested>);
        break;
      case activateAgentRequested.type:
        void handleActivate(action as ReturnType<typeof activateAgentRequested>);
        break;
      case saveAgentSessionRequested.type:
        handleSave(action as ReturnType<typeof saveAgentSessionRequested>);
        break;
    }
    return result;
  };
}
