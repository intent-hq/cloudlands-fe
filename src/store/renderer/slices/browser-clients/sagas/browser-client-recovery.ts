import {
  rendererEventRecovery,
  type RendererRecoveryHandle,
} from '$features/events/renderer-event-recovery';
import { store } from '../../../store';
import { selectPrincipalActionContext } from '../../principal/principal-selectors';
import { isLiveClient, isWorkspaceBrowserClient } from '$shared/types/browser-clients';
import {
  browserClientsRetired,
  liveClientsReceived,
  workspaceBrowserClientReceived,
} from '../browser-clients-slice';

export const browserClientRecoveryKey = (workspaceId?: string) =>
  `browser-clients:${JSON.stringify([workspaceId ?? null])}`;

/** Same owner covers list, resolution, pin echoes and overlapping global events. */
export class BrowserClientRecovery {
  private readonly owners = new Map<
    string | undefined,
    { stop(): void; attached?: boolean; handle?: RendererRecoveryHandle }
  >();

  ensure(workspaceId?: string): void {
    if (this.owners.has(workspaceId)) return;
    const entry: { stop(): void; attached?: boolean; handle?: RendererRecoveryHandle } = {
      stop: () => {},
    };
    this.owners.set(workspaceId, entry);
    entry.stop = rendererEventRecovery.onSession((scope) => {
      const authority = selectPrincipalActionContext.select(store.state);
      const current = () =>
        this.owners.get(workspaceId) === entry &&
        authority === selectPrincipalActionContext.select(store.state);
      const handle = scope.registerResource({
        key: browserClientRecoveryKey(workspaceId),
        // Client presence is global. Workspace-only
        // matching would silently miss the loss that changes this resolution.
        workspaceId: null,
        eventTypes: [
          'client:connected',
          'client:disconnected',
          'client:updated',
          'workspace:updated',
        ],
        acceptsEvent: ({ params }) => {
          const event = (
            params as {
              event?: {
                type?: unknown;
                workspaceId?: unknown;
                data?: { changes?: { browserClientId?: unknown } };
              };
            } | null
          )?.event;
          if (event?.type !== 'workspace:updated') return true;
          if (!workspaceId || event.workspaceId !== workspaceId) return false;
          const pin = event.data?.changes?.browserClientId;
          return typeof pin === 'string' || pin === null;
        },
        isCurrent: current,
        read: async ({ request }) => {
          const reads = [
            request<{ clients: unknown }>('client.list', workspaceId ? { workspaceId } : undefined),
            workspaceId
              ? request<{ browserClient: unknown }>('workspace.getBrowserClient', { workspaceId })
              : undefined,
          ] as const;
          // Keep the cycle occupied until every sibling settles. A fast failure
          // must not start another roster read while this one is still live.
          const results = await Promise.allSettled(reads);
          const failures = results.filter((result) => result.status === 'rejected');
          const denied = failures.find(({ reason }) => {
            const error = reason as { rpcCode?: unknown; data?: { code?: unknown } } | null;
            return (
              error?.rpcCode === -32003 ||
              error?.rpcCode === -32001 ||
              (error?.rpcCode === -32602 && error.data?.code === 'not-found')
            );
          });
          if (denied) throw denied.reason;
          if (failures.length) throw failures[0].reason;
          const [roster, selection] = await Promise.all(reads);
          if (
            !Array.isArray(roster.clients) ||
            !roster.clients.every(isLiveClient) ||
            (selection && !isWorkspaceBrowserClient(selection.browserClient))
          )
            throw new Error('Invalid browser client recovery snapshot');
          return {
            clients: roster.clients,
            browserClient:
              selection && isWorkspaceBrowserClient(selection.browserClient)
                ? selection.browserClient
                : undefined,
          };
        },
        apply: ({ clients, browserClient }) => {
          store.dispatch(liveClientsReceived(clients, workspaceId));
          if (workspaceId && browserClient)
            store.dispatch(workspaceBrowserClientReceived(workspaceId, browserClient));
        },
        invalidate: () => {},
        retire: () => {
          store.dispatch(browserClientsRetired(workspaceId));
        },
      });
      entry.handle = handle;
      if (entry.attached) handle.refresh();
      entry.attached = true;
      return () => {
        handle.dispose();
        if (entry.handle === handle) entry.handle = undefined;
      };
    });
  }

  stale(workspaceId?: string): boolean {
    return this.owners.get(workspaceId)?.handle?.status.stale ?? false;
  }
  remove(workspaceId?: string): void {
    const entry = this.owners.get(workspaceId);
    this.owners.delete(workspaceId);
    entry?.stop();
  }
  rebind(): void {
    for (const workspaceId of [...this.owners.keys()]) {
      this.remove(workspaceId);
      this.ensure(workspaceId);
    }
  }
  dispose(): void {
    for (const workspaceId of this.owners.keys()) this.remove(workspaceId);
  }
}
