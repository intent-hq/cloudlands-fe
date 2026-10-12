import {
  createReactWorkspaceDomainClient,
  type WorkspaceDomainClient,
} from './workspace-domain-client';
import { createElectronWorkspaceDomainReadTransport } from './workspace-domain-read-transport';

/**
 * Create once per consuming lifetime and retain the client for cache/deduplication.
 * Construction sends no requests and starts no listeners, timers or Store lifecycle.
 * The existing root owns Store/authority startup; consumers own deletion cleanup
 * and must stop using this client when their lifetime ends. No singleton is installed.
 * Without the preload, reads retain the canonical client's unavailable behavior.
 */
export function createElectronWorkspaceDomainClient(): WorkspaceDomainClient {
  return createReactWorkspaceDomainClient(createElectronWorkspaceDomainReadTransport());
}
