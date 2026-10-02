/**
 * Browser Clients Types (renderer)
 *
 * Renderer mirror of the daemon-owned REV-2 browser-client routing state:
 * this connection's own `clientId`, the live logical-client list
 * (`client.list`, refreshed on `client:connected` / `client:disconnected`),
 * and per workspace the effective browser client
 * (`workspace.getBrowserClient`) plus a `browser:tab-*` event counter the
 * panel-layout registry saga stamps on its `browser.listTabs` reads.
 */

import {
  createCollection,
  type Collection,
} from '@themislib/themis/utils/collections/collection-utils';
import type { LiveClient, WorkspaceBrowserClient } from '$shared/types/browser-clients';

export type LiveClientCollection = Collection<LiveClient, 'clientId'>;
type AuthenticatedClient = LiveClient & { deviceKey: string };
type AuthenticatedClientCollection = Collection<AuthenticatedClient, 'deviceKey'>;

export type WorkspaceBrowserClientsState = {
  /** `workspace.getBrowserClient` result; null until the first read lands. */
  browserClient: WorkspaceBrowserClient | null;
  liveClients?: LiveClientCollection;
  liveClientsLoaded?: boolean;
  /**
   * Bumped by every `browser:tab-*` event. The panel-layout registry saga
   * reads it before and after a `browser.listTabs` read: a changed value
   * means the listing may predate an event, so it is re-read.
   */
  tabsRevision: number;
};

export type BrowserClientsState = {
  /** Current-person Devices projection; browser routing retains raw client IDs below. */
  authenticatedContext?: string | null;
  authenticatedClients?: AuthenticatedClientCollection;
  /** The `clientId` this renderer's connection presents on `client.hello`. */
  ownClientId: string | null;
  /** `client.list` snapshot; empty until the first read lands. */
  liveClients: LiveClientCollection;
  /** True once a `client.list` read has completed at least once. */
  liveClientsLoaded: boolean;
  byWorkspaceId: Record<string, WorkspaceBrowserClientsState>;
};

export const createLiveClientCollection = (items?: LiveClient[]): LiveClientCollection =>
  createCollection('clientId', items);

export const createAuthenticatedClientCollection = (
  items: LiveClient[] = [],
): AuthenticatedClientCollection =>
  createCollection(
    'deviceKey',
    items.map((item) => ({
      ...item,
      deviceKey: JSON.stringify([item.principalId, item.clientId]),
    })),
  );

export const emptyWorkspaceBrowserClientsState: WorkspaceBrowserClientsState = {
  browserClient: null,
  tabsRevision: 0,
};

export const initialState: BrowserClientsState = {
  authenticatedClients: createAuthenticatedClientCollection(),
  ownClientId: null,
  liveClients: createLiveClientCollection(),
  liveClientsLoaded: false,
  byWorkspaceId: {},
};
