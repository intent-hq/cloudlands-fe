import { backendRequest } from './backend-transport';
import { createBackendDraftsClient } from './backend-drafts-client';
// Source AppClient class compatibility until renderer cutover. Resolve transport only on a call.
export class LiveDraftsClient {
  private readonly client = createBackendDraftsClient((...args) => backendRequest(...args));
  get = this.client.get;
  set = this.client.set;
  clear = this.client.clear;
}
