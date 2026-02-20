/**
 * IPC Batch Utility
 *
 * Batches multiple IPC calls together to reduce overhead and improve performance.
 * Particularly useful for file operations that can be parallelized.
 */

import { invoke } from '$lib/electron-bridge';
import { Logger } from '$shared/logger';

const logger = new Logger('IPCBatch');

interface BatchRequest {
  id: string;
  method: string;
  params: any;
  resolve: (value: any) => void;
  reject: (error: any) => void;
}

class IPCBatcher {
  private queue: Map<string, BatchRequest[]> = new Map();
  private flushTimeout: NodeJS.Timeout | null = null;
  private readonly batchDelay = 10; // ms
  private readonly maxBatchSize = 20;
  private processingMethods = new Set<string>(); // Track which methods are being processed

  /**
   * Add a request to the batch queue
   */
  async batch<T>(method: string, params: any): Promise<T> {
    return new Promise((resolve, reject) => {
      const id = `${method}-${Date.now()}-${Math.random()}`;
      const request: BatchRequest = { id, method, params, resolve, reject };

      // Initialize queue for method if needed
      if (!this.queue.has(method) || !Array.isArray(this.queue.get(method))) {
        this.queue.set(method, []);
      }

      const methodQueue = this.queue.get(method);
      if (!methodQueue || !Array.isArray(methodQueue)) {
        // This should never happen, but handle it defensively
        logger.error('Failed to initialize queue for method:', method);
        reject(new Error('Queue initialization failed'));
        return;
      }

      methodQueue.push(request);

      // Check if we should flush immediately
      if (methodQueue.length >= this.maxBatchSize) {
        // Flush immediately for this method
        this.flushMethod(method).catch((error) => {
          logger.error('Flush failed for method:', method, error);
        });
      } else {
        // Schedule flush
        this.scheduleFlush();
      }
    });
  }

  /**
   * Schedule a flush of the queue
   */
  private scheduleFlush() {
    if (this.flushTimeout) return;

    this.flushTimeout = setTimeout(() => {
      this.flush();
    }, this.batchDelay);
  }

  /**
   * Flush all queued requests
   */
  private async flush() {
    this.flushTimeout = null;

    // Process all methods that have pending requests
    const promises: Promise<void>[] = [];

    for (const [method, requests] of this.queue.entries()) {
      if (requests.length > 0 && !this.processingMethods.has(method)) {
        promises.push(this.flushMethod(method));
      }
    }

    // Wait for all flushes to complete
    if (promises.length > 0) {
      await Promise.allSettled(promises);
    }
  }

  /**
   * Flush requests for a specific method
   */
  private async flushMethod(method: string) {
    // Prevent concurrent processing of the same method
    if (this.processingMethods.has(method)) {
      return;
    }

    this.processingMethods.add(method);

    try {
      // Get the queue for this method
      const queuedRequests = this.queue.get(method);

      // Validate and make a defensive copy
      if (!queuedRequests || !Array.isArray(queuedRequests) || queuedRequests.length === 0) {
        if (queuedRequests && !Array.isArray(queuedRequests)) {
          logger.error('Queue corruption detected:', { method, type: typeof queuedRequests });
        }
        return;
      }

      // Make a defensive copy of the requests array before clearing the queue
      const requests = [...queuedRequests];

      // Clear the queue immediately to avoid race conditions
      this.queue.set(method, []);

      // Special handling for file:read operations - batch them
      if (method === 'file:read' && requests.length > 1) {
        try {
          // Extra validation before map operation
          if (!Array.isArray(requests)) {
            throw new Error(`Requests is not an array: ${typeof requests}`);
          }

          const paths = requests.map((r) => r.params?.path).filter(Boolean);
          if (paths.length === 0) {
            throw new Error('No valid paths found in requests');
          }

          const batchResult = await invoke<{ success: boolean; data?: any[]; error?: string }>(
            'file:read-batch',
            { requests: paths.map((p) => ({ path: p })) },
          );

          if (batchResult?.success && batchResult.data) {
            // Resolve each request with its corresponding result
            requests.forEach((request, index) => {
              const data = batchResult.data![index];
              if (data) {
                request.resolve({ success: true, data });
              } else {
                request.reject(new Error('Failed to read file'));
              }
            });
          } else {
            // Reject all requests
            const error = new Error(batchResult?.error || 'Batch read failed');
            requests.forEach((r) => r.reject(error));
          }
        } catch (error) {
          // Fall back to individual requests
          logger.warn('Batch read failed, falling back to individual requests:', error);
          await this.processIndividualRequests(requests);
        }
      } else {
        // Process requests individually
        await this.processIndividualRequests(requests);
      }
    } finally {
      this.processingMethods.delete(method);
    }
  }

  /**
   * Process requests individually (fallback or for non-batchable operations)
   */
  private async processIndividualRequests(requests: BatchRequest[]) {
    // Process in parallel for better performance
    const promises = requests.map(async (request) => {
      try {
        const result = await invoke(request.method, request.params);
        request.resolve(result);
      } catch (error) {
        request.reject(error);
      }
    });

    await Promise.all(promises);
  }

  /**
   * Reset the batcher state (useful for error recovery)
   */
  public reset() {
    // Clear any pending timeout
    if (this.flushTimeout) {
      clearTimeout(this.flushTimeout);
      this.flushTimeout = null;
    }

    // Reject all pending requests
    for (const [method, requests] of this.queue.entries()) {
      requests.forEach((r) => r.reject(new Error('Batcher reset')));
    }

    // Clear all state
    this.queue.clear();
    this.processingMethods.clear();
  }
}

// Export singleton instance
export const ipcBatcher = new IPCBatcher();

/**
 * Batch-optimized file read with fallback to direct invoke
 */
export async function batchFileRead(
  path: string,
  workspaceId?: string,
): Promise<{ success: boolean; data?: string; error?: string }> {
  try {
    return await ipcBatcher.batch('file:read', { path, workspaceId });
  } catch (error) {
    // Fallback to direct invoke if batching fails
    logger.warn('Batch read failed, falling back to direct invoke:', error);
    return await invoke('file:read', { path, workspaceId });
  }
}
