import { appClient } from '$lib/client';
import { createLogger } from '$lib/utils/client-logger';
import { m } from '$shared/paraglide/messages.js';
import {
  call,
  delay,
  fork,
  put,
  takeEvery,
  takeLatest,
  type SagaGenerator,
} from 'typed-redux-saga';

import {
  MCP_SERVER_NAME_MAX_LENGTH,
  MCP_SERVER_NAME_REGEX,
  RESERVED_MCP_SERVER_NAMES,
} from '$shared/config/mcp-constants';
import {
  mapDaemonMcpState,
  normalizeMcpServersPayload,
  toMcpErrorMessage,
} from '../mcp-settings-normalization';
import {
  selectMcpAdvancedSaveStatus,
  selectMcpDisabledServers,
  selectMcpEnabled,
  selectMcpServers,
} from '../mcp-settings-selectors';
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
  setServerErrorMessage,
  setServers,
  setServerStatus,
  testServerConnection,
  toggleEnabled,
  toggleServer,
  toggleServerDisabled,
  updateServer,
} from '../mcp-settings-slice';
import type { McpServerConfig, McpServerStatus } from '../mcp-settings-types';

const logger = createLogger('McpSettingsSaga');
export const ADVANCED_SAVED_RESET_MS = 2_000;
// The existing full-list settings seam still carries credentials through the renderer transiently.
// Main-process/keychain-owned MCP credential CRUD is tracked by monorepo#1181; never retain them here or in Redux.
type CredentialInput = [config: McpServerConfig, previousName?: string];

function copyServerForState(source: McpServerConfig): McpServerConfig {
  const server: McpServerConfig = { name: source.name, type: source.type };
  if (source.id !== undefined) server.id = source.id;
  if (source.command !== undefined) server.command = source.command;
  if (source.args !== undefined) server.args = [...source.args];
  if (source.url !== undefined) server.url = source.url;
  if (source.authType !== undefined) server.authType = source.authType;
  if (source.disabled !== undefined) server.disabled = source.disabled;
  return server;
}

function copyServerForWire(
  source: McpServerConfig,
  credentialSource: McpServerConfig | undefined = source,
): McpServerConfig {
  const server = copyServerForState(source);
  if (credentialSource?.env !== undefined) server.env = { ...credentialSource.env };
  if (credentialSource?.headers !== undefined) server.headers = { ...credentialSource.headers };
  return server;
}

// Never fabricate 'connected' from config shape alone: an enabled server shows
// 'configured' ("Ready") until the daemon reports a real status (load fetch via
// `mcp.servers.getStatus` or a `mcp.servers:status-changed` event).
function statusFor(disabled: boolean): McpServerStatus {
  return disabled ? 'disabled' : 'configured';
}

function validateName(name: string, existing: McpServerConfig[]): void {
  const trimmed = name?.trim();
  if (!trimmed) throw new Error(m.mcp_management_serverNameRequired_error());
  if (!MCP_SERVER_NAME_REGEX.test(trimmed)) throw new Error(m.mcp_management_invalidServerName_error());
  if (trimmed.length > MCP_SERVER_NAME_MAX_LENGTH) {
    throw new Error(m.mcp_management_serverNameTooLong_error({ max: MCP_SERVER_NAME_MAX_LENGTH }));
  }
  if ((RESERVED_MCP_SERVER_NAMES as readonly string[]).includes(trimmed)) {
    throw new Error(m.mcp_management_serverNameReserved_error({ name: trimmed }));
  }
  if (existing.some((server) => server.name === trimmed)) {
    throw new Error(m.mcp_management_serverNameExists_error({ name: trimmed }));
  }
}

function persistedServers(
  servers: McpServerConfig[],
  disabled: Record<string, true>,
  current: McpServerConfig[],
  credentialInputs: CredentialInput[],
): McpServerConfig[] {
  const currentByName = new Map(current.map((server) => [server.name, server]));
  const inputByName = new Map(credentialInputs.map(([config, previousName]) => [
    config.name,
    { config, previous: currentByName.get(previousName ?? config.name) },
  ]));
  return servers.map((source) => {
    const input = inputByName.get(source.name);
    const currentServer = currentByName.get(source.name);
    const credentialSource: McpServerConfig | undefined = input ? {
      name: source.name,
      type: source.type,
      env: input.config.env === undefined ? input.previous?.env : input.config.env,
      headers: input.config.headers === undefined ? input.previous?.headers : input.config.headers,
    } : currentServer;
    const server = copyServerForWire(source, credentialSource);
    if (source.name in disabled) server.disabled = true;
    else delete server.disabled;
    return server;
  });
}

