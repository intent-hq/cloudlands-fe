/**
 * Pending Agents Store
 *
 * Tracks agents that have been created but may not yet appear in workspace.agentSummary.
 * This is needed for the "stay on home page" feature where we create a workspace with
 * an initial agent and want to show it in the workspace list immediately.
 */

import type { WorkspaceAgentInfo } from '$shared/types';

interface PendingAgent extends WorkspaceAgentInfo {
  workspaceId: string;
  createdAt: number;
}

class PendingAgentsStore {
  // Map of workspaceId -> array of pending agents
  #pendingByWorkspace = $state<Map<string, PendingAgent[]>>(new Map());

  // Version for reactivity
  #version = $state(0);

  /**
   * Add a pending agent for a workspace
   */
  add(workspaceId: string, agent: Omit<WorkspaceAgentInfo, 'lastActivity'>): void {
    const pending: PendingAgent = {
      ...agent,
      workspaceId,
      status: agent.status || 'busy',
      lastActivity: new Date().toISOString(),
      createdAt: Date.now(),
    };

    const existing = this.#pendingByWorkspace.get(workspaceId) || [];
    // Avoid duplicates
    if (!existing.some((a) => a.id === agent.id)) {
      this.#pendingByWorkspace.set(workspaceId, [...existing, pending]);
      this.#version++;
    }
  }

  /**
   * Remove a pending agent (e.g., when it appears in agentSummary)
   */
  remove(workspaceId: string, agentId: string): void {
    const existing = this.#pendingByWorkspace.get(workspaceId);
    if (existing) {
      const filtered = existing.filter((a) => a.id !== agentId);
      if (filtered.length === 0) {
        this.#pendingByWorkspace.delete(workspaceId);
      } else {
        this.#pendingByWorkspace.set(workspaceId, filtered);
      }
      this.#version++;
    }
  }

  /**
   * Remove all pending agents for a workspace
   */
  clearWorkspace(workspaceId: string): void {
    if (this.#pendingByWorkspace.has(workspaceId)) {
      this.#pendingByWorkspace.delete(workspaceId);
      this.#version++;
    }
  }

  /**
   * Get pending agents for a workspace
   */
  getForWorkspace(workspaceId: string): WorkspaceAgentInfo[] {
    // Reference version for reactivity
    void this.#version;
    return this.#pendingByWorkspace.get(workspaceId) || [];
  }

  /**
   * Check if there are any pending agents for a workspace
   */
  hasForWorkspace(workspaceId: string): boolean {
    void this.#version;
    return (this.#pendingByWorkspace.get(workspaceId)?.length || 0) > 0;
  }

  /**
   * Get version for reactivity
   */
  get version(): number {
    return this.#version;
  }

  /**
   * Clean up old pending agents (older than 5 minutes)
   * Called periodically to prevent memory leaks
   */
  cleanup(): void {
    const now = Date.now();
    const maxAge = 5 * 60 * 1000; // 5 minutes
    let changed = false;

    for (const [workspaceId, agents] of this.#pendingByWorkspace) {
      const filtered = agents.filter((a) => now - a.createdAt < maxAge);
      if (filtered.length !== agents.length) {
        if (filtered.length === 0) {
          this.#pendingByWorkspace.delete(workspaceId);
        } else {
          this.#pendingByWorkspace.set(workspaceId, filtered);
        }
        changed = true;
      }
    }

    if (changed) {
      this.#version++;
    }
  }
}

export const pendingAgentsStore = new PendingAgentsStore();
