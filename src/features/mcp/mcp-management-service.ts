/**
 * MCP management service — the sanctioned post-saga MCP settings mechanism.
 *
 * The `loadServers` refresh trigger plus the management triggers (`addServer`,
 * `removeServer`, `updateServer`, `toggleServer`, `toggleEnabled`,
 * `importFromJson`, `testServerConnection`, `restartServer`) lost their handler
 * when the saga runtime was removed (they used to live in
 * `sagas/mcp-settings-saga.ts`), so the MCP settings panel could no longer load,
 * add, remove, toggle, or persist servers. This restores those paths WITHOUT
 * re-adding a saga and WITHOUT changing any call site:
 * `createMcpManagementMiddleware()` observes every dispatched action and routes
 * the MCP triggers through the `appClient.settings` seam
 * (`getMcpServers` / `setMcpServers`) plus pure local slice updates.
 *
 * Persistence path: the renderer reaches "the backend" only through the
 * `appClient` seam (consistent with the git/agent/file-explorer read services);
 * the legacy `user-mcp:*` IPC channels are NOT re-added. The server list is read
 * via `settings.getMcpServers()` and every mutation (add/remove/update/import/
 * toggle) is persisted via `settings.setMcpServers()` with the disabled flag
 * folded into each config so it round-trips through the one persistence method
 * the seam offers. In mock mode `setMcpServers` is an accepted no-op, so the
 * optimistic local slice update is what drives the UI; in live mode the same
 * call persists.
 *
 * BE gaps (no seam method exists; recorded rather than faked):
 *  - `testServerConnection`: no connection-test endpoint, so reachability cannot
 *    be probed — handled as a logged no-op (status is left intact).
 *  - `restartServer`: no restart endpoint — mirrors the legacy optimistic path
 *    (clear the prior error + mark "configured"); remote re-validation is absent.
 *  - `toggleEnabled`: the `enableUserMcpServers` feature flag has no seam method,
 *    so the toggle updates local state only (not persisted across reloads).
 *
 * Dependency-light per src/store AGENTS.md: imports only the AppClient seam, the
 * configured store, the slice actions, shared MCP validation constants, the
 * payload normalizer, and the logger (NOT selectors — importing them would
 * evaluate `store.createSelector` while the store module is still
 * mid-initialization through the middleware chain).
 */
import type { StoreMiddleware } from "@augmentcode/ag-redux-toolkit/types";
import { appClient } from "$lib/client";
import { store as appStore } from "$store/renderer/store";
import {
  MCP_SERVER_NAME_REGEX,
  MCP_SERVER_NAME_MAX_LENGTH,
  RESERVED_MCP_SERVER_NAMES,
} from "$shared/config/mcp-constants";
import {
  normalizeMcpServersPayload,
  toMcpErrorMessage,
} from "$store/renderer/slices/mcp-settings/mcp-settings-normalization";
import type {
  McpServerConfig,
  McpServerStatus,
} from "$store/renderer/slices/mcp-settings/mcp-settings-types";
import {
  addServer,
  bulkSetServerStatus,
  clearAllErrorMessages,
  clearServerErrorMessage,
  importFromJson,
  importFromJsonCompleted,
  loadServers,
  removeServer,
  removeServerFromState,
  restartServer,
  saveAdvancedJson,
  setAdvancedSaveStatus,
  setDisabledServers,
  setEnabled,
  setError,
  setLoading,
  setServers,
  setServerStatus,
  testServerConnection,
  toggleEnabled,
  toggleServer,
  toggleServerDisabled,
  updateServer,
} from "$store/renderer/slices/mcp-settings/mcp-settings-slice";
import { createLogger } from "$lib/utils/client-logger";

const logger = createLogger("McpManagementService");

/** Current persisted server list from the (post-reducer) store. */
function currentServers(): McpServerConfig[] {
  return appStore.state.mcpSettings.servers;
}

/** Current per-server disabled map from the (post-reducer) store. */
function currentDisabled(): Record<string, true> {
  return appStore.state.mcpSettings.disabledServers;
}

/** Derive a status for a server (mirrors the boot seeder + disabled overlay). */
function statusFor(server: McpServerConfig, disabled: boolean): McpServerStatus {
  if (disabled) return "disabled";
  return server.type === "stdio" ? "configured" : "connected";
}

