/**
 * Unread Tracking Service
 *
 * Manages unread state for agent messages. An agent is marked as "unread" when:
 * - A new assistant message arrives AND the user is not currently viewing that agent
 *
 * An agent is marked as "read" when:
 * - The user opens/views that agent in the drawer
 *
 * State is persisted to localStorage for survival across app refreshes.
 *
 * The service also tracks which workspace each unread agent belongs to, enabling
 * workspace tabs to show unread indicators for agents in other workspaces.
 */

import { createLogger } from '$lib/utils/client-logger';

const logger = createLogger('UnreadTrackingService');

const STORAGE_KEY = 'augment:unread-agents';
// New storage key for workspace mapping (stores { agentId: workspaceId } pairs)
const WORKSPACE_MAP_STORAGE_KEY = 'augment:unread-agents-workspaces';

// Maximum number of unread agent IDs to store (prevents unbounded growth)
const MAX_UNREAD_AGENTS = 100;

class UnreadTrackingService {
  // Track which agent is currently being viewed (drawer open with this agent)
  private currentlyViewedAgentId: string | null = null;

  // Track unread state per agent
  private unreadAgents: Set<string>;

  // Map agent IDs to their workspace IDs (for cross-workspace tab indicators)
  private agentWorkspaceMap: Map<string, string>;

  // Listeners for unread count changes
  private listeners = new Set<(count: number) => void>();

  // Callback to validate agent IDs (set externally to avoid circular deps)
  private agentExistsCallback: ((agentId: string) => boolean) | null = null;

  constructor() {
    // Load persisted state from localStorage
    this.unreadAgents = this.loadFromStorage();
    this.agentWorkspaceMap = this.loadWorkspaceMapFromStorage();
  }

  /**
   * Set a callback to validate whether an agent ID still exists.
   * This callback is stored for potential future use but we do NOT prune immediately.
   *
   * IMPORTANT: We used to call pruneStaleAgents() here, but this caused a critical bug:
   * The session store only contains agents for the CURRENT workspace after page load.
   * Agents from other workspaces are not loaded into the session store, so they would
   * incorrectly be marked as "stale" and removed from the unread set.
   *
   * Instead, we rely on explicit clearUnread() calls when agents are actually deleted.
   * This is already handled in agent.service.ts when deleteSession/deleteAgent is called.
   */
  setAgentExistsCallback(callback: (agentId: string) => boolean): void {
    this.agentExistsCallback = callback;
    // NOTE: Intentionally NOT calling pruneStaleAgents() here.
    // See comment above for why this was removed.
  }

  /**
   * Remove agent IDs from the set that no longer exist.
   *
   * NOTE: This method is currently not called. We used to call it from setAgentExistsCallback,
   * but that caused issues with cross-workspace agents being incorrectly pruned.
   * We keep this method for potential future use if we implement proper async validation
   * that queries the backend for all workspaces.
   */
  private pruneStaleAgents(): void {
    if (!this.agentExistsCallback) return;

    const before = this.unreadAgents.size;
    const staleIds: string[] = [];

    for (const agentId of this.unreadAgents) {
      if (!this.agentExistsCallback(agentId)) {
        staleIds.push(agentId);
      }
    }

    if (staleIds.length > 0) {
      for (const id of staleIds) {
        this.unreadAgents.delete(id);
      }
      this.saveToStorage();
      logger.info('Pruned stale unread agent IDs', {
        before,
        after: this.unreadAgents.size,
        pruned: staleIds.length,
      });
    }
  }

  /**
   * Check if localStorage is available (not available in Electron main process)
   */
  private isLocalStorageAvailable(): boolean {
    return typeof localStorage !== 'undefined';
  }

