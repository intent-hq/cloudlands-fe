/**
 * MCP Settings Saga
 *
 * Handles all side effects: IPC calls, error listener, connection tests.
 */

import { call, put, fork, takeEvery, select, delay } from "typed-redux-saga";
import type { SagaGenerator } from "typed-redux-saga";
import { createLogger } from "$lib/utils/client-logger";
import { on } from "$lib/electron-bridge";
import { takeLatestFromSelector } from "$lib/store/utils/selector-channel-effects";
import { selectActiveWorkspaceId } from "../../workspace/workspace-selectors";
import type { McpServerConfig, McpServerStatus, McpAuthInfo } from "../mcp-settings-types";
import {
  MCP_SERVER_NAME_REGEX,
  MCP_SERVER_NAME_MAX_LENGTH,
  RESERVED_MCP_SERVER_NAMES,
} from "$shared/config/mcp-constants";
import {
  setServers,
  setLoading,
  setError,
  setEnabled,
  setServerStatus,
  setServerErrorMessage,
  clearServerErrorMessage,
  clearAllErrorMessages,
  setDisabledServers,
  toggleServerDisabled,
  removeServerFromState,
  bulkSetServerStatus,
  loadServers,
  toggleEnabled,
  toggleServer,
  addServer,
  removeServer,
  updateServer,
  importFromJson,
  importFromJsonCompleted,
  testServerConnection,
  applyWorkspaceDisabledServers,
  toggleWorkspaceMcpServer,
} from "../mcp-settings-slice";
import {
  selectMcpServers,
  selectMcpDisabledServers,
  selectMcpEnabled,
  selectMcpStatusMap,
  selectWorkspaceDisabledMcpServerNamesByWorkspaceId,
} from "../mcp-settings-selectors";

const logger = createLogger("McpSettingsSaga");

// ============================================================================
// IPC helpers
// ============================================================================

async function invokeIpc(channel: string, data?: any): Promise<any> {
  if (typeof window === "undefined" || !window.electronAPI) return undefined;
  return await window.electronAPI.invoke(channel, data);
}

// ============================================================================
// Load servers saga
// ============================================================================

function* handleLoadServers(): SagaGenerator<void> {
  const servers: McpServerConfig[] = yield* select(selectMcpServers.select);
  const isFirstLoad = servers.length === 0;

  if (isFirstLoad) {
    yield* put(setLoading(true));
  }
  yield* put(setError(null));

  try {
    // Check if feature is enabled
    const settingsResult = yield* call(invokeIpc, "settings:get", {
      key: "enableUserMcpServers",
    });
    const enabledVal = settingsResult?.success ? settingsResult.data !== false : true;
    yield* put(setEnabled(enabledVal));

    if (!enabledVal) {
      yield* put(setServers([]));
      logger.debug("User MCP servers feature is disabled");
      yield* put(setLoading(false));
      return;
    }

    // Load disabled servers
    const disabledResult = yield* call(invokeIpc, "settings:get", {
      key: "disabledMcpServers",
    });
    if (disabledResult?.success && Array.isArray(disabledResult.data)) {
      const disabledMap: Record<string, true> = {};
      for (const name of disabledResult.data) {
        disabledMap[name] = true;
      }
      yield* put(setDisabledServers(disabledMap));
    }

    // Load servers - try CLI first, fall back to direct settings.json read
    let result = yield* call(invokeIpc, "user-mcp:mcp-list", undefined);
    if (!result?.success) {
      logger.warn("CLI mcp-list failed, falling back to direct settings read", {
        error: result?.error,
      });
      result = yield* call(invokeIpc, "user-mcp:get-servers", undefined);
    }

    if (result?.success) {
      const data = result.data;
      let serverList: any[] = [];

      if (Array.isArray(data)) {
        serverList = data;
      } else if (data?.servers && Array.isArray(data.servers)) {
        serverList = data.servers;
      } else if (typeof data === "object" && data !== null) {
        serverList = Object.entries(data).map(([name, config]: [string, any]) => ({
          name,
          ...config,
        }));
      }

      const parsedServers: McpServerConfig[] = serverList.map((s: any) => ({
        name: s.name || "unknown",
        type: s.type || s.transport || (s.command ? "stdio" : "http"),
        url: s.url,
        command: s.command,
        args: s.args,
        env: s.env,
        headers: s.headers,
        authType: s.authType,
      }));

      // Supplement authType from direct settings read if needed
      const hasAnyAuthType = parsedServers.some((s) => s.authType);
      if (!hasAnyAuthType && parsedServers.length > 0) {
        yield* call(supplementAuthType, parsedServers);
      }

      yield* put(setServers(parsedServers));
      logger.info("Loaded MCP servers:", { count: parsedServers.length });

      // Set initial status + clear errors
      yield* put(clearAllErrorMessages());
      yield* call(setInitialStatuses, parsedServers);

      // Test HTTP connections in background
      yield* fork(testAllHttpConnectionsSaga, parsedServers);
    } else {
      yield* put(setError(result?.error || "Failed to load servers"));
    }
  } catch (error) {
    yield* put(
      setError(error instanceof Error ? error.message : "Failed to load servers")
    );
    logger.error("Failed to load MCP servers:", error);
  } finally {
    yield* put(setLoading(false));
  }
}