/**
 * Persist a server list through the one seam method available, folding the
 * disabled map into each config's `disabled` flag so the state round-trips on a
 * later `getMcpServers()`. Failures are surfaced via `setError`; the optimistic
 * local slice update stays so the UI is not silently reverted.
 */
async function persistServers(servers: McpServerConfig[]): Promise<void> {
  const disabled = currentDisabled();
  const payload = servers.map((server) => {
    if (server.name in disabled) return { ...server, disabled: true as const };
    if (server.disabled) {
      const { disabled: _drop, ...rest } = server;
      return rest;
    }
    return server;
  });
  try {
    const result = await appClient.settings.setMcpServers(payload);
    if (!result.success) {
      appStore.dispatch(setError(toMcpErrorMessage(result.error, "Failed to save MCP servers")));
    }
  } catch (error) {
    appStore.dispatch(setError(toMcpErrorMessage(error, "Failed to save MCP servers")));
  }
}

/**
 * Refetch the server list from the seam and converge the store to it. The first
 * load shows the skeleton (`setLoading(true)`); errors are surfaced via
 * `setError` and leave the prior list intact. Does NOT touch `enabled` so an
 * explicit user toggle is never clobbered by a refresh.
 */
export async function refreshMcpServers(): Promise<void> {
  const isFirstLoad = currentServers().length === 0;
  if (isFirstLoad) appStore.dispatch(setLoading(true));
  appStore.dispatch(setError(null));
  try {
    const servers = await appClient.settings.getMcpServers();
    appStore.dispatch(setServers(servers));
    appStore.dispatch(clearAllErrorMessages());

    const disabled: Record<string, true> = {};
    const statusMap: Record<string, McpServerStatus> = {};
    for (const server of servers) {
      if (server.disabled) disabled[server.name] = true;
      statusMap[server.name] = statusFor(server, Boolean(server.disabled));
    }
    appStore.dispatch(setDisabledServers(disabled));
    appStore.dispatch(bulkSetServerStatus(statusMap));
    logger.info("Loaded MCP servers", { count: servers.length });
  } catch (error) {
    appStore.dispatch(setError(toMcpErrorMessage(error, "Failed to load servers")));
  } finally {
    appStore.dispatch(setLoading(false));
  }
}

/** Validate a server name against the shared rules. Throws on invalid input. */
function validateServerName(name: string, existing: McpServerConfig[]): void {
  const trimmed = name?.trim();
  if (!trimmed) throw new Error("Server name is required");
  if (!MCP_SERVER_NAME_REGEX.test(trimmed)) {
    throw new Error(
      "Server name can only contain letters, numbers, hyphens, underscores, and dots",
    );
  }
  if (trimmed.length > MCP_SERVER_NAME_MAX_LENGTH) {
    throw new Error(`Server name must be ${MCP_SERVER_NAME_MAX_LENGTH} characters or less`);
  }
  if ((RESERVED_MCP_SERVER_NAMES as readonly string[]).includes(trimmed)) {
    throw new Error(`Server name "${trimmed}" is reserved`);
  }
  if (existing.some((s) => s.name === trimmed)) {
    throw new Error(`A server named "${trimmed}" already exists`);
  }
}

/** Validate, optimistically add, auto-enable the feature, and persist. */
export async function addMcpServer(config: McpServerConfig): Promise<void> {
  appStore.dispatch(setError(null));
  try {
    validateServerName(config.name, currentServers());
  } catch (error) {
    appStore.dispatch(setError(toMcpErrorMessage(error, "Failed to add server")));
    return;
  }
  const next = [...currentServers(), config];
  appStore.dispatch(setServers(next));
  appStore.dispatch(setServerStatus(config.name, statusFor(config, false)));
  if (!appStore.state.mcpSettings.enabled) appStore.dispatch(setEnabled(true));
  await persistServers(next);
  logger.info("Added MCP server", { name: config.name });
}

/** Optimistically remove a server from local state and persist the new list. */
export async function removeMcpServer(name: string): Promise<void> {
  if (!currentServers().some((s) => s.name === name)) {
    logger.warn("Cannot remove unknown MCP server", { name });
    return;
  }
  appStore.dispatch(removeServerFromState(name));
  await persistServers(currentServers());
  logger.info("Removed MCP server", { name });
}

