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
import { backendRequest } from '$lib/client/live/backend-transport';

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

  // Events received during a baseline read override that older snapshot.
  private scanUpdates: Map<string, ActiveStream | null> | null = null;

  // Version counter for reactivity
  private version = 0;

  // Shared refresh state prevents overlapping full-workspace scans.
  private inFlight: Promise<void> | null = null;
  private pendingRefresh = false;

  // Bumped by stopPolling() so refreshes in flight when polling stops neither
  // run a trailing scan nor mutate the maps after listeners are removed.
  private refreshGeneration = 0;

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

    this.isListening = true;
    logger.info('Started listening for active stream events');
  }

  /**
   * Stop listening to events
   */
  stopPolling(): void {
    if (!this.isListening) return;

    this.pendingRefresh = false;
    this.inFlight = null;
    this.refreshGeneration++;
    this.scanUpdates = null;
    this.updateStreams([]);

    this.isListening = false;
    logger.info('Stopped listening for active stream events');
  }

  /** Consumes the admitted workspace event stream, without legacy IPC relays. */
  applyEvent(event: {
    type: string;
    workspaceId?: string;
    sessionId?: string | null;
    timestamp: string;
    data?: Record<string, unknown>;
  }): void {
    if (!this.isListening) return;
    const data = event.data;
    const agentId = data?.agentId;
    if (typeof agentId !== 'string' || !event.workspaceId) return;
    const terminal = ['agent:idle', 'agent:failed', 'agent:deleted', 'agent:delete-scheduled'];
    let active: boolean;
    if (terminal.includes(event.type)) active = false;
    else if (event.type === 'agent:status-changed') {
      if (data?.isActive === true || data?.isResponding === true || data?.isStreaming === true)
        active = true;
      else if (
        data?.isActive === false ||
        ['idle', 'completed', 'error', 'failed', 'deleted', 'halted'].includes(String(data?.status))
      )
        active = false;
      else if (data?.status === 'active' || data?.status === 'responding') active = true;
      else return;
    } else return;
    const prior = this.allStreams.get(agentId);
    if (prior && prior.workspaceId !== event.workspaceId) return;
    const stream = active
      ? (prior ?? {
          agentId,
          sessionId: event.sessionId ?? agentId,
          workspaceId: event.workspaceId,
          startTime: Date.parse(event.timestamp),
        })
      : null;
    this.scanUpdates?.set(agentId, stream);
    const streams = new Map(this.allStreams);
    if (stream) streams.set(agentId, stream);
    else streams.delete(agentId);
    this.updateStreams([...streams.values()]);
  }

  /**
   * Fetch active streams from the backend
   */
  fetchActiveStreams(): Promise<void> {
    if (this.inFlight) {
      this.pendingRefresh = true;
      return this.inFlight;
    }

    const refresh = this.drainRefreshes(this.refreshGeneration);
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

  private async drainRefreshes(generation: number): Promise<void> {
    do {
      this.pendingRefresh = false;
      await this.fetchActiveStreamsOnce();
    } while (generation === this.refreshGeneration && this.pendingRefresh);
  }

  private async fetchActiveStreamsOnce(): Promise<void> {
    const generation = this.refreshGeneration;
    const updates = new Map<string, ActiveStream | null>();
    this.scanUpdates = updates;
    try {
      const result = await backendRequest<{ streams: ActiveStream[] }>('agent.listActive', {});

      if (generation !== this.refreshGeneration) return;

      if (Array.isArray(result.streams)) {
        const streams = new Map(result.streams.map((stream) => [stream.agentId, stream]));
        for (const [id, stream] of updates) {
          if (stream) streams.set(id, stream);
          else streams.delete(id);
        }
        this.updateStreams([...streams.values()]);
      }
    } catch (error) {
      logger.warn('Failed to fetch active streams', { error });
    } finally {
      if (this.scanUpdates === updates) this.scanUpdates = null;
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
