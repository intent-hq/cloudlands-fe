import { appClient } from '$lib/client';
import type { McpServerConfig } from '$lib/components/settings/mcp/types';
import { startRootStoreLifecycle } from '$store/renderer/root-store-lifecycle';
import { store } from '$store/renderer/store';
import { mcpSettingsSaga } from '$store/renderer/slices/mcp-settings/sagas/mcp-settings-saga';
import type { McpServerRuntimeStatus } from '$store/renderer/slices/mcp-settings/mcp-settings-types';
import {
  setEnabled,
  setLoading,
  setServers,
} from '$store/renderer/slices/mcp-settings/mcp-settings-slice';

export interface McpSettingsPreviewOptions {
  servers?: McpServerConfig[];
  interactive?: boolean;
  statuses?: McpServerRuntimeStatus[];
  onPersist?: (servers: McpServerConfig[]) => void;
  onRestart?: (serverId: string) => void;
}

export function setupMcpSettingsPreview({
  servers = [],
  interactive = false,
  statuses = [],
  onPersist,
  onRestart,
}: McpSettingsPreviewOptions) {
  const previous = {
    getMcpServers: appClient.settings.getMcpServers,
    setMcpServers: appClient.settings.setMcpServers,
    getMcpServerStatuses: appClient.settings.getMcpServerStatuses,
    restartMcpServer: appClient.settings.restartMcpServer,
  };
  let saved = structuredClone(servers);
  const runtime = new Map(statuses.map((status) => [status.serverId, status]));
  if (interactive) {
    appClient.settings.getMcpServers = async () => structuredClone(saved);
    appClient.settings.setMcpServers = async (configs) => {
      saved = structuredClone(configs);
      onPersist?.(structuredClone(saved));
      return { success: true };
    };
    appClient.settings.getMcpServerStatuses = async (ids) =>
      ids.map((serverId) => runtime.get(serverId) ?? { serverId, state: 'running' });
    appClient.settings.restartMcpServer = async (serverId) => {
      onRestart?.(serverId);
      const status = { serverId, state: 'running' as const };
      runtime.set(serverId, status);
      return status;
    };
  }
  const dispose = startRootStoreLifecycle(store, {
    startSagas: () => (interactive ? [store.runSaga(mcpSettingsSaga)] : []),
  });
  store.dispatch(setEnabled(true));
  store.dispatch(setLoading(false));
  store.dispatch(setServers(servers));
  return () => {
    dispose();
    if (interactive) Object.assign(appClient.settings, previous);
  };
}