/** Replace a server config (optionally renamed), purge stale maps, and persist. */
export async function updateMcpServer(name: string, config: McpServerConfig): Promise<void> {
  appStore.dispatch(setError(null));
  const servers = currentServers();
  const index = servers.findIndex((s) => s.name === name);
  if (index === -1) {
    logger.warn("Cannot update unknown MCP server", { name });
    return;
  }
  if (config.name !== name) {
    try {
      validateServerName(
        config.name,
        servers.filter((s) => s.name !== name),
      );
    } catch (error) {
      appStore.dispatch(setError(toMcpErrorMessage(error, "Failed to update server")));
      return;
    }
    appStore.dispatch(removeServerFromState(name));
  }
  const next = servers.map((s, i) => (i === index ? config : s));
  appStore.dispatch(setServers(next));
  appStore.dispatch(setServerStatus(config.name, statusFor(config, false)));
  await persistServers(next);
  logger.info("Updated MCP server", { name, newName: config.name });
}

/** Parse a JSON blob, append every valid + new server, persist, report the count. */
export async function importMcpServersFromJson(jsonString: string): Promise<void> {
  appStore.dispatch(setError(null));
  let configs: McpServerConfig[];
  try {
    configs = normalizeMcpServersPayload(JSON.parse(jsonString));
  } catch (error) {
    appStore.dispatch(setError(toMcpErrorMessage(error, "Failed to import servers")));
    return;
  }
  const existing = currentServers();
  const seen = new Set(existing.map((s) => s.name));
  const added: McpServerConfig[] = [];
  for (const config of configs) {
    const trimmed = config.name?.trim();
    if (!trimmed || seen.has(config.name)) continue;
    if (!MCP_SERVER_NAME_REGEX.test(trimmed) || trimmed.length > MCP_SERVER_NAME_MAX_LENGTH) continue;
    if ((RESERVED_MCP_SERVER_NAMES as readonly string[]).includes(trimmed)) continue;
    seen.add(config.name);
    added.push(config);
  }
  if (added.length > 0) {
    const next = [...existing, ...added];
    appStore.dispatch(setServers(next));
    for (const config of added) {
      appStore.dispatch(setServerStatus(config.name, statusFor(config, false)));
    }
    if (!appStore.state.mcpSettings.enabled) appStore.dispatch(setEnabled(true));
    await persistServers(next);
  }
  appStore.dispatch(importFromJsonCompleted(added.length));
  logger.info("Imported MCP servers", { count: added.length });
}

/** Flip a server's disabled flag locally and persist it via the server list. */
export async function toggleMcpServer(name: string): Promise<void> {
  appStore.dispatch(toggleServerDisabled(name));
  const disabledNow = name in currentDisabled();
  const server = currentServers().find((s) => s.name === name);
  if (server) appStore.dispatch(setServerStatus(name, statusFor(server, disabledNow)));
  await persistServers(currentServers());
}

/**
 * Flip the MCP feature flag locally (no seam persists it — BE gap) and, when
 * enabling, refresh the list so the panel reflects the configured servers.
 */
export function toggleMcpEnabled(): void {
  const next = !appStore.state.mcpSettings.enabled;
  appStore.dispatch(setEnabled(next));
  if (next) void refreshMcpServers();
}

/**
 * Optimistically clear a server's prior error and mark it re-validating. No seam
 * method exists to actually restart or re-test a server (BE gap), so this mirrors
 * the legacy optimistic behaviour without claiming a real reconnection.
 */
export function restartMcpServer(name: string): void {
  const server = currentServers().find((s) => s.name === name);
  if (!server) {
    logger.warn("Cannot restart unknown MCP server", { name });
    return;
  }
  appStore.dispatch(clearServerErrorMessage(name));
  appStore.dispatch(setServerStatus(name, statusFor(server, false)));
  logger.info("Restart requested for MCP server (optimistic — no restart seam)", { name });
}

/** No connection-test seam exists (BE gap); log and leave the status intact. */
export function testMcpServerConnection(name: string): void {
  logger.warn("MCP connection test unsupported — no seam method (BE gap)", { name });
}

/** How long the advanced editor shows "saved" before returning to idle. */
const ADVANCED_SAVED_RESET_MS = 2000;

