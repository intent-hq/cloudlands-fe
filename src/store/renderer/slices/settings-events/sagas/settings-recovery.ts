import { getMcpServerKey } from '$lib/components/settings/mcp/types';
import {
  copyServerForState,
  mapDaemonMcpState,
} from '../../mcp-settings/mcp-settings-normalization';
import {
  setServers,
  mcpGlobalStateRetired,
  bulkSetServerStatus,
  clearAllErrorMessages,
  setServerStatus,
  setServerErrorMessage,
  clearServerErrorMessage,
} from '../../mcp-settings/mcp-settings-slice';
import type { McpServerStatus } from '../../mcp-settings/mcp-settings-types';
import { rendererEventRecovery } from '$features/events/renderer-event-recovery';
import {
  GLOBAL_SETTINGS_RECOVERY_KEY,
  GLOBAL_MCP_RECOVERY_KEY,
  retireSettingsWork,
  waitForSettingsReads,
  isSettingsAuthorityError,
  onSettingsAuthorityFailure,
} from '$features/settings/settings-recovery-lifetime';
import { applySettingsChanges } from '$features/settings/settings-hydration-service';
import { RecoveryRequestTimeoutError } from '$shared/event-recovery/session';
import {
  fromWireMcpConfig,
  fromWireMcpStatus,
  resetSettingsConnectionCache,
  invalidateSettingsReadCache,
} from '$lib/client/live/live-settings-client';
import type { AppliedSettingChange, SettingsSnapshot } from '$lib/client/app-client';
import { store } from '$store/renderer/store';
import {
  selectHostAdministrationContext,
  selectPrincipalActionContext,
} from '../../principal/principal-selectors';
import { fastModeSupportReceived } from '../../provider-settings/provider-settings-slice';
import {
  settingsAuthorityRetired,
  settingsRecoveryInvalidated,
  settingsSnapshotReplacing,
  mcpRecoveryInvalidated,
} from '../settings-events-slice';

let retireCurrentOwners: (() => void) | undefined;
export function retireSettingsAuthority(): undefined {
  retireCurrentOwners?.();
  retireSettingsWork(false);
  resetSettingsConnectionCache();
  store.dispatch(settingsAuthorityRetired());
  return undefined;
}

let snapshotRevision = -1;
const pathRevisions = new Map<string, number>();
export function getSettingsSnapshotRevision(): number {
  return snapshotRevision;
}
export function recordSettingsSnapshotRevision(revision: number): void {
  snapshotRevision = Math.max(snapshotRevision, revision);
}

