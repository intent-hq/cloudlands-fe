/**
 * Workspace Lifecycle Events Saga
 *
 * Broadcast + listener sagas for workspace lifecycle domain events.
 */

import {
  call,
  put,
  takeEvery,
} from "typed-redux-saga";
import type { StoreAction } from "ag-redux-toolkit/types";
import type { DomainEvent } from "../../../../../features/events/types";
import {
  broadcastDomainEvent,
  broadcastDomainEventToStdio,
} from "../../../utils/domain-event-broadcast";
import {
  workspaceDeleting,
  workspaceDeleted,
  workspaceArchived,
  WORKSPACE_LIFECYCLE_EVENT_TYPES,
  WORKSPACE_LIFECYCLE_GLOBAL_BROADCAST_EVENTS,
  WORKSPACE_LIFECYCLE_EVENT_ACTION_MAP,
} from "../workspace-lifecycle-events-slice";

// ---------------------------------------------------------------------------
// Reverse map: action type → IPC channel
// ---------------------------------------------------------------------------



const ACTION_TYPE_TO_IPC: Record<string, DomainEvent> = {};
for (const [domainEvent, entry] of Object.entries(WORKSPACE_LIFECYCLE_EVENT_ACTION_MAP)) {
  if (entry) ACTION_TYPE_TO_IPC[entry.actionCreator.type] = domainEvent as DomainEvent;
}

// ---------------------------------------------------------------------------
// Broadcast handler
// ---------------------------------------------------------------------------

function* handleBroadcast(action: StoreAction<[unknown]>) {
  const ipcChannel = ACTION_TYPE_TO_IPC[action.type];
  if (!ipcChannel) return;

  const [data] = action.payload;
  const isGlobal = WORKSPACE_LIFECYCLE_GLOBAL_BROADCAST_EVENTS.has(action.type);

  yield* call(broadcastDomainEvent, ipcChannel, data, isGlobal);
  yield* call(broadcastDomainEventToStdio, ipcChannel, data);
}

// ---------------------------------------------------------------------------
// Listener: workspace deleting → agent cleanup
// ---------------------------------------------------------------------------

function* handleWorkspaceDeletingForAgents(
  action: ReturnType<typeof workspaceDeleting>,
) {
  const [data] = action.payload;
  const { workspaceId } = data;

  yield* call(async () => {
    const { Logger } = await import("../../../../../shared/logger");
    const logger = new Logger("WorkspaceLifecycleEventsSaga");

    logger.info("Workspace deleting - cleaning up agents (saga)", { workspaceId });

    try {
      const { agentBackendHandler } = await import(
        "../../../../../features/agent/main/agent-backend-handler.service"
      );
      const providersStopped =
        await agentBackendHandler.stopProvidersForWorkspace(workspaceId);

      const { ConsolidatedBackendService } = await import(
        "../../../../../features/agent/main/consolidated-backend.service"
      );
      const consolidatedBackend = ConsolidatedBackendService.getInstance();
      const sessions = await consolidatedBackend.listAgents(workspaceId);

      if (sessions.length > 0) {
        for (const session of sessions) {
          try {
            await consolidatedBackend.backendStop({
              agentId: session.id.toString(),
              killProcess: true,
              _stopTrigger: "workspace_deletion",
              _stopReason: "workspace:deleting event",
            });
          } catch (error) {
            logger.warn("Failed to kill agent during workspace deletion", {
              agentId: session.id,
              workspaceId,
              error,
            });
          }
        }
      }

      agentBackendHandler.invalidatePersistenceListCache(workspaceId);
      const { unifiedPersistence } = await import(
        "../../../../../features/agent/main/agent-persistence"
      );
      unifiedPersistence.invalidateLoadCachesForWorkspace(workspaceId);

      logger.info("Completed agent cleanup for deleted workspace (saga)", {
        workspaceId,
        providersStopped,
        sessionsStopped: sessions.length,
      });
    } catch (error) {
      const { Logger: L } = await import("../../../../../shared/logger");
      new L("WorkspaceLifecycleEventsSaga").error(
        "Failed to cleanup agents for deleted workspace",
        { workspaceId, error },
      );
    }
  });
}


// ---------------------------------------------------------------------------
// Listener: workspace archived → agent cleanup
// ---------------------------------------------------------------------------