/**
 * Advanced JSON editor save: parse the pasted JSON, validate every server name,
 * and REPLACE the whole configured set (unlike `importMcpServersFromJson`,
 * which only appends new names). The daemon is converged through the same
 * `setMcpServers` seam (backed by the §5.22 `mcp.servers.*` CRUD in live mode),
 * so removed entries are deleted and `disabled` flags round-trip. Save state is
 * surfaced via `setAdvancedSaveStatus` for the editor UI.
 */
export async function saveAdvancedMcpJson(jsonString: string): Promise<void> {
  appStore.dispatch(setAdvancedSaveStatus("saving"));
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonString);
  } catch {
    appStore.dispatch(setAdvancedSaveStatus("error", "Invalid JSON format"));
    return;
  }
  const configs = normalizeMcpServersPayload(parsed);
  const seen = new Set<string>();
  for (const config of configs) {
    try {
      validateServerName(config.name, []);
    } catch (error) {
      appStore.dispatch(
        setAdvancedSaveStatus("error", toMcpErrorMessage(error, "Invalid server config")),
      );
      return;
    }
    if (seen.has(config.name)) {
      appStore.dispatch(
        setAdvancedSaveStatus("error", `Duplicate server name "${config.name}"`),
      );
      return;
    }
    seen.add(config.name);
  }

  appStore.dispatch(setServers(configs));
  const disabled: Record<string, true> = {};
  const statusMap: Record<string, McpServerStatus> = {};
  for (const config of configs) {
    if (config.disabled) disabled[config.name] = true;
    statusMap[config.name] = statusFor(config, Boolean(config.disabled));
  }
  appStore.dispatch(setDisabledServers(disabled));
  appStore.dispatch(bulkSetServerStatus(statusMap));

  try {
    const result = await appClient.settings.setMcpServers(configs);
    if (!result.success) {
      appStore.dispatch(
        setAdvancedSaveStatus("error", toMcpErrorMessage(result.error, "Failed to save")),
      );
      return;
    }
  } catch (error) {
    appStore.dispatch(
      setAdvancedSaveStatus("error", toMcpErrorMessage(error, "Failed to save")),
    );
    return;
  }
  appStore.dispatch(setAdvancedSaveStatus("saved"));
  logger.info("Saved MCP servers from advanced editor", { count: configs.length });
  setTimeout(() => {
    if (appStore.state.mcpSettings.advancedSaveStatus === "saved") {
      appStore.dispatch(setAdvancedSaveStatus("idle"));
    }
  }, ADVANCED_SAVED_RESET_MS);
}

/** Narrow an action-payload entry to an `McpServerConfig`. */
function isServerConfig(value: unknown): value is McpServerConfig {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as McpServerConfig).name === "string"
  );
}

/**
 * Middleware that gives the MCP settings triggers a real handler: after each
 * action passes through the (no-op) reducer, it routes the trigger to the
 * matching seam-backed handler. Fire-and-forget — dispatch stays synchronous and
 * never throws.
 */
export function createMcpManagementMiddleware(): StoreMiddleware {
  return () => (next) => (action) => {
    const result = next(action);
    if (action && typeof action.type === "string") {
      const payload = Array.isArray(action.payload) ? action.payload : [];
      switch (action.type) {
        case loadServers.type:
          void refreshMcpServers();
          break;
        case toggleEnabled.type:
          toggleMcpEnabled();
          break;
        case addServer.type:
          if (isServerConfig(payload[0])) void addMcpServer(payload[0]);
          break;
        case removeServer.type:
          if (typeof payload[0] === "string") void removeMcpServer(payload[0]);
          break;
        case updateServer.type:
          if (typeof payload[0] === "string" && isServerConfig(payload[1])) {
            void updateMcpServer(payload[0], payload[1]);
          }
          break;
        case importFromJson.type:
          if (typeof payload[0] === "string") void importMcpServersFromJson(payload[0]);
          break;
        case toggleServer.type:
          if (typeof payload[0] === "string") void toggleMcpServer(payload[0]);
          break;
        case testServerConnection.type:
          if (typeof payload[0] === "string") testMcpServerConnection(payload[0]);
          break;
        case restartServer.type:
          if (typeof payload[0] === "string") restartMcpServer(payload[0]);
          break;
        case saveAdvancedJson.type:
          if (typeof payload[0] === "string") void saveAdvancedMcpJson(payload[0]);
          break;
      }
    }
    return result;
  };
}
