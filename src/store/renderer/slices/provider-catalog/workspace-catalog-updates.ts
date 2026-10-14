import type { WorkspaceCatalogSnapshot, WorkspaceCatalogUpdate } from './provider-catalog-types';

/** Apply the same push to cached state and to a read that started before it. */
export function applyWorkspaceCatalogUpdate(
  snapshot: WorkspaceCatalogSnapshot,
  update: WorkspaceCatalogUpdate,
): WorkspaceCatalogSnapshot {
  switch (update.kind) {
    case 'settings': {
      const changes = new Map(update.changes.map((change) => [change.path, change]));
      return {
        ...snapshot,
        settings: snapshot.settings.map((setting) => {
          const change = changes.get(setting.path);
          return change
            ? {
                ...setting,
                value: change.value,
                ...(change.origin ? { origin: change.origin } : {}),
              }
            : setting;
        }),
      };
    }
    case 'status':
      return {
        ...snapshot,
        mcpStatuses: [
          ...(snapshot.mcpStatuses ?? []).filter(
            (status) => status.serverId !== update.status.serverId,
          ),
          update.status,
        ],
      };
    case 'toggle':
      return {
        ...snapshot,
        mcpServers: snapshot.mcpServers?.map((server) =>
          server.id === update.serverId
            ? { ...server, workspaceDisabled: update.workspaceDisabled }
            : server,
        ),
      };
  }
}
