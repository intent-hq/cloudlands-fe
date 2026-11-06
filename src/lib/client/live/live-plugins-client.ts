/**
 * App-wide Agent Plugins (PROTOCOL §5.57). Thin typed wrappers over the
 * administrator-only `plugin.*` methods; gate callers on `agentPlugins: 1`.
 */
import { backendRequest } from './backend-transport';

type PluginTransport = 'stdio' | 'streamable-http' | 'sse';

interface PluginMcpServer {
  name: string;
  sessionName: string;
  transport: PluginTransport;
}

export interface PluginInfo {
  name: string;
  status: 'ok' | 'invalid';
  enabled: boolean;
  path: string;
  error?: string;
  version?: string;
  description?: string;
  author?: { name?: string; email?: string; url?: string };
  homepage?: string;
  repository?: string;
  license?: string;
  keywords?: string[];
  source?: string;
  sourceKind?: 'path' | 'git';
  skills: string[];
  mcpServers: PluginMcpServer[];
  diagnostics: string[];
}

/** Git clones may take up to the daemon's 180 s limit. */
const FETCH_TIMEOUT_MS = 200_000;

export async function listPlugins(): Promise<PluginInfo[]> {
  const result = await backendRequest<{ plugins?: PluginInfo[] }>('plugin.list', {});
  return result?.plugins ?? [];
}

export async function installPlugin(source: string): Promise<PluginInfo> {
  const result = await backendRequest<{ plugin: PluginInfo }>(
    'plugin.install',
    { source },
    { timeoutMs: FETCH_TIMEOUT_MS },
  );
  return result.plugin;
}

export async function updatePlugin(name: string): Promise<PluginInfo> {
  const result = await backendRequest<{ plugin: PluginInfo }>(
    'plugin.update',
    { name },
    { timeoutMs: FETCH_TIMEOUT_MS },
  );
  return result.plugin;
}

export async function togglePlugin(name: string, enabled: boolean): Promise<PluginInfo> {
  const result = await backendRequest<{ plugin: PluginInfo }>('plugin.toggle', { name, enabled });
  return result.plugin;
}

export async function uninstallPlugin(name: string): Promise<void> {
  await backendRequest('plugin.uninstall', { name });
}
