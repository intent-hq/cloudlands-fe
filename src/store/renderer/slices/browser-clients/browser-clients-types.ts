/**
 * Browser Clients Types (renderer)
 *
 * Renderer mirror of the daemon-owned REV-2 browser-client routing state:
 * this connection's own `clientId`, the live logical-client list
 * (`client.list`, refreshed on `client:connected` / `client:disconnected`),
 * and per workspace the effective browser client
 * (`workspace.getBrowserClient`) plus the daemon tab registry rows
 * (`browser.listTabs`, patched by `browser:tab-*` events).
 */

import {
  createCollection,
  type Collection,
} from '@augmentcode/themis/utils/collections/collection-utils';
import type { BrowserTab, LiveClient, WorkspaceBrowserClient } from '$shared/types/browser-clients';

export type LiveClientCollection = Collection<LiveClient, 'clientId'>;
/**
 * Registry rows as the daemon sent them: `browser.listTabs` rows carry the
 * `hostConnected` / `hostName` presence decoration (`BrowserTabListing`),
 * `browser:tab-*` event rows do not — both are stored verbatim.
 */
export type BrowserTabCollection = Collection<BrowserTab, 'tabId'>;

export type WorkspaceBrowserClientsState = {
  /** `workspace.getBrowserClient` result; null until the first read lands. */
  browserClient: WorkspaceBrowserClient | null;
  /** Daemon tab-registry rows for this workspace. */
  tabs: BrowserTabCollection;
};

export type BrowserClientsState = {
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

export const createBrowserTabCollection = (items?: BrowserTab[]): BrowserTabCollection =>
  createCollection('tabId', items);

export const emptyWorkspaceBrowserClientsState: WorkspaceBrowserClientsState = {
  browserClient: null,
  tabs: createBrowserTabCollection(),
};

export const initialState: BrowserClientsState = {
  ownClientId: null,
  liveClients: createLiveClientCollection(),
  liveClientsLoaded: false,
  byWorkspaceId: {},
};