  /**
   * Load unread agent IDs from localStorage
   */
  private loadFromStorage(): Set<string> {
    if (!this.isLocalStorageAvailable()) {
      return new Set();
    }
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) {
          logger.debug('Loaded unread agents from storage', { count: parsed.length });
          return new Set(parsed);
        }
      }
    } catch (err) {
      logger.warn('Failed to load unread agents from storage', err);
    }
    return new Set();
  }

  /**
   * Load agent-to-workspace mapping from localStorage
   */
  private loadWorkspaceMapFromStorage(): Map<string, string> {
    if (!this.isLocalStorageAvailable()) {
      return new Map();
    }
    try {
      const stored = localStorage.getItem(WORKSPACE_MAP_STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (typeof parsed === 'object' && parsed !== null) {
          const map = new Map<string, string>(Object.entries(parsed));
          logger.debug('Loaded agent workspace map from storage', { count: map.size });
          return map;
        }
      }
    } catch (err) {
      logger.warn('Failed to load agent workspace map from storage', err);
    }
    return new Map();
  }

  /**
   * Persist unread agent IDs to localStorage
   */
  private saveToStorage(): void {
    if (!this.isLocalStorageAvailable()) {
      return;
    }
    try {
      const data = Array.from(this.unreadAgents);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));

      // Also save the workspace map (only for agents that are still unread)
      const workspaceMapData: Record<string, string> = {};
      for (const agentId of this.unreadAgents) {
        const workspaceId = this.agentWorkspaceMap.get(agentId);
        if (workspaceId) {
          workspaceMapData[agentId] = workspaceId;
        }
      }
      localStorage.setItem(WORKSPACE_MAP_STORAGE_KEY, JSON.stringify(workspaceMapData));
    } catch (err) {
      logger.warn('Failed to save unread agents to storage', err);
    }
  }

  /**
   * Mark an agent as currently being viewed (drawer is open with this agent)
   * This clears the unread status for that agent
   */
  markAsViewed(agentId: string): void {
    if (!agentId) return;

    this.currentlyViewedAgentId = agentId;

    // Clear unread status
    if (this.unreadAgents.has(agentId)) {
      this.unreadAgents.delete(agentId);
      this.saveToStorage();
      logger.debug('Agent marked as read', { agentId });
      this.notifyListeners();
    }
  }

  /**
   * Mark that no agent is currently being viewed (drawer closed or switched to different content)
   */
  clearCurrentlyViewed(): void {
    this.currentlyViewedAgentId = null;
  }

  /**
   * Called when a new assistant message arrives
   * If the user is not viewing this agent, mark it as unread
   *
   * @param agentId - The agent ID that received a new message
   * @param workspaceId - Optional workspace ID for the agent (enables cross-workspace tab indicators)
   * @param isBackground - Optional flag to indicate if this is a background agent (background agents are not marked as unread)
   */
  onNewAssistantMessage(agentId: string, workspaceId?: string, isBackground?: boolean): void {
    if (!agentId) return;

    // Background agents should not be marked as unread - they have their own UI treatment
    if (isBackground) {
      logger.debug('Skipping unread mark - background agent', { agentId });
      return;
    }

    // Store the workspace mapping even if agent is currently viewed
    // (we may need it later when agent becomes unread)
    if (workspaceId) {
      this.agentWorkspaceMap.set(agentId, workspaceId);
    }

    // Don't mark as unread if user is currently viewing this agent
    if (this.currentlyViewedAgentId === agentId) {
      logger.info('Skipping unread mark - agent is currently viewed', {
        agentId,
        currentlyViewedAgentId: this.currentlyViewedAgentId,
      });
      return;
    }

    // Mark as unread (with size limit enforcement)
    if (!this.unreadAgents.has(agentId)) {
      // If we're at the limit, remove oldest entries (FIFO - Sets maintain insertion order)
      if (this.unreadAgents.size >= MAX_UNREAD_AGENTS) {
        const iterator = this.unreadAgents.values();
        const oldest = iterator.next().value;
        if (oldest) {
          this.unreadAgents.delete(oldest);
          // Also clean up the workspace map
          this.agentWorkspaceMap.delete(oldest);
          logger.info('Removed oldest unread agent to stay within limit', { removed: oldest });
        }
      }

      this.unreadAgents.add(agentId);
      this.saveToStorage();
      logger.info('Agent marked as unread', {
        agentId,
        workspaceId,
        currentlyViewedAgentId: this.currentlyViewedAgentId,
        unreadCount: this.unreadAgents.size,
      });
      this.notifyListeners();
    } else {
      logger.info('Agent already marked as unread', { agentId });
    }
  }

  /**
   * Check if an agent has unread messages
   */
  hasUnread(agentId: string): boolean {
    return this.unreadAgents.has(agentId);
  }

  /**
   * Get the count of agents with unread messages
   */
  getUnreadCount(): number {
    return this.unreadAgents.size;
  }

  /**
   * Get all agent IDs with unread messages
   */
  getUnreadAgentIds(): string[] {
    return Array.from(this.unreadAgents);
  }

  /**
   * Get unread agent IDs for a specific workspace
   * Returns agent IDs that are both unread AND belong to the specified workspace
   */
  getUnreadAgentIdsForWorkspace(workspaceId: string): string[] {
    const result: string[] = [];
    for (const agentId of this.unreadAgents) {
      const agentWorkspaceId = this.agentWorkspaceMap.get(agentId);
      if (agentWorkspaceId === workspaceId) {
        result.push(agentId);
      }
    }
    return result;
  }

  /**
   * Get the workspace ID for an unread agent (if known)
   */
  getWorkspaceForAgent(agentId: string): string | undefined {
    return this.agentWorkspaceMap.get(agentId);
  }

  /**
   * Subscribe to unread count changes
   */
  subscribe(listener: (count: number) => void): () => void {
    this.listeners.add(listener);
    // Defer the initial notification to avoid Svelte effect depth errors
    // when the listener triggers reactive updates synchronously
    queueMicrotask(() => {
      if (this.listeners.has(listener)) {
        listener(this.getUnreadCount());
      }
    });
    return () => this.listeners.delete(listener);
  }

  /**
   * Clear unread status for an agent (e.g., when agent is deleted)
   */
  clearUnread(agentId: string): void {
    if (this.unreadAgents.has(agentId)) {
      this.unreadAgents.delete(agentId);
      this.agentWorkspaceMap.delete(agentId);
      this.saveToStorage();
      this.notifyListeners();
    }
    if (this.currentlyViewedAgentId === agentId) {
      this.currentlyViewedAgentId = null;
    }
  }

  /**
   * Clear unread status for all agents in a specific workspace
   */
  clearUnreadForWorkspace(workspaceId: string): void {
    const agentsToClear = this.getUnreadAgentIdsForWorkspace(workspaceId);
    if (agentsToClear.length === 0) return;

    for (const agentId of agentsToClear) {
      this.unreadAgents.delete(agentId);
      this.agentWorkspaceMap.delete(agentId);
    }
    this.saveToStorage();
    logger.debug('Cleared unread agents for workspace', { workspaceId, count: agentsToClear.length });
    this.notifyListeners();
  }

  /**
   * Clear all unread status
   */
  clearAll(): void {
    this.unreadAgents.clear();
    this.agentWorkspaceMap.clear();
    this.saveToStorage();
    this.currentlyViewedAgentId = null;
    this.notifyListeners();
  }

  private notifyListeners(): void {
    const count = this.getUnreadCount();
    for (const listener of this.listeners) {
      try {
        listener(count);
      } catch (err) {
        logger.error('Error in unread listener', err);
      }
    }
  }
}

export const unreadTrackingService = new UnreadTrackingService();