/** Supplement authType from direct settings.json read */
async function supplementAuthType(servers: McpServerConfig[]): Promise<void> {
  try {
    const settingsRaw = await invokeIpc("user-mcp:get-servers", undefined);
    if (settingsRaw?.success && settingsRaw.data) {
      const rawMap = settingsRaw.data as Record<string, any>;
      for (const server of servers) {
        const raw = rawMap[server.name];
        if (raw?.authType) {
          server.authType = raw.authType;
        }
      }
    }
  } catch (e) {
    logger.debug("Could not supplement authType from settings.json", e);
  }
}

/** Set initial statuses for non-disabled servers */
function* setInitialStatuses(servers: McpServerConfig[]): SagaGenerator<void> {
  const disabledServers: Record<string, true> = yield* select(selectMcpDisabledServers.select);
  const currentStatusMap: Record<string, McpServerStatus> = yield* select(selectMcpStatusMap.select);

  const updates: Record<string, McpServerStatus> = {};
  for (const server of servers) {
    if (!(server.name in disabledServers)) {
      const currentStatus = currentStatusMap[server.name];
      if (currentStatus !== "error" && currentStatus !== "auth_required") {
        updates[server.name] = "configured";
      }
    }
  }
  if (Object.keys(updates).length > 0) {
    yield* put(bulkSetServerStatus(updates));
  }
}

// ============================================================================
// Test connections saga
// ============================================================================

function* testAllHttpConnectionsSaga(servers: McpServerConfig[]): SagaGenerator<void> {
  const disabledServers: Record<string, true> = yield* select(selectMcpDisabledServers.select);
  const httpServers = servers.filter(
    (s) => s.type !== "stdio" && s.url && !(s.name in disabledServers)
  );

  if (httpServers.length === 0) return;

  logger.debug("Testing HTTP/SSE server connections:", {
    count: httpServers.length,
    names: httpServers.map((s) => s.name),
  });

  for (const server of httpServers) {
    yield* fork(handleTestServerConnection, testServerConnection(server.name, server.url!, server.headers));
  }
}

function* handleTestServerConnection(
  action: ReturnType<typeof testServerConnection>
): SagaGenerator<void> {
  const [name, url, headers] = action.payload;
  try {
    logger.debug("Testing connection for server:", { name, url });
    const result = yield* call(invokeIpc, "user-mcp:test-connection", {
      url,
      headers,
      name,
    });

    if (result?.success && result.data) {
      const { status, errorMessage } = result.data;
      logger.info("Connection test result:", { name, status, errorMessage });
      yield* put(setServerStatus(name, status));

      if (errorMessage) {
        yield* put(setServerErrorMessage(name, errorMessage));
      } else {
        yield* put(clearServerErrorMessage(name));
      }
    }
  } catch (error) {
    logger.error("Failed to test server connection:", { name, error });
  }
}

