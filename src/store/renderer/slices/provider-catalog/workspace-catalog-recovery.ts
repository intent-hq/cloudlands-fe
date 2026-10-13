import type { RendererRecoveryOwner } from '$features/events/renderer-event-recovery';
import { fromWireMcpConfig, fromWireMcpStatus } from '$lib/client/live/live-settings-client';
import type { SettingsSnapshot, SpecialistCatalog } from '$lib/client/app-client';
import { ProviderCatalogResponseSchema } from '$shared/provider-catalog';
import { toAuthVerdictMap, type ProviderAuthStatusResponse } from '$shared/provider-auth-status';
import { copyServerForState } from '../mcp-settings/mcp-settings-normalization';
import type { WorkspaceCatalogSnapshot } from './provider-catalog-types';

export const workspaceCatalogRecoveryKey = (workspaceId: string) =>
  `workspace-catalog:${JSON.stringify([workspaceId])}`;

/** A rejected sibling must not release the snapshot's single-flight slot early. */
export async function settleCatalogReads<const T extends readonly unknown[]>(
  reads: T,
): Promise<{ -readonly [P in keyof T]: Awaited<T[P]> }> {
  try {
    return await Promise.all(reads);
  } finally {
    await Promise.allSettled(reads);
  }
}

/** Recovery bypasses completed caches and error-folding convenience reads. */
export async function readRecoveryCatalog(
  workspaceId: string,
  { request }: Parameters<RendererRecoveryOwner<WorkspaceCatalogSnapshot>['read']>[0],
): Promise<WorkspaceCatalogSnapshot> {
  const [catalog, settings, specialists, discovery, auth, servers] = await settleCatalogReads([
    request<unknown>('providers.catalog', { workspaceId }),
    request<SettingsSnapshot>('settings.list', { workspaceId }),
    request<SpecialistCatalog>('specialist.list', { workspaceId, includeProject: true }),
    request<{
      providers: Array<{
        id: string;
        installed: boolean;
        gatedOff?: string | null;
        hasNpxFallback?: boolean;
      }>;
    }>('host.providerDiscovery', { workspaceId }),
    request<ProviderAuthStatusResponse>('host.providerAuthStatus', { workspaceId }),
    request<{ servers: Parameters<typeof fromWireMcpConfig>[0][] }>('mcp.servers.list', {
      workspaceId,
    }),
  ]);
  const mcpServers = servers.servers.flatMap((wire) => {
    const config = fromWireMcpConfig(wire);
    return config ? [copyServerForState(config)] : [];
  });
  const statuses = await settleCatalogReads(
    mcpServers.flatMap(({ id }) =>
      id
        ? [
            request<{ status: Parameters<typeof fromWireMcpStatus>[1] }>('mcp.servers.getStatus', {
              workspaceId,
              serverId: id,
            }).then(({ status }) => fromWireMcpStatus(id, status)),
          ]
        : [],
    ),
  );
  const verdicts = toAuthVerdictMap(auth);
  return {
    catalog: ProviderCatalogResponseSchema.parse(catalog),
    settings: settings.settings,
    specialists: specialists.specialists,
    importDiagnostics: specialists.importDiagnostics,
    mcpServers,
    mcpStatuses: statuses.filter((status) => status !== null),
    readiness: Object.fromEntries(
      discovery.providers.map((provider) => [
        provider.id,
        {
          available: provider.installed && !provider.gatedOff,
          ...verdicts[provider.id],
          hasNpxFallback: provider.hasNpxFallback,
        },
      ]),
    ),
  };
}