function* persist(
  servers: McpServerConfig[],
  credentialInputs: CredentialInput[],
): SagaGenerator<void> {
  const disabled: Record<string, true> = yield* selectMcpDisabledServers.effect();
  try {
    const current: Awaited<ReturnType<typeof appClient.settings.getMcpServers>> = yield* call(
      [appClient.settings, appClient.settings.getMcpServers],
    );
    const result: Awaited<ReturnType<typeof appClient.settings.setMcpServers>> = yield* call(
      [appClient.settings, appClient.settings.setMcpServers],
      persistedServers(servers, disabled, current, credentialInputs),
    );
    if (!result.success) {
      yield* put(setError(toMcpErrorMessage(result.error, m.mcp_management_saveServersFailed_error())));
    }
  } catch (error) {
    yield* put(setError(toMcpErrorMessage(error, m.mcp_management_saveServersFailed_error())));
  }
}

/**
 * Fetch daemon-reported runtime statuses (`mcp.servers.getStatus`, §5.22) for
 * enabled servers carrying a daemon id, and overlay them on the status map.
 * A wire failure leaves the config-derived statuses in place — live updates
 * still arrive via `mcp.servers:status-changed`.
 */
function* fetchDaemonStatuses(servers: McpServerConfig[]): SagaGenerator<void> {
  const nameById = new Map(
    servers.flatMap((server) => (server.id && !server.disabled ? [[server.id, server.name] as const] : [])),
  );
  if (nameById.size === 0) return;
  try {
    const statuses: Awaited<ReturnType<typeof appClient.settings.getMcpServerStatuses>> =
      yield* call(
        [appClient.settings, appClient.settings.getMcpServerStatuses],
        [...nameById.keys()],
      );
    const statusMap: Record<string, McpServerStatus> = {};
    for (const status of statuses) {
      const name = nameById.get(status.serverId);
      const mapped = mapDaemonMcpState(status.state);
      if (!name || mapped === null) continue;
      statusMap[name] = mapped;
      if (mapped === 'error' && status.lastError) {
        yield* put(setServerErrorMessage(name, status.lastError));
      }
    }
    if (Object.keys(statusMap).length > 0) yield* put(bulkSetServerStatus(statusMap));
  } catch (error) {
    logger.warn('Failed to fetch daemon MCP server statuses', { error });
  }
}

function* load(): SagaGenerator<void> {
  const current: McpServerConfig[] = yield* selectMcpServers.effect();
  if (current.length === 0) yield* put(setLoading(true));
  yield* put(setError(null));
  try {
    const response: Awaited<ReturnType<typeof appClient.settings.getMcpServers>> = yield* call(
      [appClient.settings, appClient.settings.getMcpServers],
    );
    const servers = response.map(copyServerForState);
    const disabled: Record<string, true> = {};
    const statuses: Record<string, McpServerStatus> = {};
    for (const server of servers) {
      if (server.disabled) disabled[server.name] = true;
      statuses[server.name] = statusFor(Boolean(server.disabled));
    }
    yield* put(setServers(servers));
    yield* put(clearAllErrorMessages());
    yield* put(setDisabledServers(disabled));
    yield* put(bulkSetServerStatus(statuses));
    // Forked (not called) so a slow daemon status fan-out never delays
    // `setLoading(false)` — the list renders with config-derived badges that
    // upgrade when statuses land. Attached fork: a newer `loadServers` still
    // cancels it via takeLatest, so no stale overlay can apply.
    yield* fork(fetchDaemonStatuses, servers);
  } catch (error) {
    yield* put(setError(toMcpErrorMessage(error, m.mcp_management_loadServersFailed_error())));
  } finally {
    yield* put(setLoading(false));
  }
}

function* add(configInput: McpServerConfig): SagaGenerator<void> {
  yield* put(setError(null));
  const servers: McpServerConfig[] = yield* selectMcpServers.effect();
  try {
    validateName(configInput.name, servers);
  } catch (error) {
    yield* put(setError(toMcpErrorMessage(error, m.mcp_management_addServerFailed_error())));
    return;
  }
  const config = copyServerForState(configInput);
  delete config.disabled;
  const next = [...servers.map(copyServerForState), config];
  yield* put(setServers(next));
  yield* put(setServerStatus(config.name, statusFor(false)));
  const enabled: boolean = yield* selectMcpEnabled.effect();
  if (!enabled) yield* put(setEnabled(true));
  const credentialInputs: CredentialInput[] = [[configInput]];
  yield* call(persist, next, credentialInputs);
}

