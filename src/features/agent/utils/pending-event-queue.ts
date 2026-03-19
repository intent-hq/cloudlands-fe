/**
 * PendingEventQueue
 *
 * Manages a queue of pending stream events per session. Events are queued when
 * no DOM handler is registered and replayed when a handler becomes available.
 *
 * This class only manages the queue data structure — it does NOT dispatch DOM
 * events. The caller (AgentService) is responsible for dispatching.
 */

interface PendingEvent {
  id: number;
  type: string;
  detail: any;
  timestamp: number;
}

export class PendingEventQueue {
  private sessions = new Map<string, PendingEvent[]>();
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;
  private nextEventId = 1;

  constructor(
    private readonly maxAge: number = 30_000,
    private readonly maxSize: number = 100,
    private readonly maxTotalEvents: number = 1000,
  ) {}

  /**
   * Queue a pending event for a session.
   * Filters expired events and enforces max queue size.
   */
  queue(sessionId: string, eventType: string, detail: any): void {
    const now = Date.now();

    if (!this.sessions.has(sessionId)) {
      this.sessions.set(sessionId, []);
    }

    const events = this.sessions.get(sessionId)!;

    // Remove expired events
    const validEvents = events.filter((e) => now - e.timestamp < this.maxAge);

    // Enforce max queue size
    if (validEvents.length >= this.maxSize) {
      // Remove oldest events to make room
      validEvents.shift();
    }

    validEvents.push({ id: this.nextEventId++, type: eventType, detail, timestamp: now });
    this.sessions.set(sessionId, validEvents);

    // Enforce global event limit
    this.enforceGlobalLimit();
  }

  /**
   * Replay (retrieve and clear) pending events for a session.
   *
   * Returns the valid (non-expired) events and removes them from the queue.
   * Uses a snapshot approach: events added during the caller's dispatch loop
   * are preserved (not removed).
   */
  replay(sessionId: string): Array<{ type: string; detail: any }> {
    const events = this.sessions.get(sessionId);
    if (!events || events.length === 0) {
      return [];
    }

    const now = Date.now();

    // Take a snapshot of valid events and their IDs
    const validEvents = events.filter((e) => now - e.timestamp < this.maxAge);
    const replayedIds = new Set(validEvents.map((e) => e.id));

    if (validEvents.length === 0) {
      this.sessions.delete(sessionId);
      return [];
    }

    // Build the result (without timestamps — caller doesn't need them)
    const result = validEvents.map((e) => ({ type: e.type, detail: e.detail }));

    // Remove only replayed events, preserving any new ones added during dispatch
    const currentQueue = this.sessions.get(sessionId);
    if (currentQueue) {
      const remainingEvents = currentQueue.filter((e) => !replayedIds.has(e.id));
      if (remainingEvents.length > 0) {
        this.sessions.set(sessionId, remainingEvents);
      } else {
        this.sessions.delete(sessionId);
      }
    }

    return result;
  }

  /** Clear pending events for a specific session. */
  clear(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  /** Clear all pending events across all sessions. */
  clearAll(): void {
    this.sessions.clear();
  }

  /** Check if a session has any pending events. */
  has(sessionId: string): boolean {
    const events = this.sessions.get(sessionId);
    return !!events && events.length > 0;
  }

  /** Get the number of pending events for a session. */
  getQueueSize(sessionId: string): number {
    return this.sessions.get(sessionId)?.length ?? 0;
  }

  /** Get the number of sessions with pending events. */
  getSessionCount(): number {
    return this.sessions.size;
  }

  /** Get the total number of pending events across all sessions. */
  getTotalEventCount(): number {
    let total = 0;
    for (const events of this.sessions.values()) {
      total += events.length;
    }
    return total;
  }

  /** Get stats for all sessions with pending events. */
  getAllSessionStats(): Array<{ sessionId: string; eventCount: number; oldestTimestamp: number }> {
    const stats: Array<{ sessionId: string; eventCount: number; oldestTimestamp: number }> = [];
    for (const [sessionId, events] of this.sessions) {
      if (events.length > 0) {
        stats.push({
          sessionId,
          eventCount: events.length,
          oldestTimestamp: events[0].timestamp,
        });
      }
    }
    return stats;
  }

  /**
   * Enforce the global event limit by dropping oldest events from the session
   * with the most events until we're under the limit.
   * Returns the number of events dropped.
   */
  enforceGlobalLimit(): number {
    let dropped = 0;
    while (this.getTotalEventCount() > this.maxTotalEvents) {
      // Find the session with the most events
      let largestSession: string | null = null;
      let largestCount = 0;
      for (const [sessionId, events] of this.sessions) {
        if (events.length > largestCount) {
          largestCount = events.length;
          largestSession = sessionId;
        }
      }
      if (!largestSession || largestCount === 0) break;

      const events = this.sessions.get(largestSession)!;
      events.shift(); // Drop oldest event
      dropped++;

      if (events.length === 0) {
        this.sessions.delete(largestSession);
      }
    }
    return dropped;
  }

  /**
   * Remove expired events from all sessions and delete empty session entries.
   * Returns the number of events removed and sessions cleaned.
   */
  cleanup(): { eventsRemoved: number; sessionsRemoved: number } {
    const now = Date.now();
    let eventsRemoved = 0;
    let sessionsRemoved = 0;

    for (const [sessionId, events] of this.sessions) {
      const validEvents = events.filter((e) => now - e.timestamp < this.maxAge);
      eventsRemoved += events.length - validEvents.length;

      if (validEvents.length === 0) {
        this.sessions.delete(sessionId);
        sessionsRemoved++;
      } else if (validEvents.length !== events.length) {
        this.sessions.set(sessionId, validEvents);
      }
    }

    return { eventsRemoved, sessionsRemoved };
  }

  /** Start periodic cleanup at the given interval. */
  startPeriodicCleanup(intervalMs: number = 60_000): void {
    this.stopPeriodicCleanup();
    this.cleanupTimer = setInterval(() => {
      this.cleanup();
    }, intervalMs);
  }

  /** Stop periodic cleanup. */
  stopPeriodicCleanup(): void {
    if (this.cleanupTimer !== null) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }
}

