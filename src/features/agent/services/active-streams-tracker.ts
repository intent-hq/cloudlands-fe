/**
 * Active Streams Tracker
 *
 * Tracks which agents are currently streaming across ALL workspaces.
 * Uses event-driven updates instead of polling for efficiency.
 *
 * This service is needed because:
 * - Redux state only has agents loaded for workspaces that have been viewed
 * - When switching between workspace tabs, we need to show streaming indicators
 *   for agents in workspaces that aren't currently loaded in memory
 */

import { createLogger } from '$lib/utils/client-logger';
import { on, off } from '$lib/electron-bridge';
import { invoke as invokeIpc } from '../../../shared/generated/ipc-client';

const logger = createLogger('ActiveStreamsTracker');

export interface ActiveStream {
  agentId: string;
  sessionId: string;
  workspaceId: string;
  startTime: number;
}

class ActiveStreamsTracker {
  // Map of workspaceId -> Set of agentIds that are streaming
  private streamsByWorkspace = new Map<string, Set<string>>();

  // All active streams (for quick lookup)
  private allStreams = new Map<string, ActiveStream>();

  // Listeners for changes
  private listeners = new Set<() => void>();

  // Whether we're currently listening to events
  private isListening = false;

  // Event handlers (stored for cleanup)
  private statusChangedHandler: ((data: any) => void) | null = null;
  private idleHandler: ((data: any) => void) | null = null;

  // Version counter for reactivity
  private version = 0;

  // Shared refresh state prevents overlapping full-workspace scans.
  private inFlight: Promise<void> | null = null;
  private pendingRefresh = false;

  /**
   * Start listening for stream events from the backend.
   * This replaces the old polling approach with event-driven updates.
   * @param _intervalMs - Deprecated, kept for API compatibility
   */
  startPolling(): void {
    // Only set up event listeners once
    if (this.isListening) return;

    // Fetch fresh state once when event listening starts
    this.fetchActiveStreams();

    // Set up event listeners for stream state changes
    this.statusChangedHandler = (data: any) => {
      logger.debug('Received agent:status-changed event', { data });
      // Refresh the full state when any agent status changes
      this.fetchActiveStreams();
    };

    this.idleHandler = (data: any) => {
      logger.debug('Received agent:idle event', { data });
      // Refresh the full state when an agent goes idle
      this.fetchActiveStreams();
    };

    on('agent:status-changed', this.statusChangedHandler);
    on('agent:idle', this.idleHandler);

    this.isListening = true;
    logger.info('Started listening for active stream events');
  }

  /**
   * Stop listening to events
   */
  stopPolling(): void {
    if (!this.isListening) return;

    if (this.statusChangedHandler) {
      off('agent:status-changed', this.statusChangedHandler);
      this.statusChangedHandler = null;
    }
    if (this.idleHandler) {
      off('agent:idle', this.idleHandler);
      this.idleHandler = null;
    }

    this.isListening = false;
    logger.info('Stopped listening for active stream events');
  }

  /**
   * Fetch active streams from the backend
   */
  fetchActiveStreams(): Promise<void> {
    if (typeof window === 'undefined' || !window.electronAPI) return Promise.resolve();

    if (this.inFlight) {
      this.pendingRefresh = true;
      return this.inFlight;
    }

    const refresh = this.drainRefreshes();
    this.inFlight = refresh;
    refresh.then(
      () => {
        if (this.inFlight === refresh) this.inFlight = null;
      },
      () => {
        if (this.inFlight === refresh) this.inFlight = null;
      },
    );
    return refresh;
  }

  private async drainRefreshes(): Promise<void> {
    do {
      this.pendingRefresh = false;
      await this.fetchActiveStreamsOnce();
    } while (this.pendingRefresh);
  }

  private async fetchActiveStreamsOnce(): Promise<void> {
    try {
      const result = await invokeIpc<{ success: boolean; data?: unknown }>(
        'agent:get-active-streams',
      );

      if (result.success && Array.isArray(result.data)) {
        this.updateStreams(result.data);
      }
    } catch (error) {
      logger.warn('Failed to fetch active streams', { error });
    }
  }

  /**
   * Update the tracked streams
   */
  private updateStreams(streams: ActiveStream[]): void {
    const newStreamsByWorkspace = new Map<string, Set<string>>();
    const newAllStreams = new Map<string, ActiveStream>();

    for (const stream of streams) {
      // Add to all streams
      newAllStreams.set(stream.agentId, stream);

      // Add to workspace map
      let workspaceStreams = newStreamsByWorkspace.get(stream.workspaceId);
      if (!workspaceStreams) {
        workspaceStreams = new Set();
        newStreamsByWorkspace.set(stream.workspaceId, workspaceStreams);
      }
      workspaceStreams.add(stream.agentId);
    }

    // Check if anything changed
    const changed =
      this.allStreams.size !== newAllStreams.size ||
      [...newAllStreams.keys()].some((id) => !this.allStreams.has(id)) ||
      [...this.allStreams.keys()].some((id) => !newAllStreams.has(id));

    if (changed) {
      this.streamsByWorkspace = newStreamsByWorkspace;
      this.allStreams = newAllStreams;
      this.version++;
      this.notifyListeners();

      logger.debug('Active streams updated', {
        totalStreams: newAllStreams.size,
        workspaces: Array.from(newStreamsByWorkspace.keys()),
      });
    }
  }

  /**
   * Get streaming agent IDs for a specific workspace
   */
  getStreamingAgentIdsForWorkspace(workspaceId: string): string[] {
    const streams = this.streamsByWorkspace.get(workspaceId);
    return streams ? Array.from(streams) : [];
  }

  /**
   * Check if an agent is streaming
   */
  isAgentStreaming(agentId: string): boolean {
    return this.allStreams.has(agentId);
  }

  /**
   * Subscribe to changes
   */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notifyListeners(): void {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch (err) {
        logger.error('Error in active streams listener', err);
      }
    }
  }

  /**
   * Get current version (for reactivity)
   */
  getVersion(): number {
    return this.version;
  }
}

export const activeStreamsTracker = new ActiveStreamsTracker();
