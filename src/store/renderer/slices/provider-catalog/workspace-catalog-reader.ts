import type { BackendTransport } from '$lib/client/live/backend-transport-types';
import type { ProviderAuthStatusParams, ProviderAuthVerdict } from '$shared/provider-auth-status';
import { copyServerForState } from '../mcp-settings/mcp-settings-normalization';
import type { WorkspaceCatalogSnapshot } from './provider-catalog-types';

export interface WorkspaceCatalogReaders {
  providers: { catalog: (workspaceId?: string) => Promise<WorkspaceCatalogSnapshot['catalog']> };
  settings: {
    list: (workspaceId?: string) => Promise<WorkspaceCatalogSnapshot['settings']>;
    getMcpServers: (
      workspaceId?: string,
    ) => Promise<NonNullable<WorkspaceCatalogSnapshot['mcpServers']>>;
    getMcpServerStatuses: (
      ids: string[],
      workspaceId?: string,
    ) => Promise<NonNullable<WorkspaceCatalogSnapshot['mcpStatuses']>>;
  };
  specialists: {
    listCatalog?: (
      provider?: string,
      workspaceId?: string,
      options?: { includeProject?: boolean },
    ) => Promise<Pick<WorkspaceCatalogSnapshot, 'specialists' | 'importDiagnostics'>>;
    list: (
      provider?: string,
      workspaceId?: string,
    ) => Promise<WorkspaceCatalogSnapshot['specialists']>;
  };
  backendRequest: BackendTransport['request'];
  getProviderAuthVerdicts: (
    options?: ProviderAuthStatusParams,
  ) => Promise<Record<string, ProviderAuthVerdict>>;
}

/** The complete workspace snapshot; consumers never receive placeholder specialist/MCP fields. */
export function createWorkspaceCatalogReader({
  providers,
  settings: settingsClient,
  specialists,
  backendRequest,
  getProviderAuthVerdicts,
}: WorkspaceCatalogReaders) {
  return async function readWorkspaceCatalog(
    workspaceId: string,
  ): Promise<WorkspaceCatalogSnapshot> {
    const [catalog, settings, specialistCatalog, discovery, auth, mcpServers] = await Promise.all([
      providers.catalog(workspaceId),
      settingsClient.list(workspaceId),
      specialists.listCatalog
        ? specialists.listCatalog(undefined, workspaceId, { includeProject: true })
        : specialists
            .list(undefined, workspaceId)
            .then((specialists) => ({ specialists, importDiagnostics: undefined })),
      backendRequest<{
        providers: Array<{
          id: string;
          installed: boolean;
          gatedOff?: string | null;
          hasNpxFallback?: boolean;
        }>;
      }>('host.providerDiscovery', { workspaceId }),
      getProviderAuthVerdicts({ workspaceId }),
      settingsClient.getMcpServers(workspaceId),
    ]);
    const mcpStatuses = await settingsClient.getMcpServerStatuses(
      mcpServers.flatMap((server) => (server.id ? [server.id] : [])),
      workspaceId,
    );
    return {
      catalog,
      settings,
      specialists: specialistCatalog.specialists,
      importDiagnostics: specialistCatalog.importDiagnostics,
      mcpServers: mcpServers.map(copyServerForState),
      mcpStatuses,
      readiness: Object.fromEntries(
        discovery.providers.map((p) => [
          p.id,
          {
            available: p.installed && !p.gatedOff,
            ...auth[p.id],
            hasNpxFallback: p.hasNpxFallback,
          },
        ]),
      ),
    };
  };
}
