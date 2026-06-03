/**
 * MCP Settings Saga
 *
 * Handles all side effects: IPC calls, error listener, connection tests.
 */

import {
  call,
  put,
  fork,
  takeEvery,
  delay,
} from "typed-redux-saga";
import type { SagaGenerator } from "typed-redux-saga";
import { createLogger } from "$lib/utils/client-logger";
import { takeEveryFromElectronChannel } from "$store/renderer/utils/ipc-channel";
import { takeLatestFromSelector } from "ag-redux-toolkit/utils/sagas/selector-channel-effects";
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
  restartServer,
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
import {
  normalizeDisabledServers,
  normalizeMcpAuthInfo,
  normalizeMcpAuthType,
  normalizeMcpServerStatus,
  normalizeMcpServersPayload,
  optionalString,
  toMcpErrorMessage,
} from "../mcp-settings-normalization";

const logger = createLogger("McpSettingsSaga");

type McpServerErrorPayload = Record<string, unknown>;

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

export function* handleLoadServers(): SagaGenerator<void> {
  const servers: McpServerConfig[] = yield* selectMcpServers.effect();
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
      yield* put(setDisabledServers(normalizeDisabledServers(disabledResult.data)));
    }

    // Load servers - try CLI first, fall back to direct settings.json read
    let result = yield* call(invokeIpc, "user-mcp:mcp-list", undefined);
    if (!result?.success) {
      const errorMessage = toMcpErrorMessage(result?.error, "Failed to list servers");
      logger.warn("CLI mcp-list failed, falling back to direct settings read", {
        error: errorMessage,
      });
      result = yield* call(invokeIpc, "user-mcp:get-servers", undefined);
    }

    if (result?.success) {
      const parsedServers = normalizeMcpServersPayload(result.data);

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
      yield* put(setError(toMcpErrorMessage(result?.error, "Failed to load servers")));
    }
  } catch (error) {
    const errorMessage = toMcpErrorMessage(error, "Failed to load servers");
    yield* put(setError(errorMessage));
    logger.error("Failed to load MCP servers:", errorMessage);
  } finally {
    yield* put(setLoading(false));
  }
}

/** Supplement authType from direct settings.json read */
async function supplementAuthType(servers: McpServerConfig[]): Promise<void> {
  try {
    const settingsRaw = await invokeIpc("user-mcp:get-servers", undefined);
    if (settingsRaw?.success && settingsRaw.data && typeof settingsRaw.data === "object") {
      const rawMap = settingsRaw.data as Record<string, any>;
      for (const server of servers) {
        const raw = rawMap[server.name];
        const authType = normalizeMcpAuthType(raw?.authType);
        if (authType) {
          server.authType = authType;
        }
      }
    }
  } catch (e) {
    logger.debug("Could not supplement authType from settings.json", toMcpErrorMessage(e, "Unknown error"));
  }
}

/** Set initial statuses for non-disabled servers */
function* setInitialStatuses(servers: McpServerConfig[]): SagaGenerator<void> {
  const disabledServers: Record<string, true> = yield* selectMcpDisabledServers.effect();
  const currentStatusMap: Record<string, McpServerStatus> = yield* selectMcpStatusMap.effect();

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
  const disabledServers: Record<string, true> = yield* selectMcpDisabledServers.effect();
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

    if (result?.success && result.data && typeof result.data === "object") {
      const data = result.data as Record<string, unknown>;
      const status = normalizeMcpServerStatus(data.status);
      const errorMessage = data.errorMessage
        ? toMcpErrorMessage(data.errorMessage, "Connection test failed")
        : null;
      logger.info("Connection test result:", { name, status, errorMessage });
      if (status) {
        yield* put(setServerStatus(name, status));
      }

      if (errorMessage) {
        yield* put(setServerErrorMessage(name, errorMessage));
      } else {
        yield* put(clearServerErrorMessage(name));
      }
    } else if (!result?.success) {
      const errorMessage = toMcpErrorMessage(result?.error, "Connection test failed");
      yield* put(setServerStatus(name, "error"));
      yield* put(setServerErrorMessage(name, errorMessage));
    }
  } catch (error) {
    logger.error("Failed to test server connection:", {
      name,
      error: toMcpErrorMessage(error, "Connection test failed"),
    });
  }
}

// ============================================================================
// Restart server saga
// ============================================================================

export function* handleRestartServer(
  action: ReturnType<typeof restartServer>
): SagaGenerator<void> {
  const [name] = action.payload;
  const servers: McpServerConfig[] = yield* selectMcpServers.effect();
  const server = servers.find((s) => s.name === name);
  if (!server) {
    logger.warn("Cannot restart unknown MCP server", { name });
    return;
  }

  // Optimistically clear the prior failure and mark the server as re-validating.
  yield* put(clearServerErrorMessage(name));
  yield* put(setServerStatus(name, "configured"));

  // Remote servers can be actively re-tested now. Stdio servers have no
  // renderer-owned process to restart — the next agent launch re-attempts the
  // spawn, so we leave the optimistic "configured" state and let the
  // startup-error listener flip it back to "stopped" if it fails again.
  if (server.type !== "stdio" && server.url) {
    yield* call(
      handleTestServerConnection,
      testServerConnection(server.name, server.url, server.headers)
    );
  }

  logger.info("Restart requested for MCP server", { name, type: server.type });
}

// ============================================================================
// Toggle enabled saga
// ============================================================================

function* handleToggleEnabled(): SagaGenerator<void> {
  const currentEnabled: boolean = yield* selectMcpEnabled.effect();
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
    logger.error("Failed to save enabled setting:", toMcpErrorMessage(error, "Failed to save enabled setting"));
  }
}

// ============================================================================
// Toggle server saga
// ============================================================================

