import {
  rendererEventRecovery,
  type RendererRecoveryHandle,
} from '$features/events/renderer-event-recovery';
import { isBrowserTabListing, type BrowserTabInput } from '$shared/types/browser-clients';
import { store } from '../../../store';
import { selectPrincipalActionContext } from '../../principal/principal-selectors';
import { browserTabSnapshotReceived } from '../../browser-clients/browser-clients-slice';

export const browserTabRecoveryKey = (workspaceId: string) =>
  `browser-tabs:${JSON.stringify([workspaceId])}`;

export class BrowserTabRecovery {
  private readonly owners = new Map<
    string,
    { stop(): void; attached?: boolean; handle?: RendererRecoveryHandle }
  >();
  ensure(workspaceId: string): void {
    if (this.owners.has(workspaceId)) return;
    const entry: { stop(): void; attached?: boolean; handle?: RendererRecoveryHandle } = {
      stop: () => {},
    };
    this.owners.set(workspaceId, entry);
    entry.stop = rendererEventRecovery.onSession((scope) => {
      const authority = selectPrincipalActionContext.select(store.state);
      const owner = scope.registerResource({
        key: browserTabRecoveryKey(workspaceId),
        workspaceId,
        eventTypes: ['browser:tab-opened', 'browser:tab-updated', 'browser:tab-closed'],
        isCurrent: () =>
          this.owners.get(workspaceId) === entry &&
          authority === selectPrincipalActionContext.select(store.state),
        read: async ({ request }) => {
          const result = await request<{ tabs: unknown }>('browser.listTabs', { workspaceId });
          if (
            !Array.isArray(result.tabs) ||
            !result.tabs.every(isBrowserTabListing) ||
            result.tabs.some((row) => row.workspaceId !== workspaceId)
          )
            throw new Error('Invalid browser tab recovery snapshot');
          return result.tabs;
        },
        apply: (rows) => {
          const own = store.state.browserClients.ownClientId ?? '';
          const closing = Object.keys(store.state.browserTabRegistry.closing);
          const reported: Record<string, BrowserTabInput> = {};
          for (const row of rows)
            if (row.hostClientId === own && !closing.includes(row.tabId))
              reported[row.tabId] = {
                tabId: row.tabId,
                workspaceId,
                url: row.url,
                requestedUrl: row.requestedUrl ?? null,
                title: row.title ?? null,
                ownerAgentId: row.ownerAgentId ?? null,
                ownerAgentName: row.ownerAgentName ?? null,
                visibility: row.visibility,
                emulatedSize: row.emulatedSize ?? null,
                displayed: row.displayed ?? null,
              };
          store.dispatch(
            browserTabSnapshotReceived(workspaceId, rows, own, closing, reported, Date.now()),
          );
        },
        invalidate: () => {},
        retire: () => {
          store.dispatch(browserTabSnapshotReceived(workspaceId, [], '', [], {}, Date.now(), true));
        },
      });
      entry.handle = owner;
      if (entry.attached) owner.refresh();
      entry.attached = true;
      return () => {
        owner.dispose();
        if (entry.handle === owner) entry.handle = undefined;
      };
    });
  }
  stale(workspaceId: string): boolean {
    return this.owners.get(workspaceId)?.handle?.status.stale ?? false;
  }
  remove(workspaceId: string): void {
    const entry = this.owners.get(workspaceId);
    this.owners.delete(workspaceId);
    entry?.stop();
  }
  dispose(): void {
    for (const id of this.owners.keys()) this.remove(id);
  }
}
