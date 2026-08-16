/**
 * Workspace ownership registry for tunnel forwards.
 *
 * Every `forwardPort` call made on behalf of a workspace records
 * workspaceId → remotePort ownership via {@link wrapTunnelProviderWithOwnership}
 * (both providers, explicit `openTunnel` and the implicit navigate/openTab
 * tunnel fallback all go through the wrapped provider seam in browser.ipc.ts).
 * When a workspace is archived or deleted its owned forwards are closed —
 * refcount semantics: a remotePort shared by several workspaces closes only
 * when the LAST owning workspace goes away. Forwards opened with no
 * workspaceId are app-lifetime: they are never workspace-cleaned, even when
 * a workspace later shares the same port.
 */

import type { TunnelProvider } from './loopback-url-resolver';

/** Per-remotePort ownership: owning workspace ids plus an app-lifetime flag. */
interface PortOwnership {
  owners: Set<string>;
  /** True when any no-workspace caller forwarded this port (app-lifetime). */
  appOwned: boolean;
}

/**
 * Tracks which workspace(s) own each forwarded remote port. One registry per
 * backend connection: browser.ipc.ts resets it on backend switch alongside
 * the providers, so ownership never outlives the forwards it describes.
 */
export class ForwardOwnershipRegistry {
  private readonly ports = new Map<number, PortOwnership>();

  /** Record a successful forward; no workspaceId marks the port app-lifetime. */
  record(remotePort: number, workspaceId?: string): void {
    let entry = this.ports.get(remotePort);
    if (!entry) {
      entry = { owners: new Set(), appOwned: false };
      this.ports.set(remotePort, entry);
    }
    if (workspaceId) {
      entry.owners.add(workspaceId);
    } else {
      entry.appOwned = true;
    }
  }

  /** Drop all ownership for a port (its forward was explicitly closed). */
  clearPort(remotePort: number): void {
    this.ports.delete(remotePort);
  }

  /** Distinct workspace ids currently owning at least one forwarded port. */
  ownedWorkspaceIds(): string[] {
    const ids = new Set<string>();
    for (const entry of this.ports.values()) {
      for (const id of entry.owners) ids.add(id);
    }
    return [...ids];
  }

  /**
   * Remove `workspaceId` from every port it owns and return the ports left
   * with no owners at all — the ones whose forwards should now be closed.
   * Ports still owned by other workspaces, and app-lifetime ports, stay open.
   */
  releaseWorkspace(workspaceId: string): number[] {
    const closable: number[] = [];
    for (const [remotePort, entry] of this.ports) {
      if (!entry.owners.delete(workspaceId)) continue;
      if (entry.owners.size > 0 || entry.appOwned) continue;
      this.ports.delete(remotePort);
      closable.push(remotePort);
    }
    return closable;
  }

  /** Drop everything (backend switch: the providers themselves are disposed). */
  reset(): void {
    this.ports.clear();
  }
}

/**
 * Wrap a tunnel provider so successful `forwardPort` calls record ownership
 * for `workspaceId` (or app-lifetime when absent) and explicit `closeForward`
 * calls clear the port's ownership. The provider's `onForwardDropped` hook is
 * wired to `registry.clearPort` so internal drops (refused connect/OPEN) also
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
    registry.clearPort(remotePort);
  };
  const wrapped: TunnelProvider = {
    async forwardPort(remotePort: number): Promise<number> {
      const localPort = await provider.forwardPort(remotePort);
      registry.record(remotePort, workspaceId);
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
      registry.clearPort(remotePort);
      return closed;
    };
  }
  if (provider.backend !== undefined) {
    wrapped.backend = provider.backend;
  }
  return wrapped;
}