function* handleToggleServer(action: ReturnType<typeof toggleServer>): SagaGenerator<void> {
  const [name] = action.payload;
  yield* put(toggleServerDisabled(name));

  // Persist disabled servers to settings
  const disabledServers: Record<string, true> = yield* selectMcpDisabledServers.effect();
  try {
    yield* call(invokeIpc, "settings:set", {
      key: "disabledMcpServers",
      value: Object.keys(disabledServers),
    });
  } catch (error) {
    logger.error(
      "Failed to persist disabled MCP servers:",
      toMcpErrorMessage(error, "Failed to persist disabled MCP servers")
    );
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
      return normalizeMcpAuthInfo(result.data);
    }
  } catch (error) {
    logger.error("Failed to check auth requirement:", toMcpErrorMessage(error, "Failed to check auth requirement"));
  }
  return { requiresAuth: false, hasAuth: false };
}

function* handleAddServer(action: ReturnType<typeof addServer>): SagaGenerator<void> {
  try {
    const [config] = action.payload;
    const servers: McpServerConfig[] = yield* selectMcpServers.effect();

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
    if (!result?.success) {
      const errorMessage = toMcpErrorMessage(result?.error, "Failed to add server");
      yield* put(setError(errorMessage));
      logger.error("Failed to add MCP server:", errorMessage);
      return;
    }

    yield* call(handleLoadServers);
    logger.info("Added MCP server:", config.name);

    // Auto-enable feature when first server is added
    const enabled: boolean = yield* selectMcpEnabled.effect();
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
  } catch (error) {
    const errorMessage = toMcpErrorMessage(error, "Failed to add server");
    yield* put(setError(errorMessage));
    logger.error("Failed to add MCP server:", errorMessage);
  }
}

// ============================================================================
// Remove server saga
// ============================================================================

function* removeServerByName(name: string): SagaGenerator<boolean> {
  try {
    const result = yield* call(invokeIpc, "user-mcp:mcp-remove", { name });
    if (result?.success) {
      yield* put(removeServerFromState(name));
      logger.info("Removed MCP server:", name);
      return true;
    }
    const errorMessage = toMcpErrorMessage(result?.error, "Failed to remove server");
    yield* put(setError(errorMessage));
    logger.error("Failed to remove MCP server:", errorMessage);
  } catch (error) {
    const errorMessage = toMcpErrorMessage(error, "Failed to remove server");
    yield* put(setError(errorMessage));
    logger.error("Failed to remove MCP server:", errorMessage);
  }
  return false;
}

function* handleRemoveServer(action: ReturnType<typeof removeServer>): SagaGenerator<void> {
  const [name] = action.payload;
  yield* call(removeServerByName, name);
}

// ============================================================================
// Update server saga
// ============================================================================

function* handleUpdateServer(action: ReturnType<typeof updateServer>): SagaGenerator<void> {
  const [name, config] = action.payload;
  const removed = yield* call(removeServerByName, name);
  if (!removed) return;
  yield* call(handleAddServer, addServer(config));
}

// ============================================================================
// Import from JSON saga
// ============================================================================

function* handleImportFromJson(action: ReturnType<typeof importFromJson>): SagaGenerator<void> {
  try {
    const [jsonString] = action.payload;
    const data = JSON.parse(jsonString);
    const serverConfigs = normalizeMcpServersPayload(data);

    for (const serverConfig of serverConfigs) {
      yield* call(handleAddServer, addServer(serverConfig));
    }
    yield* put(importFromJsonCompleted(serverConfigs.length));
  } catch (error) {
    const errorMessage = toMcpErrorMessage(error, "Failed to import servers");
    yield* put(setError(errorMessage));
    logger.error("Failed to import MCP servers:", errorMessage);
  }
}

// ============================================================================
// IPC error listener saga
// ============================================================================

/** @internal Exported for testing only. */
export function* handleMcpServerError(data: McpServerErrorPayload): SagaGenerator<void> {
  const serverName = optionalString(data?.serverName);
  const command = optionalString(data?.command);
  const errorMessage = data?.errorMessage
    ? toMcpErrorMessage(data.errorMessage, "MCP server error")
    : null;
  if (!errorMessage) return;

  // This listener only fires for MCP server startup/launch failures, which
  // mean the server is not running. Distinguish auth failures (recoverable
  // by re-authenticating) from a stopped/unavailable server (recoverable by
  // retrying/restarting).
  const isAuthError = /\bUnauthorized\b|\b401\b|\b403\b|\bauth/i.test(errorMessage);
  const status: McpServerStatus = isAuthError ? "auth_required" : "stopped";
  const friendlyMessage = isAuthError
    ? "Authentication required — check your credentials or reauthenticate"
    : errorMessage;

  if (serverName) {
    yield* put(setServerStatus(serverName, status));
    yield* put(setServerErrorMessage(serverName, friendlyMessage));
    logger.warn("MCP server error received", { serverName, errorMessage, status });
    return;
  }

  // Try to match by command/URL against loaded servers
  if (command) {
    const servers: McpServerConfig[] = yield* selectMcpServers.effect();
    for (const server of servers) {
      const serverCmd =
        server.type === "stdio"
          ? server.args?.length
            ? `${server.command} ${server.args.join(" ")}`
            : server.command
          : server.url;
      if (serverCmd && command.includes(serverCmd)) {
        yield* put(setServerStatus(server.name, status));
        yield* put(setServerErrorMessage(server.name, friendlyMessage));
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
}

function* mcpErrorListenerSaga(): SagaGenerator<void> {
  yield* takeEveryFromElectronChannel<McpServerErrorPayload>("mcp:server-error", handleMcpServerError);
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
  yield* takeEvery(restartServer, handleRestartServer);
}