function* remove(name: string): SagaGenerator<void> {
  const servers: McpServerConfig[] = yield* selectMcpServers.effect();
  if (!servers.some((server) => server.name === name)) return;
  const next = servers.filter((server) => server.name !== name).map(copyServerForState);
  yield* put(removeServerFromState(name));
  yield* call(persist, next, []);
}

function* update(name: string, configInput: McpServerConfig): SagaGenerator<void> {
  yield* put(setError(null));
  const servers: McpServerConfig[] = yield* selectMcpServers.effect();
  const index = servers.findIndex((server) => server.name === name);
  if (index === -1) return;
  if (configInput.name !== name) {
    try {
      validateName(configInput.name, servers.filter((server) => server.name !== name));
    } catch (error) {
      yield* put(setError(toMcpErrorMessage(error, m.mcp_management_updateServerFailed_error())));
      return;
    }
    yield* put(removeServerFromState(name));
  }
  const config = copyServerForState(configInput);
  const next = servers.map((server, position) =>
    position === index ? config : copyServerForState(server));
  yield* put(setServers(next));
  yield* put(setServerStatus(config.name, statusFor(false)));
  const credentialInputs: CredentialInput[] = [[configInput, name]];
  yield* call(persist, next, credentialInputs);
}

function* importJson(json: string): SagaGenerator<void> {
  yield* put(setError(null));
  let configs: McpServerConfig[];
  try {
    configs = normalizeMcpServersPayload(JSON.parse(json));
  } catch (error) {
    yield* put(setError(toMcpErrorMessage(error, 'Failed to import servers')));
    return;
  }
  const existing: McpServerConfig[] = yield* selectMcpServers.effect();
  const seen = new Set(existing.map((server) => server.name));
  const added = configs.filter((config) => {
    const trimmed = config.name?.trim();
    if (!trimmed || seen.has(config.name) || !MCP_SERVER_NAME_REGEX.test(trimmed)) return false;
    if (trimmed.length > MCP_SERVER_NAME_MAX_LENGTH) return false;
    if ((RESERVED_MCP_SERVER_NAMES as readonly string[]).includes(trimmed)) return false;
    seen.add(config.name);
    return true;
  });
  if (added.length > 0) {
    const stateAdded = added.map(copyServerForState);
    const next = [...existing.map(copyServerForState), ...stateAdded];
    yield* put(setServers(next));
    for (const config of stateAdded) {
      yield* put(setServerStatus(config.name, statusFor(false)));
    }
    const enabled: boolean = yield* selectMcpEnabled.effect();
    if (!enabled) yield* put(setEnabled(true));
    yield* call(persist, next, added.map((config): [McpServerConfig] => [config]));
  }
  yield* put(importFromJsonCompleted(added.length));
}

function* toggle(name: string): SagaGenerator<void> {
  yield* put(toggleServerDisabled(name));
  const servers: McpServerConfig[] = yield* selectMcpServers.effect();
  const disabled: Record<string, true> = yield* selectMcpDisabledServers.effect();
  const server = servers.find((candidate) => candidate.name === name);
  if (server) yield* put(setServerStatus(name, statusFor(name in disabled)));
  yield* call(persist, servers, []);
}

function* toggleFeature(): SagaGenerator<void> {
  const enabled: boolean = yield* selectMcpEnabled.effect();
  yield* put(setEnabled(!enabled));
  if (!enabled) yield* call(load);
}

function* restart(name: string): SagaGenerator<void> {
  const servers: McpServerConfig[] = yield* selectMcpServers.effect();
  const server = servers.find((candidate) => candidate.name === name);
  if (!server) return;
  yield* put(clearServerErrorMessage(name));
  yield* put(setServerStatus(name, statusFor(false)));
}

