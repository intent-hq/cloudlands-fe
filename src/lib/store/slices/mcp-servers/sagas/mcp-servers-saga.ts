import { call, put, fork, takeEvery, takeLatest, type SagaGenerator, delay } from "typed-redux-saga";
import { invoke, isElectron } from "$lib/electron-bridge";
import { takeEveryFromElectronChannel } from "$lib/store/utils/ipc-channel";
import { takeLatestFromSelector } from "$lib/store/utils/selector-channel-effects";
import { createLogger } from "$lib/utils/client-logger";
import {
  loadMcpServers,
  setMcpLoading,
  setMcpServersData,
  setMcpError,
  clearMcpServerErrors,
  setMcpServerError,
  toggleMcpServer,
  applyDisabledServers,
} from "../mcp-servers-slice";
import {
  selectMcpServers,
  selectDisabledMcpServerNames,
} from "../mcp-servers-selectors";
import { selectActiveWorkspaceId } from "../../workspace/workspace-selectors";
import type { McpServerInfo } from "../mcp-servers-types";

const logger = createLogger("McpServersSaga");
// ============================================================================
// IPC Error Listener
// ============================================================================

interface McpServerErrorEvent {
  serverName?: string;
  command?: string;
  errorMessage?: string;
}

function makeFriendlyMessage(errorMessage: string): string {
  const isAuthError = /\bUnauthorized\b|\b401\b|\b403\b|\bauth/i.test(errorMessage);
  return isAuthError
    ? "Authentication required — check your credentials or reauthenticate"
    : errorMessage;
}

function* watchServerErrors() {
  if (!isElectron()) return;

  yield* takeEveryFromElectronChannel<McpServerErrorEvent>(
    "mcp:server-error",
    function* (data) {
      const { serverName, command, errorMessage } = data || {};
      if (!errorMessage) return;

      const friendlyMessage = makeFriendlyMessage(errorMessage);

      if (serverName) {
        yield* put(setMcpServerError(serverName, friendlyMessage));
        logger.warn("MCP server error received", { serverName, errorMessage });
        return;
      }

      // Try to match by command/URL against loaded servers
      if (command) {
        const servers: McpServerInfo[] = yield* selectMcpServers.effect();
        for (const server of servers) {
          if (
            (server.url && command.includes(server.url)) ||
            (server.command && command.includes(server.command))
          ) {
            yield* put(setMcpServerError(server.name, friendlyMessage));
            logger.warn("MCP server error matched by command", {
              serverName: server.name,
              errorMessage,
            });
            return;
          }
        }
      }

      logger.warn("MCP server error received but could not match to server", {
        command,
        errorMessage,
      });
    },
  );
}

// ============================================================================
// Load Servers
// ============================================================================

function* handleLoadServers(): SagaGenerator<void> {
  yield* delay(100); // Small delay to batch rapid reloads and ensure UI updates
  yield* put(setMcpLoading(true));
  yield* put(setMcpError(null));
  yield* put(clearMcpServerErrors());

  try {
    // Check if the feature is enabled
    const settingsResult: { success?: boolean; data?: any } = yield* call(
      invoke<{ success?: boolean; data?: any }>,
      "settings:get",
      { key: "enableUserMcpServers" },
    );
    const featureEnabled = settingsResult?.success ? settingsResult.data !== false : true;

    if (!featureEnabled) {
      yield* put(setMcpServersData([]));
      logger.debug("User MCP servers feature is disabled");
      return;
    }

    const result: { success?: boolean; data?: Record<string, any> } = yield* call(
      invoke<{ success?: boolean; data?: Record<string, any> }>,
      "user-mcp:get-servers",
      undefined,
    );

    if (result?.success && result.data) {
      const serverMap = result.data;
      const servers: McpServerInfo[] = Object.entries(serverMap).map(([name, cfg]) => ({
        name,
        type: cfg.type === "http" ? "http" : cfg.type === "sse" ? "sse" : "command",
        url: cfg.url,
        command: cfg.command,
      }));
      yield* put(setMcpServersData(servers));
      logger.info("Loaded MCP servers", { count: servers.length });
    } else {
      yield* put(setMcpServersData([]));
      logger.debug("No MCP servers found in settings");
    }
  } catch (error) {
    yield* put(setMcpError(error instanceof Error ? error.message : "Failed to load MCP servers"));
    logger.error("Failed to load MCP servers", { error });
  } finally {
    yield* put(setMcpLoading(false));
  }
}



// ============================================================================
// Workspace State Loading
// ============================================================================

function* loadWorkspaceState(workspaceId: string): SagaGenerator<void> {
  try {
    const result: { success?: boolean; data?: string[] | null } = yield* call(
      invoke<{ success?: boolean; data?: string[] | null }>,
      "user-mcp:get-workspace-disabled",
      { workspaceId },
    );

    if (result?.success && Array.isArray(result.data)) {
      yield* put(applyDisabledServers(workspaceId, result.data));
      logger.debug("Loaded MCP server state from workspace", {
        workspaceId,
        disabledCount: result.data.length,
      });
    } else if (result?.success && result.data === null) {
      yield* call(loadGlobalDefaults, workspaceId);
    }
  } catch (error) {
    logger.error("Failed to load MCP server state", { error });
  }
}

function* loadGlobalDefaults(workspaceId: string): SagaGenerator<void> {
  try {
    const result: { success?: boolean; data?: any } = yield* call(
      invoke<{ success?: boolean; data?: any }>,
      "settings:get",
      { key: "disabledMcpServers" },
    );

    if (result?.success && Array.isArray(result.data) && result.data.length > 0) {
      const filtered = result.data.filter(
        (item: unknown): item is string => typeof item === "string",
      );
      yield* put(applyDisabledServers(workspaceId, filtered));
      logger.debug("Inherited global disabled MCP servers for new workspace", {
        workspaceId,
        disabledCount: filtered.length,
        disabledServers: filtered,
      });
    }
  } catch (error) {
    logger.error("Failed to load global MCP server defaults", { error });
  }
}

// ============================================================================
// Persistence
// ============================================================================

function* handleToggleServer(action: ReturnType<typeof toggleMcpServer>): SagaGenerator<void> {
  const [wsId] = action.payload;
  if (!wsId) return;

  const disabledServers: string[] = yield* selectDisabledMcpServerNames.effect();

  try {
    const result: { success?: boolean; error?: string } = yield* call(
      invoke<{ success?: boolean; error?: string }>,
      "user-mcp:set-workspace-disabled",
      { workspaceId: wsId, disabledServers },
    );
    if (!result?.success) {
      logger.error("Failed to save MCP server state", { error: result?.error });
    }
  } catch (error) {
    logger.error("Failed to save MCP server state", { error });
  }
}

// ============================================================================
// Root Saga
// ============================================================================

function* handleWorkspaceChange({ payload: workspaceId }: { payload: string | null }): SagaGenerator<void> {
  if (!workspaceId) return;
  yield* delay(100); // Small delay to batch rapid reloads and ensure UI updates
  yield* call(loadWorkspaceState, workspaceId);
}

export function* mcpServersSaga(): SagaGenerator<void> {
  yield* fork(watchServerErrors);
  yield* takeLatest(loadMcpServers, handleLoadServers);
  yield* takeLatestFromSelector(selectActiveWorkspaceId, handleWorkspaceChange);
  yield* takeEvery(toggleMcpServer, handleToggleServer);
}