/** One owner for the global catalog and all of its protected mirrors. */
export function installSettingsRecovery() {
  const authority = selectPrincipalActionContext.select(store.state);
  retireSettingsWork(true);
  snapshotRevision = -1;
  pathRevisions.clear();
  const stop = rendererEventRecovery.onSession((scope) => {
    const isCurrent = () =>
      !!selectHostAdministrationContext.select(store.state) &&
      authority === selectPrincipalActionContext.select(store.state);
    if (!isCurrent()) return () => {};
    const stopAuthorityFailures = onSettingsAuthorityFailure(() => {
      if (isCurrent()) retireSettingsAuthority();
    });
    retireSettingsWork(true);
    let recovered = false;
    const owner = scope.registerResource<SettingsSnapshot>({
      key: GLOBAL_SETTINGS_RECOVERY_KEY,
      workspaceId: null,
      eventTypes: ['settings:changed'],
      sourceOrdered: true,
      isCurrent,
      read: async ({ request }) => {
        await waitForSettingsReads(GLOBAL_SETTINGS_RECOVERY_KEY);
        const snapshot = await request<SettingsSnapshot>('settings.list');
        if (!Array.isArray(snapshot.settings) || !snapshot.settings.length)
          throw new Error('Empty settings snapshot');
        return snapshot;
      },
      apply: (snapshot) => {
        recovered = true;
        snapshotRevision = snapshot.revision;
        pathRevisions.clear();
        invalidateSettingsReadCache();
        store.dispatch(settingsSnapshotReplacing());
        applySettingsChanges(snapshot.settings, snapshot.revision, true, true);
        store.dispatch(
          fastModeSupportReceived(
            snapshot.settings.some((s) => s.path === 'providers.fastMode' && s.type === 'object'),
          ),
        );
      },
      invalidate: () => {
        retireSettingsWork(true);
        invalidateSettingsReadCache();
        store.dispatch(settingsRecoveryInvalidated());
      },
      retire: retireSettingsAuthority,
      onEvent: (notification, lifetime) => {
        const params = notification.params as {
          event?: { data?: { changes?: AppliedSettingChange[]; revision?: number } };
        };
        const data = params.event?.data;
        if (!Array.isArray(data?.changes)) return;
        if (recovered && data.revision === undefined) {
          rendererEventRecovery.invalidate(GLOBAL_SETTINGS_RECOVERY_KEY);
          return;
        }
        const changes = data.changes.filter(
          ({ path }) =>
            data.revision === undefined ||
            data.revision >= (pathRevisions.get(path) ?? snapshotRevision),
        );
        if (!changes.length) return;
        lifetime.commit(() => {
          if (data.revision !== undefined)
            for (const { path } of changes) pathRevisions.set(path, data.revision);
          invalidateSettingsReadCache();
          // Complete synchronously; a background migration cannot escape the event receipt.
          applySettingsChanges(changes, data.revision, true);
        });
      },
    });
    const mcp = scope.registerResource({
      key: GLOBAL_MCP_RECOVERY_KEY,
      workspaceId: null,
      eventTypes: ['mcp.servers:status-changed'],
      isCurrent,
      read: async ({ request }) => {
        const authority = rendererEventRecovery.captureAuthority(GLOBAL_MCP_RECOVERY_KEY);
        await waitForSettingsReads(GLOBAL_MCP_RECOVERY_KEY);
        const wire = await request<{ servers: Parameters<typeof fromWireMcpConfig>[0][] }>(
          'mcp.servers.list',
        );
        const servers = wire.servers.flatMap((server) => {
          const config = fromWireMcpConfig(server);
          return config ? [copyServerForState(config)] : [];
        });
        const results = await Promise.allSettled(
          servers.flatMap((server) => {
            const serverId = server.id;
            if (!serverId) return [];
            return [
              request<{ status: Parameters<typeof fromWireMcpStatus>[1] }>(
                'mcp.servers.getStatus',
                { serverId },
              )
                .then(({ status }) => fromWireMcpStatus(serverId, status))
                .catch(async (error: unknown) => {
                  const failures =
                    error instanceof RecoveryRequestTimeoutError
                      ? [error, ...(await error.completion).errors]
                      : [error];
                  if (failures.some(isSettingsAuthorityError)) {
                    authority.commit(() => {
                      store.dispatch(mcpGlobalStateRetired());
                      return undefined;
                    });
                  }
                  // Clear known denied data immediately, but keep the physical
                  // read slot until every sibling has settled.
                  throw error;
                }),
            ];
          }),
        );
        const rejected = results.filter(
          (result): result is PromiseRejectedResult => result.status === 'rejected',
        );
        // Deadline failures still own physical driver work. Drain every timed-out
        // sibling before selecting an error, even when an earlier sibling failed.
        const completions = await Promise.all(
          rejected.flatMap(({ reason }) =>
            reason instanceof RecoveryRequestTimeoutError ? [reason.completion] : [],
          ),
        );
        if (!authority.isCurrent() || completions.some((completion) => completion.retired))
          throw new Error('MCP settings read authority retired');
        const failures = [
          ...rejected.map((result) => result.reason),
          ...completions.flatMap((completion) => completion.errors),
        ];
        if (failures.length) throw failures.find(isSettingsAuthorityError) ?? failures[0];
        const statuses = results.flatMap((result) =>
          result.status === 'fulfilled' ? [result.value] : [],
        );
        return { servers, statuses };
      },
      apply: ({ servers, statuses }) => {
        store.dispatch(setServers(servers));
        store.dispatch(clearAllErrorMessages());
        const mapped: Record<string, McpServerStatus> = {};
        for (const server of servers) {
          const status = statuses.find((status) => status?.serverId === server.id);
          const key = getMcpServerKey(server);
          mapped[key] = server.disabled
            ? 'disabled'
            : (status && mapDaemonMcpState(status.state)) || 'configured';
          if (status?.lastError) store.dispatch(setServerErrorMessage(key, status.lastError));
        }
        store.dispatch(bulkSetServerStatus(mapped));
      },
      invalidate: () => {
        store.dispatch(mcpRecoveryInvalidated());
      },
      retire: () => {
        store.dispatch(mcpGlobalStateRetired());
      },
      onEvent: (notification, lifetime) => {
        const params = notification.params as {
          event?: {
            data?: { serverId?: string; status?: Parameters<typeof fromWireMcpStatus>[1] };
          };
        };
        const data = params.event?.data;
        if (!data?.serverId) return;
        const status = fromWireMcpStatus(data.serverId, data.status);
        const server = store.state.mcpSettings.servers.find(
          (server) => server.id === data.serverId,
        );
        if (!status || !server) return;
        const mapped = mapDaemonMcpState(status.state);
        if (!mapped) return;
        lifetime.commit(() => {
          const key = getMcpServerKey(server);
          store.dispatch(setServerStatus(key, mapped));
          store.dispatch(
            status.lastError
              ? setServerErrorMessage(key, status.lastError)
              : clearServerErrorMessage(key),
          );
        });
      },
    });
    const disposeOwners = () => {
      owner.dispose();
      mcp.dispose();
    };
    retireCurrentOwners = disposeOwners;
    return () => {
      stopAuthorityFailures();
      if (retireCurrentOwners === disposeOwners) retireCurrentOwners = undefined;
      disposeOwners();
    };
  });
  return () => {
    stop();
    retireSettingsWork(false);
    resetSettingsConnectionCache();
    store.dispatch(settingsAuthorityRetired());
  };
}