function* handleWorkspaceArchivedForAgents(
  action: ReturnType<typeof workspaceArchived>,
) {
  const [data] = action.payload;
  const { workspaceId } = data;

  yield* call(async () => {
    const { Logger } = await import("../../../../../shared/logger");
    const logger = new Logger("WorkspaceLifecycleEventsSaga");

    logger.info("Workspace archived - cleaning up agents (saga)", { workspaceId });

    try {
      const { agentBackendHandler } = await import(
        "../../../../../features/agent/main/agent-backend-handler.service"
      );
      const providersStopped =
        await agentBackendHandler.stopProvidersForWorkspace(workspaceId);

      const { ConsolidatedBackendService } = await import(
        "../../../../../features/agent/main/consolidated-backend.service"
      );
      const consolidatedBackend = ConsolidatedBackendService.getInstance();
      const sessions = await consolidatedBackend.listAgents(workspaceId);

      if (sessions.length === 0 && providersStopped === 0) {
        logger.info("No agents to cleanup for archived workspace", { workspaceId });
        return;
      }

      if (sessions.length > 0) {
        for (const session of sessions) {
          try {
            await consolidatedBackend.backendStop({
              agentId: session.id.toString(),
              killProcess: true,
              _stopTrigger: "workspace_archival",
              _stopReason: "workspace:archived event",
            });
          } catch (error) {
            logger.warn("Failed to kill agent during workspace archiving", {
              agentId: session.id,
              workspaceId,
              error,
            });
          }
        }
      }

      logger.info("Completed agent cleanup for archived workspace (saga)", {
        workspaceId,
        providersStopped,
        sessionsStopped: sessions.length,
      });
    } catch (error) {
      const { Logger: L } = await import("../../../../../shared/logger");
      new L("WorkspaceLifecycleEventsSaga").error(
        "Failed to cleanup agents for archived workspace",
        { workspaceId, error },
      );
    }
  });
}

// ---------------------------------------------------------------------------
// Listener: workspace deleting/deleted/updated → MCP server cache cleanup
// ---------------------------------------------------------------------------

function* handleWorkspaceDeletingForMcp(
  action: ReturnType<typeof workspaceDeleting>,
) {
  const [data] = action.payload;
  yield* call(async () => {
    const { getHttpMcpBridge } = await import("../../../../../main/http-mcp-bridge");
    const bridge = getHttpMcpBridge();
    if (bridge) {
      bridge.clearMcpServersForWorkspace(data.workspaceId);
    }
  });
}

function* handleWorkspaceDeletedForMcp(
  action: ReturnType<typeof workspaceDeleted>,
) {
  const [data] = action.payload;
  yield* call(async () => {
    const { getHttpMcpBridge } = await import("../../../../../main/http-mcp-bridge");
    const bridge = getHttpMcpBridge();
    if (bridge) {
      bridge.clearMcpServersForWorkspace(data.workspaceId);
    }
  });
}

// ---------------------------------------------------------------------------
// Listener: workspace deleted → workspace service
// ---------------------------------------------------------------------------

function* handleWorkspaceDeletedForService(
  action: ReturnType<typeof workspaceDeleted>,
) {
  const [data] = action.payload;
  yield* call(async () => {
    const { workspaceService } = await import(
      "../../../../../features/workspace/main/workspace.service"
    );
    workspaceService.onWorkspaceDeleted(data);
  });
}

// ---------------------------------------------------------------------------
// Listener: workspace deleted → workspace state cleanup
// ---------------------------------------------------------------------------

import { cleanupWorkspace } from "../../workspace-events/workspace-events-slice";
import { clearWorkspace } from "../../agent-subscriptions/agent-subscriptions-slice";

function* handleWorkspaceDeletedCleanup(
  action: ReturnType<typeof workspaceDeleted>,
) {
  const [data] = action.payload;
  const { workspaceId } = data;

  yield* put(cleanupWorkspace(workspaceId));
  yield* put(clearWorkspace(workspaceId));
}

// ---------------------------------------------------------------------------
// Root saga
// ---------------------------------------------------------------------------

export function* workspaceLifecycleEventsSaga() {
  // Broadcast all workspace lifecycle events
  yield* takeEvery(WORKSPACE_LIFECYCLE_EVENT_TYPES, handleBroadcast);

  // Agent cleanup on workspace lifecycle
  yield* takeEvery(workspaceDeleting, handleWorkspaceDeletingForAgents);
  yield* takeEvery(workspaceArchived, handleWorkspaceArchivedForAgents);

  // MCP server cache cleanup
  yield* takeEvery(workspaceDeleting, handleWorkspaceDeletingForMcp);
  yield* takeEvery(workspaceDeleted, handleWorkspaceDeletedForMcp);
  // Workspace service reactions
  yield* takeEvery(workspaceDeleted, handleWorkspaceDeletedForService);

  // Workspace state cleanup
  yield* takeEvery(workspaceDeleted, handleWorkspaceDeletedCleanup);
}