// ============================================================================
// Toggle enabled saga
// ============================================================================

function* handleToggleEnabled(): SagaGenerator<void> {
  const currentEnabled: boolean = yield* select(selectMcpEnabled.select);
  const newEnabled = !currentEnabled;
  yield* put(setEnabled(newEnabled));

  try {
    yield* call(invokeIpc, "settings:set", {
      key: "enableUserMcpServers",
      value: newEnabled,
    });
    logger.info("User MCP servers enabled:", newEnabled);

    if (newEnabled) {
      yield* call(handleLoadServers);
    }
  } catch (error) {
    logger.error("Failed to save enabled setting:", error);
  }
}

// ============================================================================
// Toggle server saga
// ============================================================================

function* handleToggleServer(action: ReturnType<typeof toggleServer>): SagaGenerator<void> {
  const [name] = action.payload;
  yield* put(toggleServerDisabled(name));

  // Persist disabled servers to settings
  const disabledServers: Record<string, true> = yield* select(selectMcpDisabledServers.select);
  try {
    yield* call(invokeIpc, "settings:set", {
      key: "disabledMcpServers",
      value: Object.keys(disabledServers),
    });
  } catch (error) {
    logger.error("Failed to persist disabled MCP servers:", error);
  }
}

// ============================================================================
// Workspace disabled-server state
// ============================================================================

function* loadWorkspaceState(workspaceId: string): SagaGenerator<void> {
  try {
    const result = yield* call(invokeIpc, "user-mcp:get-workspace-disabled", { workspaceId });

    if (result?.success && Array.isArray(result.data)) {
      const disabledNames = result.data.filter(
        (item: unknown): item is string => typeof item === "string"
      );
      yield* put(applyWorkspaceDisabledServers(workspaceId, disabledNames));
      logger.debug("Loaded workspace MCP disabled servers", {
        workspaceId,
        disabledCount: disabledNames.length,
      });
      return;
    }

    if (result?.success && result.data === null) {
      yield* call(loadGlobalDefaultsForWorkspace, workspaceId);
    }
  } catch (error) {
    logger.error("Failed to load workspace MCP disabled servers", { error });
  }
}

function* loadGlobalDefaultsForWorkspace(workspaceId: string): SagaGenerator<void> {
  try {
    const result = yield* call(invokeIpc, "settings:get", { key: "disabledMcpServers" });
    if (!result?.success || !Array.isArray(result.data)) return;

    const disabledNames = result.data.filter(
      (item: unknown): item is string => typeof item === "string"
    );
    yield* put(applyWorkspaceDisabledServers(workspaceId, disabledNames));
    logger.debug("Inherited global disabled MCP servers for workspace", {
      workspaceId,
      disabledCount: disabledNames.length,
    });
  } catch (error) {
    logger.error("Failed to load global MCP disabled defaults", { error });
  }
}

function* handleWorkspaceChange({ payload: workspaceId }: { payload: string | null }): SagaGenerator<void> {
  if (!workspaceId) return;
  yield* delay(100);
  yield* call(loadWorkspaceState, workspaceId);
}

function* handleToggleWorkspaceMcpServer(
  action: ReturnType<typeof toggleWorkspaceMcpServer>
): SagaGenerator<void> {
  const [workspaceId] = action.payload;
  if (!workspaceId) return;

  const disabledServers = yield* selectWorkspaceDisabledMcpServerNamesByWorkspaceId.effect(workspaceId);

  try {
    const result = yield* call(invokeIpc, "user-mcp:set-workspace-disabled", {
      workspaceId,
      disabledServers,
    });
    if (!result?.success) {
      logger.error("Failed to persist workspace MCP disabled servers", { error: result?.error });
    }
  } catch (error) {
    logger.error("Failed to persist workspace MCP disabled servers", { error });
  }
}

// ============================================================================
// Add server saga
// ============================================================================

