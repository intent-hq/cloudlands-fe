/**
 * RemoteRPCManager
 *
 * Singleton service that manages per-workspace RemoteRPCClient instances.
 * Lazily creates and caches clients, handling SSH connection setup and
 * socket path resolution for each workspace.
 */

import { Logger } from '../logger';
import { RemoteRPCClient } from './remote-rpc-client';
import { sshManager } from './ssh-manager';
import type { SSHConnectionConfig } from './ssh-manager';
import { getWorkspaceGitInfo } from '../../features/git/main/git-router';

const logger = new Logger('RemoteRPCManager');

/** Cached client entry with its SSH connection ID. */
interface ClientEntry {
  client: RemoteRPCClient;
  sshConnectionId: string;
}

class RemoteRPCManager {
  private clients = new Map<string, ClientEntry>();
  /** In-flight getClient() calls, keyed by workspaceId, to avoid duplicate connections. */
  private connecting = new Map<string, Promise<RemoteRPCClient>>();

  /**
   * Get (or lazily create) a connected RemoteRPCClient for the given workspace.
   * The client is cached — subsequent calls for the same workspaceId return the
   * same instance (reconnecting if the underlying socket has dropped).
   */
  async getClient(workspaceId: string, sshConfig?: SSHConnectionConfig): Promise<RemoteRPCClient> {
    // Return cached client if still connected
    const existing = this.clients.get(workspaceId);
    if (existing?.client.isConnected()) {
      return existing.client;
    }

    // Coalesce concurrent calls for the same workspace
    const inflight = this.connecting.get(workspaceId);
    if (inflight) {
      return inflight;
    }

    const promise = this.createClient(workspaceId, sshConfig);
    this.connecting.set(workspaceId, promise);

    try {
      const client = await promise;
      return client;
    } finally {
      this.connecting.delete(workspaceId);
    }
  }

  /**
   * Disconnect and remove the cached client for a workspace.
   */
  cleanup(workspaceId: string): void {
    const entry = this.clients.get(workspaceId);
    if (entry) {
      logger.info('Cleaning up RPC client', { workspaceId });
      entry.client.disconnect();
      this.clients.delete(workspaceId);
    }
  }

  /**
   * Disconnect all cached clients.
   */
  cleanupAll(): void {
    for (const [workspaceId, entry] of this.clients) {
      logger.info('Cleaning up RPC client', { workspaceId });
      entry.client.disconnect();
    }
    this.clients.clear();
  }

  // ---------------------------------------------------------------------------
  // Internal
  // ---------------------------------------------------------------------------

  private async createClient(workspaceId: string, sshConfig?: SSHConnectionConfig): Promise<RemoteRPCClient> {
    // 1. Get SSH config — use provided config (during workspace creation) or fall back to disk lookup
    let effectiveSshConfig: SSHConnectionConfig;
    if (sshConfig) {
      effectiveSshConfig = sshConfig;
    } else {
      const gitInfo = await getWorkspaceGitInfo(workspaceId);
      if (!gitInfo?.isRemote || !gitInfo.sshConfig) {
        throw new Error(`Workspace ${workspaceId} is not a remote workspace or has no SSH config`);
      }
      effectiveSshConfig = gitInfo.sshConfig;
    }

    // 2. Ensure SSH connection
    const sshConnectionId = `rpc-${workspaceId}`;
    const connections = sshManager.getConnections();
    const existing = connections.find((c) => c.id === sshConnectionId);
    if (!existing || !existing.connected) {
      await sshManager.connect(sshConnectionId, effectiveSshConfig);
    }

    // 3. Resolve $HOME on the remote host for the socket path
    const homeResult = await sshManager.executeCommand(sshConnectionId, 'echo $HOME', {
      timeout: 5000,
      rawCommand: true,
    });
    const remoteHome = homeResult.stdout.trim();
    if (!remoteHome) {
      throw new Error('Could not resolve remote $HOME for RPC socket path');
    }

    const socketPath = `${remoteHome}/.intent-server/workspaces/${workspaceId}/rpc.sock`;

    // 4. Create and connect the RPC client
    const client = new RemoteRPCClient(sshManager);
    await client.connect(sshConnectionId, socketPath);

    logger.info('RPC client connected', { workspaceId, socketPath });

    this.clients.set(workspaceId, { client, sshConnectionId });
    return client;
  }
}

/** Singleton instance. */
export const remoteRPCManager = new RemoteRPCManager();

