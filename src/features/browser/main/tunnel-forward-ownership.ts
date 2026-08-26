/**
 * Workspace ownership registry for tunnel forwards.
 *
 * Every `forwardPort` call made on behalf of a workspace records
 * workspaceId → provider + remotePort ownership via {@link wrapTunnelProviderWithOwnership}
 * (both providers, explicit `openTunnel` and the implicit navigate/openTab
 * tunnel fallback all go through the wrapped provider seam in browser.ipc.ts).
 * When a workspace is archived or deleted its owned forwards are closed —
 * refcount semantics: a remotePort shared by several workspaces closes only
 * when the LAST owning workspace goes away. Forwards opened with no
 * workspaceId are app-lifetime: they are never workspace-cleaned, even when
 * a workspace later shares the same port.
 */

import type { TunnelProvider } from './loopback-url-resolver';

/** Per-provider remotePort ownership: owning workspace ids plus an app-lifetime flag. */
interface PortOwnership {
  owners: Set<string>;
  /** True when any no-workspace caller forwarded this port (app-lifetime). */
  appOwned: boolean;
}

export interface OwnedForward {
  provider?: TunnelProvider;
  remotePort: number;
}

const DEFAULT_PROVIDER = Symbol('default-forward-provider');
type ProviderKey = TunnelProvider | typeof DEFAULT_PROVIDER;

/**
 * Tracks which workspace(s) own each provider + remotePort pair. Providers
 * from pooled backends may forward the same remote port independently, so
 * dropping one provider never erases another provider's ownership.
 */
export class ForwardOwnershipRegistry {
  private readonly providerPorts = new Map<ProviderKey, Map<number, PortOwnership>>();

  /**
   * Invoked when a workspace id is newly recorded as an owner of a port.
   * The cleanup service uses it to reconcile ownership recorded after its
   * owner's archive/delete event (the record-after-archive race,
   * monorepo#2646).
   */
  onWorkspaceOwnerRecorded?: (workspaceId: string) => void;

  /** Record a successful forward; no workspaceId marks the port app-lifetime. */
  record(remotePort: number, workspaceId?: string): void {
    this.recordForProviderKey(DEFAULT_PROVIDER, remotePort, workspaceId);
  }

  recordForProvider(provider: TunnelProvider, remotePort: number, workspaceId?: string): void {
    this.recordForProviderKey(provider, remotePort, workspaceId);
  }

  private recordForProviderKey(
    provider: ProviderKey,
    remotePort: number,
    workspaceId?: string,
  ): void {
    let ports = this.providerPorts.get(provider);
    if (!ports) {
      ports = new Map();
      this.providerPorts.set(provider, ports);
    }
    let entry = ports.get(remotePort);
    if (!entry) {
      entry = { owners: new Set(), appOwned: false };
      ports.set(remotePort, entry);
    }
    if (workspaceId) {
      const isNewOwner = !entry.owners.has(workspaceId);
      entry.owners.add(workspaceId);
      if (isNewOwner) this.onWorkspaceOwnerRecorded?.(workspaceId);
    } else {
      entry.appOwned = true;
    }
  }

  /** Drop all ownership for a port (its forward was explicitly closed). */
  clearPort(remotePort: number): void {
    for (const [provider, ports] of this.providerPorts) {
      ports.delete(remotePort);
      if (ports.size === 0) this.providerPorts.delete(provider);
    }
  }

  clearProviderPort(provider: TunnelProvider, remotePort: number): void {
    const ports = this.providerPorts.get(provider);
    if (!ports) return;
    ports.delete(remotePort);
    if (ports.size === 0) this.providerPorts.delete(provider);
  }

  /** Distinct workspace ids currently owning at least one forwarded port. */
  ownedWorkspaceIds(): string[] {
    const ids = new Set<string>();
    for (const ports of this.providerPorts.values()) {
      for (const entry of ports.values()) {
        for (const id of entry.owners) ids.add(id);
      }
    }
    return [...ids];
  }

  /**
   * Remove `workspaceId` from every port it owns and return the ports left
   * with no owners at all — the ones whose forwards should now be closed.
   * Ports still owned by other workspaces, and app-lifetime ports, stay open.
   */
  releaseWorkspace(workspaceId: string): number[] {
    return this.releaseWorkspaceForProviders(workspaceId).map(({ remotePort }) => remotePort);
  }

  releaseWorkspaceForProviders(workspaceId: string): OwnedForward[] {
    const closable: OwnedForward[] = [];
    for (const [provider, ports] of this.providerPorts) {
      for (const [remotePort, entry] of ports) {
        if (!entry.owners.delete(workspaceId)) continue;
        if (entry.owners.size > 0 || entry.appOwned) continue;
        ports.delete(remotePort);
        closable.push({
          provider: provider === DEFAULT_PROVIDER ? undefined : provider,
          remotePort,
        });
      }
      if (ports.size === 0) this.providerPorts.delete(provider);
    }
    return closable;
  }

  /** Drop everything (backend switch: the providers themselves are disposed). */
  reset(): void {
    this.providerPorts.clear();
  }
}

/**
 * Wrap a tunnel provider so successful `forwardPort` calls record ownership
 * for `workspaceId` (or app-lifetime when absent) and explicit `closeForward`
 * calls clear the port's ownership. The provider's `onForwardDropped` hook is
 * wired to `registry.clearProviderPort` so internal drops (refused connect/OPEN) also
 * clear ownership — a later re-mint of the same port starts with fresh
 * refcounts. Everything else passes through.
 */
export function wrapTunnelProviderWithOwnership(
  provider: TunnelProvider,
  registry: ForwardOwnershipRegistry,
  workspaceId?: string,
): TunnelProvider {
  // Assigned on the inner provider (shared across per-workspace wrappers):
  // every wrapper wires the same registry, so re-assignment is idempotent.
  provider.onForwardDropped = (remotePort: number): void => {
    registry.clearProviderPort(provider, remotePort);
  };
  const wrapped: TunnelProvider = {
    async forwardPort(remotePort: number): Promise<number> {
      const localPort = await provider.forwardPort(remotePort);
      registry.recordForProvider(provider, remotePort, workspaceId);
      return localPort;
    },
  };
  const activeForwards = provider.activeForwards?.bind(provider);
  if (activeForwards) {
    wrapped.activeForwards = activeForwards;
  }
  const closeForward = provider.closeForward?.bind(provider);
  if (closeForward) {
    wrapped.closeForward = (remotePort: number): boolean => {
      const closed = closeForward(remotePort);
      // Clear even when the provider reports no forward: it may have dropped
      // it internally already, and stale ownership must not survive.
      registry.clearProviderPort(provider, remotePort);
      return closed;
    };
  }
  if (provider.backend !== undefined) {
    wrapped.backend = provider.backend;
  }
  return wrapped;
}