/** Validate server name. Throws on invalid. */
function validateServerName(name: string, existingServers: McpServerConfig[]): void {
  const trimmedName = name?.trim();
  if (!trimmedName) {
    throw new Error("Server name is required");
  }
  if (!MCP_SERVER_NAME_REGEX.test(trimmedName)) {
    throw new Error(
      "Server name can only contain letters, numbers, hyphens, underscores, and dots"
    );
  }
  if (trimmedName.length > MCP_SERVER_NAME_MAX_LENGTH) {
    throw new Error(`Server name must be ${MCP_SERVER_NAME_MAX_LENGTH} characters or less`);
  }
  if ((RESERVED_MCP_SERVER_NAMES as readonly string[]).includes(trimmedName)) {
    throw new Error(`Server name "${trimmedName}" is reserved`);
  }
  if (existingServers.some((s) => s.name === trimmedName)) {
    throw new Error(`A server named "${trimmedName}" already exists`);
  }
}

async function checkAuthRequirement(url: string): Promise<McpAuthInfo> {
  try {
    const result = await invokeIpc("user-mcp:check-auth", { url });
    if (result?.success && result.data) {
      return result.data;
    }
  } catch (error) {
    logger.error("Failed to check auth requirement:", error);
  }
  return { requiresAuth: false, hasAuth: false };
}

function* handleAddServer(action: ReturnType<typeof addServer>): SagaGenerator<void> {
  const [config] = action.payload;
  const servers: McpServerConfig[] = yield* select(selectMcpServers.select);

  // Validate
  validateServerName(config.name, servers);

  // Check auth for HTTP/SSE servers
  let authInfo: McpAuthInfo | undefined;
  if (config.type !== "stdio" && config.url) {
    authInfo = yield* call(checkAuthRequirement, config.url);
    if (authInfo.requiresAuth && !authInfo.hasAuth) {
      logger.warn("MCP server requires auth but credentials not found:", {
        name: config.name,
        provider: authInfo.providerName,
      });
    }
  }

  const ipcConfig: any = {
    name: config.name,
    transport: config.type,
  };

  if (config.type === "stdio") {
    ipcConfig.command = config.command;
    if (config.args) ipcConfig.args = config.args.join(" ");
    if (config.env) ipcConfig.env = config.env;
  } else {
    ipcConfig.url = config.url;
    if (config.headers) ipcConfig.headers = config.headers;
    if (config.authType) ipcConfig.authType = config.authType;
  }

  const result = yield* call(invokeIpc, "user-mcp:mcp-add", ipcConfig);
  if (result?.success) {
    yield* call(handleLoadServers);
    logger.info("Added MCP server:", config.name);

    // Auto-enable feature when first server is added
    const enabled: boolean = yield* select(selectMcpEnabled.select);
    if (!enabled) {
      yield* put(setEnabled(true));
      yield* call(invokeIpc, "settings:set", {
        key: "enableUserMcpServers",
        value: true,
      });
    }

    // Test connection for HTTP/SSE servers
    if (config.type !== "stdio" && config.url) {
      yield* call(
        handleTestServerConnection,
        testServerConnection(config.name, config.url, config.headers)
      );
    }
  } else {
    throw new Error(result?.error || "Failed to add server");
  }
}

// ============================================================================
// Remove server saga
// ============================================================================

function* handleRemoveServer(action: ReturnType<typeof removeServer>): SagaGenerator<void> {
  const [name] = action.payload;
  const result = yield* call(invokeIpc, "user-mcp:mcp-remove", { name });
  if (result?.success) {
    yield* put(removeServerFromState(name));
    logger.info("Removed MCP server:", name);
  } else {
    throw new Error(result?.error || "Failed to remove server");
  }
}

// ============================================================================
// Update server saga
// ============================================================================

function* handleUpdateServer(action: ReturnType<typeof updateServer>): SagaGenerator<void> {
  const [name, config] = action.payload;
  yield* call(handleRemoveServer, removeServer(name));
  yield* call(handleAddServer, addServer(config));
}

// ============================================================================
// Import from JSON saga
// ============================================================================