function* saveAdvanced(json: string): SagaGenerator<void> {
  yield* put(setAdvancedSaveStatus('saving'));
  let configs: McpServerConfig[];
  try {
    configs = normalizeMcpServersPayload(JSON.parse(json));
  } catch {
    yield* put(setAdvancedSaveStatus('error', m.mcp_management_invalidJson_error()));
    return;
  }
  const seen = new Set<string>();
  for (const config of configs) {
    try {
      validateName(config.name, []);
    } catch (error) {
      yield* put(setAdvancedSaveStatus(
        'error',
        toMcpErrorMessage(error, m.mcp_management_invalidServerConfig_error()),
      ));
      return;
    }
    if (seen.has(config.name)) {
      yield* put(setAdvancedSaveStatus(
        'error',
        m.mcp_management_duplicateServerName_error({ name: config.name }),
      ));
      return;
    }
    seen.add(config.name);
  }
  const disabled: Record<string, true> = {};
  const statuses: Record<string, McpServerStatus> = {};
  const stateConfigs = configs.map(copyServerForState);
  for (const config of stateConfigs) {
    if (config.disabled) disabled[config.name] = true;
    statuses[config.name] = statusFor(Boolean(config.disabled));
  }
  yield* put(setServers(stateConfigs));
  yield* put(setDisabledServers(disabled));
  yield* put(bulkSetServerStatus(statuses));
  try {
    const result: Awaited<ReturnType<typeof appClient.settings.setMcpServers>> = yield* call(
      [appClient.settings, appClient.settings.setMcpServers],
      stateConfigs.map((config, index) => copyServerForWire(config, configs[index])),
    );
    if (!result.success) {
      yield* put(setAdvancedSaveStatus(
        'error',
        toMcpErrorMessage(result.error, m.mcp_management_saveFailed_error()),
      ));
      return;
    }
  } catch (error) {
    yield* put(setAdvancedSaveStatus(
      'error',
      toMcpErrorMessage(error, m.mcp_management_saveFailed_error()),
    ));
    return;
  }
  yield* put(setAdvancedSaveStatus('saved'));
  yield* fork(resetAdvancedStatus);
}

function* resetAdvancedStatus(): SagaGenerator<void> {
  yield* delay(ADVANCED_SAVED_RESET_MS);
  const status = yield* selectMcpAdvancedSaveStatus.effect();
  if (status === 'saved') yield* put(setAdvancedSaveStatus('idle'));
}

function* toggleEnabledWorker(
  _action: ReturnType<typeof toggleEnabled>,
): SagaGenerator<void> {
  yield* call(toggleFeature);
}

function* addServerWorker(action: ReturnType<typeof addServer>): SagaGenerator<void> {
  yield* call(add, action.payload[0]);
}

function* removeServerWorker(action: ReturnType<typeof removeServer>): SagaGenerator<void> {
  yield* call(remove, action.payload[0]);
}

function* updateServerWorker(action: ReturnType<typeof updateServer>): SagaGenerator<void> {
  yield* call(update, action.payload[0], action.payload[1]);
}

function* importFromJsonWorker(action: ReturnType<typeof importFromJson>): SagaGenerator<void> {
  yield* call(importJson, action.payload[0]);
}

function* toggleServerWorker(action: ReturnType<typeof toggleServer>): SagaGenerator<void> {
  yield* call(toggle, action.payload[0]);
}

function* testServerConnectionWorker(
  action: ReturnType<typeof testServerConnection>,
): SagaGenerator<void> {
  logger.warn('MCP connection test unsupported — no seam method', { name: action.payload[0] });
}

function* restartServerWorker(action: ReturnType<typeof restartServer>): SagaGenerator<void> {
  yield* call(restart, action.payload[0]);
}

function* saveAdvancedJsonWorker(
  action: ReturnType<typeof saveAdvancedJson>,
): SagaGenerator<void> {
  yield* call(saveAdvanced, action.payload[0]);
}

export function* mcpSettingsSaga(): SagaGenerator<void> {
  yield* takeLatest(loadServers, load);
  yield* takeEvery(toggleEnabled, toggleEnabledWorker);
  yield* takeEvery(addServer, addServerWorker);
  yield* takeEvery(removeServer, removeServerWorker);
  yield* takeEvery(updateServer, updateServerWorker);
  yield* takeEvery(importFromJson, importFromJsonWorker);
  yield* takeEvery(toggleServer, toggleServerWorker);
  yield* takeEvery(testServerConnection, testServerConnectionWorker);
  yield* takeEvery(restartServer, restartServerWorker);
  yield* takeEvery(saveAdvancedJson, saveAdvancedJsonWorker);
}