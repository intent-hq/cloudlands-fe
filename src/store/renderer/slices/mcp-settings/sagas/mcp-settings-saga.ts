import { appClient } from '$lib/client';
import { createLogger } from '$lib/utils/client-logger';
import { m } from '$shared/paraglide/messages.js';
import {
  call,
  delay,
  fork,
  put,
  take,
  takeLatest,
  type SagaGenerator,
} from 'typed-redux-saga';

import {
  MCP_SERVER_NAME_MAX_LENGTH,
  MCP_SERVER_NAME_REGEX,
  RESERVED_MCP_SERVER_NAMES,
} from '$shared/config/mcp-constants';
import { normalizeMcpServersPayload, toMcpErrorMessage } from '../mcp-settings-normalization';
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

function statusFor(server: McpServerConfig, disabled: boolean): McpServerStatus {
  if (disabled) return 'disabled';
  return server.type === 'stdio' ? 'configured' : 'connected';
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
      statuses[server.name] = statusFor(server, Boolean(server.disabled));
    }
    yield* put(setServers(servers));
    yield* put(clearAllErrorMessages());
    yield* put(setDisabledServers(disabled));
    yield* put(bulkSetServerStatus(statuses));
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
  yield* put(setServerStatus(config.name, statusFor(config, false)));
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
  yield* put(setServerStatus(config.name, statusFor(config, false)));
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
      yield* put(setServerStatus(config.name, statusFor(config, false)));
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
  if (server) yield* put(setServerStatus(name, statusFor(server, name in disabled)));
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
  yield* put(setServerStatus(name, statusFor(server, false)));
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
    statuses[config.name] = statusFor(config, Boolean(config.disabled));
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

function* mutation(action: { type: string; payload: unknown }): SagaGenerator<void> {
  const payload = action.payload as unknown[];
  if (action.type === toggleEnabled.type) yield* call(toggleFeature);
  else if (action.type === addServer.type) yield* call(add, payload[0] as McpServerConfig);
  else if (action.type === removeServer.type) yield* call(remove, payload[0] as string);
  else if (action.type === updateServer.type) yield* call(update, payload[0] as string, payload[1] as McpServerConfig);
  else if (action.type === importFromJson.type) yield* call(importJson, payload[0] as string);
  else if (action.type === toggleServer.type) yield* call(toggle, payload[0] as string);
  else if (action.type === restartServer.type) yield* call(restart, payload[0] as string);
  else if (action.type === testServerConnection.type) logger.warn('MCP connection test unsupported — no seam method', { name: payload[0] });
  else yield* call(saveAdvanced, payload[0] as string);
}

function* mutationQueue(): SagaGenerator<void> {
  const patterns = [
    toggleEnabled.type,
    addServer.type,
    removeServer.type,
    updateServer.type,
    importFromJson.type,
    toggleServer.type,
    testServerConnection.type,
    restartServer.type,
    saveAdvancedJson.type,
  ];
  while (true) {
    const action: { type: string; payload: unknown } = yield* take(patterns);
    yield* fork(mutation, action);
  }
}

export function* mcpSettingsSaga(): SagaGenerator<void> {
  yield* takeLatest(loadServers, load);
  yield* fork(mutationQueue);
}