function* handleImportFromJson(action: ReturnType<typeof importFromJson>): SagaGenerator<void> {
  const [jsonString] = action.payload;
  const data = JSON.parse(jsonString);

  let serversObj: Record<string, any> = data;
  if (data.mcpServers && typeof data.mcpServers === "object") {
    serversObj = data.mcpServers;
  } else if (data.servers && typeof data.servers === "object") {
    serversObj = data.servers;
  }

  let importedCount = 0;
  if (typeof serversObj === "object" && !Array.isArray(serversObj)) {
    const entries = Object.entries(serversObj);
    importedCount = entries.length;
    for (const [name, cfg] of entries) {
      const config = cfg as any;
      let transportType: "stdio" | "http" | "sse" = "stdio";
      if (config.type === "http" || config.type === "sse") {
        transportType = config.type;
      } else if (config.url) {
        transportType = "http";
      }

      const serverConfig: McpServerConfig = {
        name,
        type: transportType,
        command: config.command,
        args: config.args,
        env: config.env,
        url: config.url,
        headers: config.headers,
        authType: config.authType,
      };
      yield* call(handleAddServer, addServer(serverConfig));
    }
  }

  yield* put(importFromJsonCompleted(importedCount));
}

// ============================================================================
// IPC error listener saga
// ============================================================================

function* mcpErrorListenerSaga(): SagaGenerator<void> {
  if (typeof window === "undefined" || !window.electronAPI) return;

  // We use the `on` helper which returns a listener ID
  // The callback dispatches directly via the store since it's outside saga context
  try {
    const { getReduxStore } = yield* call(
      async () => await import("$lib/store/redux-dispatch-bridge")
    );

    yield* call(on, "mcp:server-error", (_event: any, data: any) => {
      const { serverName, command, errorMessage } = data || {};
      if (!errorMessage) return;

      const isAuthError = /\bUnauthorized\b|\b401\b|\b403\b|\bauth/i.test(errorMessage);
      const status: McpServerStatus = isAuthError ? "auth_required" : "error";
      const friendlyMessage = isAuthError
        ? "Authentication required — check your credentials or reauthenticate"
        : errorMessage;

      const store = getReduxStore();

      if (serverName) {
        store.dispatch(setServerStatus(serverName, status));
        store.dispatch(setServerErrorMessage(serverName, friendlyMessage));
        logger.warn("MCP server error received", { serverName, errorMessage, status });
        return;
      }

      // Try to match by command/URL against loaded servers
      if (command) {
        const state = store.getState();
        const servers = selectMcpServers.select(state);
        for (const server of servers) {
          const serverCmd =
            server.type === "stdio"
              ? server.args?.length
                ? `${server.command} ${server.args.join(" ")}`
                : server.command
              : server.url;
          if (serverCmd && command.includes(serverCmd)) {
            store.dispatch(setServerStatus(server.name, status));
            store.dispatch(setServerErrorMessage(server.name, friendlyMessage));
            logger.warn("MCP server error matched by command", {
              serverName: server.name,
              errorMessage,
              status,
            });
            return;
          }
        }
      }

      logger.warn("MCP server error received but could not match to server", {
        command,
        errorMessage,
      });
    });
  } catch {
    // electronAPI may not be available
  }
}

// ============================================================================
// Root saga
// ============================================================================

export function* mcpSettingsSaga(): SagaGenerator<void> {
  yield* fork(mcpErrorListenerSaga);
  yield* takeLatestFromSelector(selectActiveWorkspaceId, handleWorkspaceChange);
  yield* takeEvery(loadServers, handleLoadServers);
  yield* takeEvery(toggleEnabled, handleToggleEnabled);
  yield* takeEvery(toggleServer, handleToggleServer);
  yield* takeEvery(toggleWorkspaceMcpServer, handleToggleWorkspaceMcpServer);
  yield* takeEvery(addServer, handleAddServer);
  yield* takeEvery(removeServer, handleRemoveServer);
  yield* takeEvery(updateServer, handleUpdateServer);
  yield* takeEvery(importFromJson, handleImportFromJson);
  yield* takeEvery(testServerConnection, handleTestServerConnection);
}

