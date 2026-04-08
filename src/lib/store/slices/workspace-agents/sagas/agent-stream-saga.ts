/**
 * Agent Stream Saga
 *
 * Manages stream handler lifecycle via redux-saga, replacing the
 * setTimeout/Map-based tracking that previously lived in AgentService.
 *
 * Responsibilities:
 * - Safety timeout: after reconnect, re-checks backend streams and clears
 *   stale isStreaming flags (replaces startStreamingSafetyTimeout)
 * - Orphan cleanup: removes stream handlers for agents no longer in store
 * - Coordinates with stream-handler-registry.ts for non-serializable runtime state
 */

import { createLogger } from "$lib/utils/client-logger";
import { call, delay, put, select, takeLatest, type SagaGenerator } from "typed-redux-saga";
import { invoke } from "$lib/electron-bridge";
import type { AgentSession } from "$shared/types";
import {
  upsertAgentSession,
  setAgentStreaming,
  triggerStreamingSafetyCheck,
  cleanupOrphanedStreamHandlersRequested,
} from "../workspace-agents-slice";
import {
  selectActiveWorkspaceId,
} from "../../workspace/workspace-selectors";
import {
  selectAllWorkspaceAgents,
} from "../workspace-agents-selectors";
import {
  upsertSession as upsertAgentSessionAction,
} from "../../agent-session/agent-session-slice";
import {
  getStreamHandlerKeys,
  cleanupStreamHandler,
} from "$features/agent/utils/stream-handler-registry";
import { logger as rendererLogger, LogCategory } from "$lib/logging/logger.svelte";

const logger = createLogger("AgentStreamSaga");

// ============================================================================
// 1. Safety timeout — replaces startStreamingSafetyTimeout()
//    Uses saga delay/race instead of setTimeout.
// ============================================================================

function* handleStreamingSafetyCheck(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  action: ReturnType<typeof triggerStreamingSafetyCheck>,
): SagaGenerator<void> {

  // Wait 10 seconds (saga delay replaces setTimeout)
  yield* delay(10_000);

  try {
    // Re-query the backend for currently active streams
    const result: any = yield* call(
      invoke,
      "agent:get-active-streams" as any,
      undefined,
    );
    const currentlyActive = new Set<string>(
      result?.success && result?.data ? result.data.map((s: any) => s.agentId) : [],
    );

    // Check all sessions across workspaces for stale streaming state
    const state: any = yield* select((s: any) => s);
    const allSessions: AgentSession[] = [];
    const agentSessionsByAgent = state.agentSessions?.byAgentId || {};
    for (const wsState of Object.values(state.workspaceAgents?.byWorkspaceId || {})) {
      const ws = wsState as any;
      const agentIds: string[] = ws?.agentIds || [];
      for (const agentId of agentIds) {
        const session = agentSessionsByAgent[agentId] as AgentSession | undefined;
        if (session) allSessions.push(session);
      }
    }

    let clearedCount = 0;
    for (const session of allSessions) {
      if (session.isStreaming && !currentlyActive.has(session.id as string)) {
        logger.info("Safety timeout: force-clearing stale streaming state", {
          agentId: session.id,
          workspaceId: session.workspaceId,
        });

        rendererLogger.warn(LogCategory.AGENT, "Safety timeout fired: clearing stale streaming", {
          agentId: session.id,
          workspaceId: session.workspaceId,
          currentlyActiveStreamsCount: currentlyActive.size,
        });

        const wsId = session.workspaceId ||
          ((yield* select(selectActiveWorkspaceId.select)) as string | undefined);
        if (wsId) {
          yield* put(setAgentStreaming(wsId, session.id as string, false));
          // Clear BOTH isStreaming AND isProcessing to prevent the agent
          // appearing "busy" (spinner) after the safety timeout fires.
          // setAgentStreaming only clears isStreaming; isProcessing is normally
          // cleared by ChatService's streamCompleted action, but the safety
          // timeout bypasses that path.
          const updatedSession = { ...session, isStreaming: false, isProcessing: false };
          yield* put(upsertAgentSessionAction(updatedSession));
          yield* put(upsertAgentSession(wsId, updatedSession));

          if (typeof window !== "undefined") {
            window.dispatchEvent(new CustomEvent(`agent:session-updated:${session.id}`));
          }
          clearedCount++;
        } else {
          logger.warn("Cannot clear streaming state: no workspaceId available", {
            agentId: session.id,
          });
        }
      }
    }

    if (clearedCount > 0) {
      logger.info("Safety timeout: cleared stale streaming states", {
        clearedCount,
        activeStreamCount: currentlyActive.size,
      });
    }
  } catch (error) {
    logger.error("Safety timeout: failed to check streaming states", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

// ============================================================================
// 2. Orphan cleanup — replaces cleanupOrphanedStreamHandlers()
// ============================================================================

function* handleOrphanedStreamHandlerCleanup(): SagaGenerator<void> {
  const wsId = (yield* select(selectActiveWorkspaceId.select)) as string | undefined;
  if (!wsId) {
    logger.debug("No current workspace, skipping orphaned stream handler cleanup");
    return;
  }

  const currentAgents: AgentSession[] = yield* select(selectAllWorkspaceAgents.select, wsId);
  const currentAgentIds = new Set(currentAgents.map(a => a.id as string));
  const orphanedAgentIds: string[] = [];

  for (const agentId of getStreamHandlerKeys()) {
    if (!currentAgentIds.has(agentId)) {
      orphanedAgentIds.push(agentId);
    }
  }

  if (orphanedAgentIds.length > 0) {
    logger.info("Cleaning up orphaned stream handlers", {
      count: orphanedAgentIds.length,
      agentIds: orphanedAgentIds,
    });

    for (const agentId of orphanedAgentIds) {
      yield* call(cleanupStreamHandler, agentId);
    }
  }
}

// ============================================================================
// Root saga
// ============================================================================

export function* agentStreamSaga(): SagaGenerator<void> {
  if (typeof window === "undefined") return;

  // Safety timeout: takeLatest ensures only one runs at a time
  yield* takeLatest(triggerStreamingSafetyCheck, handleStreamingSafetyCheck);

  // Orphan cleanup
  yield* takeLatest(cleanupOrphanedStreamHandlersRequested, handleOrphanedStreamHandlerCleanup);
}

