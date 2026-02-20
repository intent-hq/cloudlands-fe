/**
 * Shared Polling Manager for TaskAgentStatus components
 *
 * This manager consolidates polling for all TaskAgentStatus components into a single
 * interval, reducing CPU usage when multiple task agents are active simultaneously.
 *
 * Instead of each component having its own 500ms interval (which causes N intervals
 * for N components), this manager uses a single interval and notifies all registered
 * callbacks on each tick.
 */

import { createLogger } from '$lib/utils/client-logger';

const logger = createLogger('TaskAgentPollingManager');

type PollCallback = () => void;

// Polling configuration
const POLL_INTERVAL_MS = 500;

class TaskAgentPollingManager {
  private callbacks = new Map<string, PollCallback>();
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private rafId: number | null = null;
  private isPending = false;

  /**
   * Register a callback to be called on each poll tick.
   * @param id Unique identifier for this callback (usually agentId)
   * @param callback Function to call on each poll tick
   */
  register(id: string, callback: PollCallback): void {
    this.callbacks.set(id, callback);
    this.startIfNeeded();
  }

  /**
   * Unregister a callback.
   * @param id The identifier used when registering
   */
  unregister(id: string): void {
    this.callbacks.delete(id);
    this.stopIfEmpty();
  }

  /**
   * Start the polling interval if not already running.
   */
  private startIfNeeded(): void {
    if (this.intervalId !== null) return;
    if (this.callbacks.size === 0) return;

    this.intervalId = setInterval(() => {
      this.tick();
    }, POLL_INTERVAL_MS);
  }

  /**
   * Stop the polling interval if no callbacks are registered.
   */
  private stopIfEmpty(): void {
    if (this.callbacks.size > 0) return;
    if (this.intervalId === null) return;

    clearInterval(this.intervalId);
    this.intervalId = null;

    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.isPending = false;
  }

  /**
   * Called on each interval tick. Uses requestAnimationFrame to batch
   * all callback invocations into a single frame.
   */
  private tick(): void {
    // Skip if we already have a pending RAF
    if (this.isPending) return;
    this.isPending = true;

    this.rafId = requestAnimationFrame(() => {
      this.isPending = false;
      this.rafId = null;

      // Call all registered callbacks
      // Use a copy of the callbacks to avoid issues if callbacks modify the map
      const callbacksCopy = Array.from(this.callbacks.values());
      for (const callback of callbacksCopy) {
        try {
          callback();
        } catch (e) {
          // Don't let one callback failure break others
          logger.error('Callback error', { error: e });
        }
      }
    });
  }

  /**
   * Get the number of registered callbacks (for debugging).
   */
  getRegisteredCount(): number {
    return this.callbacks.size;
  }

  /**
   * Check if the manager is currently polling.
   */
  isPolling(): boolean {
    return this.intervalId !== null;
  }
}

// Export a singleton instance
export const taskAgentPollingManager = new TaskAgentPollingManager();
