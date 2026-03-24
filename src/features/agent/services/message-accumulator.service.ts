/**
 * Message Accumulator Service
 *
 * Unified service for accumulating streaming messages with proper type safety.
 * Uses Wave 1 branded ID types and consolidated type system.
 *
 * Features:
 * - Accumulates text chunks and content blocks in order
 * - Session aliasing for ID mapping
 * - Event-based notifications
 * - Memory management with cleanup
 * - Statistics tracking
 * - Proper error handling
 */

import { EventEmitter } from '$lib/utils/browser-event-emitter';
import { Logger } from '../../../shared/logger';
import type { ContentBlock, SessionId } from '../../../shared/types';
import { AgentError, AgentErrorCode } from '../errors/agent-errors';
import { memoryManager } from './memory-manager';

// Define IDisposable interface
interface IDisposable {
  dispose(): void;
}

const logger = new Logger('MessageAccumulator');

/**
 * Configuration for the accumulator service
 */
export interface AccumulatorConfig {
  maxMessageSize?: number; // Maximum size of accumulated message (bytes)
  flushInterval?: number; // Interval to flush partial messages (ms)
  enableCheckpoints?: boolean; // Save checkpoints for recovery
  checkpointInterval?: number; // Checkpoint save interval (ms)
}

/**
 * A single chunk of accumulated text
 */
export interface MessageChunk {
  content: string;
  timestamp: Date;
  sequenceNumber: number;
  metadata?: Record<string, any>;
}

/**
 * An ordered item in the accumulation (text or content block)
 */
export interface AccumulationItem {
  sequence: number;
  type: 'text' | 'block';
  content: string | ContentBlock;
  timestamp: Date;
}

/**
 * The complete accumulated message state
 */
export interface AccumulatedMessage {
  sessionId: string;
  content: string; // Full text content
  chunks: MessageChunk[]; // Individual chunks for debugging
  contentBlocks: ContentBlock[]; // Structured content blocks
  orderedItems: AccumulationItem[]; // Ordered sequence of all content
  startTime: Date;
  lastUpdateTime: Date;
  byteSize: number;
  chunkCount: number;
  isComplete: boolean;
  metadata?: Record<string, any>;
}

/**
 * Statistics about accumulator usage
 */
export interface AccumulatorStats {
  activeAccumulators: number;
  totalBytesAccumulated: number;
  totalChunksProcessed: number;
  averageMessageSize: number;
  largestMessage: number;
}

/**
 * Unified Message Accumulator Service
 *
 * Consolidates all message accumulation logic into a single, clean implementation.
 * Replaces:
 * - message-accumulator.ts (simple version)
 * - unified-message.service.ts (complex version)
 * - streaming-with-backpressure.service.ts (backpressure handling)
 *
 * Uses Wave 1 type system for type safety and consistency.
 */
const MESSAGE_ACCUMULATOR_HMR_KEY = '__messageAccumulator_hmr';

export class MessageAccumulatorService extends EventEmitter implements IDisposable {
  private static instance: MessageAccumulatorService;

  // Core state - simplified without session aliasing
  private accumulators = new Map<string, AccumulatedMessage>();
  private sequenceCounters = new Map<string, number>();

  // Direct streaming - no pre-allocated buffers needed
  private textEncoder = new TextEncoder(); // Reusable encoder

  // Timers for cleanup and checkpoints
  private flushTimers = new Map<string, NodeJS.Timeout>();
  private checkpointTimers = new Map<string, NodeJS.Timeout>();

  // PERF: Stale accumulator cleanup interval
  private staleCleanupInterval: NodeJS.Timeout | null = null;
  private readonly STALE_ACCUMULATOR_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
  private readonly STALE_CLEANUP_INTERVAL_MS = 60 * 1000; // Check every minute

  // Configuration
  private readonly config: Required<AccumulatorConfig>;

  // Lifecycle
  private disposed = false;

  // Statistics
  private stats: AccumulatorStats = {
    activeAccumulators: 0,
    totalBytesAccumulated: 0,
    totalChunksProcessed: 0,
    averageMessageSize: 0,
    largestMessage: 0,
  };

  /**
   * Private constructor - use getInstance() instead
   */
  private constructor(config: AccumulatorConfig = {}) {
    super();

    this.config = {
      maxMessageSize: 50 * 1024 * 1024, // 50MB - increased to handle long responses
      flushInterval: 5000, // 5 seconds
      enableCheckpoints: true,
      checkpointInterval: 1000, // 1 second
      ...config,
    };

    // PERF: Start stale accumulator cleanup interval to prevent memory leaks
    this.startStaleCleanupInterval();

    logger.debug('MessageAccumulatorService initialized', {
      maxMessageSize: this.config.maxMessageSize,
      flushInterval: this.config.flushInterval,
    });
  }

  /**
   * PERF: Start interval to clean up stale accumulators
   * This prevents memory leaks from abandoned streaming sessions
   */
  private startStaleCleanupInterval(): void {
    this.staleCleanupInterval = setInterval(() => {
      this.cleanupStaleAccumulators();
    }, this.STALE_CLEANUP_INTERVAL_MS);
  }

  /**
   * PERF: Clean up accumulators that haven't been updated in a while
   * This prevents memory leaks from abandoned streaming sessions
   */
  private cleanupStaleAccumulators(): void {
    const now = Date.now();
    const staleSessionIds: string[] = [];

    for (const [sessionId, accumulator] of this.accumulators.entries()) {
      const timeSinceLastUpdate = now - accumulator.lastUpdateTime.getTime();
      if (timeSinceLastUpdate > this.STALE_ACCUMULATOR_TIMEOUT_MS) {
        staleSessionIds.push(sessionId);
      }
    }

    if (staleSessionIds.length > 0) {
      logger.info('Cleaning up stale accumulators', {
        count: staleSessionIds.length,
        sessionIds: staleSessionIds,
      });

      for (const sessionId of staleSessionIds) {
        this.clear(sessionId);
      }
    }
  }

  /**
   * PERF: Public method to trigger stale accumulator cleanup on demand.
   * Called by memory pressure handler to free memory when under pressure.
   */
  cleanupStale(): void {
    this.cleanupStaleAccumulators();
  }

  /**
   * Get or create the singleton instance
   */
  static getInstance(config?: AccumulatorConfig): MessageAccumulatorService {
    // Survive HMR: reuse instance stored on window if available
    if (typeof window !== 'undefined' && (window as any)[MESSAGE_ACCUMULATOR_HMR_KEY]) {
      MessageAccumulatorService.instance = (window as any)[MESSAGE_ACCUMULATOR_HMR_KEY];
      return MessageAccumulatorService.instance;
    }
    if (!MessageAccumulatorService.instance) {
      MessageAccumulatorService.instance = new MessageAccumulatorService(config);
      if (typeof window !== 'undefined') {
        (window as any)[MESSAGE_ACCUMULATOR_HMR_KEY] = MessageAccumulatorService.instance;
      }
    }
    return MessageAccumulatorService.instance;
  }

  /**
   * Reset the singleton instance (for testing only)
   */
  static resetInstance(): void {
    if (MessageAccumulatorService.instance) {
      MessageAccumulatorService.instance.clearAll();
      MessageAccumulatorService.instance.removeAllListeners();
    }
    MessageAccumulatorService.instance = null as any;
    // Clear HMR survival key so getInstance() doesn't reuse a disposed instance
    if (typeof window !== 'undefined') {
      delete (window as any)[MESSAGE_ACCUMULATOR_HMR_KEY];
    }
  }

  /**
   * Start accumulating messages for a session
   *
   * @param sessionId - The session ID to accumulate for
   * @param metadata - Optional metadata to attach to the accumulation
   * @throws AgentError if accumulator already exists for this session
   */
  startAccumulation(sessionId: string, metadata?: Record<string, any>): void {
    if (this.disposed) {
      throw new AgentError(
        'MessageAccumulatorService has been disposed',
        AgentErrorCode.SESSION_INITIALIZATION_FAILED,
      );
    }

    // CRITICAL FIX: If an accumulator already exists, clear it and start fresh.
    // This prevents content blocks from accumulating across multiple messages
    // if the previous accumulator wasn't properly cleaned up.
    if (this.accumulators.has(sessionId)) {
      logger.warn('Accumulator already exists for session - clearing and restarting', {
        sessionId,
      });
      this.clear(sessionId);
    }

    const accumulator: AccumulatedMessage = {
      sessionId,
      content: '',
      chunks: [],
      contentBlocks: [],
      orderedItems: [],
      startTime: new Date(),
      lastUpdateTime: new Date(),
      byteSize: 0,
      chunkCount: 0,
      isComplete: false,
      metadata,
    };

    this.accumulators.set(sessionId, accumulator);
    this.sequenceCounters.set(sessionId, 0);

    // Direct streaming - no pre-allocated buffers

    this.stats.activeAccumulators++;

    // Set up flush timer
    this.setupFlushTimer(sessionId);

    // Set up checkpoint timer if enabled
    if (this.config.enableCheckpoints) {
      this.setupCheckpointTimer(sessionId);
    }

    // Use debug level for routine accumulation operations
    logger.debug('[MessageAccumulator] Started message accumulation', {
      sessionId,
      hasMetadata: !!metadata,
      accumulatorCount: this.accumulators.size,
    });
    this.emit('accumulation:started', { sessionId });
  }

  /**
   * Validate session ID exists
   * @param sessionId - The session ID to validate
   * @returns true if session exists
   */
  private validateSession(sessionId: string): boolean {
    return this.accumulators.has(sessionId);
  }

  /**
   * Add a text chunk to the accumulator
   *
   * Direct streaming - no buffering, immediate processing.
   * Detects and skips duplicate chunks.
   *
   * @param sessionId - The session ID
   * @param chunk - The text chunk to add
   * @param metadata - Optional metadata for this chunk (may include sequenceNumber)
   * @throws AgentError if session not found or size limit exceeded
   */
  addChunk(sessionId: string, chunk: string, metadata?: Record<string, any>): void {
    if (this.disposed) {
      throw new AgentError(
        'MessageAccumulatorService has been disposed',
        AgentErrorCode.SESSION_INITIALIZATION_FAILED,
      );
    }

    // Direct lookup - no alias resolution needed
    const accumulator = this.accumulators.get(sessionId);

    if (!accumulator) {
      logger.error('[MessageAccumulator] No accumulator found for session', {
        sessionId,
        availableSessionIds: Array.from(this.accumulators.keys()),
      });
      throw new AgentError(
        `No accumulator found for session ${sessionId}`,
        AgentErrorCode.SESSION_NOT_FOUND,
        { sessionId },
      );
    }

    if (accumulator.isComplete) {
      logger.warn('Attempting to add chunk to completed accumulator', { sessionId });
      return;
    }

    // Check size limit - use pre-allocated encoder for performance
    const chunkSize = this.textEncoder.encode(chunk).length;
    if (accumulator.byteSize + chunkSize > this.config.maxMessageSize) {
      const error = new AgentError('Message size limit exceeded', AgentErrorCode.MESSAGE_TOO_LONG, {
        sessionId,
        currentSize: accumulator.byteSize,
        chunkSize,
        maxSize: this.config.maxMessageSize,
      });
      this.emit('error', { sessionId, error });
      throw error;
    }

    // Use provided sequence number or auto-increment
    const sequenceNumber = metadata?.sequenceNumber ?? this.getNextSequenceNumber(sessionId);

    // PERF: Check for duplicates using only recent chunks (last 10) to limit memory
    // Only check the most recent chunks since duplicates typically arrive close together
    const recentChunks = accumulator.chunks.slice(-10);
    const isDuplicate = recentChunks.some(
      (c) => c.sequenceNumber === sequenceNumber && c.content === chunk,
    );

    if (isDuplicate) {
      logger.debug('Skipping duplicate chunk', {
        sessionId,
        sequenceNumber,
      });
      return;
    }

    // Create chunk record
    const messageChunk: MessageChunk = {
      content: chunk,
      timestamp: metadata?.timestamp ?? new Date(),
      sequenceNumber,
      metadata,
    };

    // PERF: Only keep last 20 chunks to limit memory usage
    // Chunks are only used for duplicate detection and debugging
    accumulator.chunks.push(messageChunk);
    if (accumulator.chunks.length > 20) {
      accumulator.chunks.shift(); // Remove oldest chunk
    }

    // Update content directly - no buffering
    accumulator.content += chunk;

    // PERF: Consolidate consecutive text items in orderedItems to save memory
    // Instead of creating a new item for every chunk, append to the last text item if it exists
    const lastItem = accumulator.orderedItems[accumulator.orderedItems.length - 1];
    if (lastItem && lastItem.type === 'text') {
      // Append to existing text item
      lastItem.content = (lastItem.content as string) + chunk;
      lastItem.timestamp = new Date();
    } else {
      // Create new text item (first text or after a content block)
      const textItem: AccumulationItem = {
        sequence: accumulator.orderedItems.length,
        type: 'text',
        content: chunk,
        timestamp: new Date(),
      };
      accumulator.orderedItems.push(textItem);
    }

    accumulator.byteSize += chunkSize;
    accumulator.chunkCount++; // PERF: Use counter instead of array length
    accumulator.lastUpdateTime = new Date();

    // Use debug level for per-chunk logging (very frequent)
    logger.debug('[MessageAccumulator] Added chunk successfully', {
      sessionId,
      chunkLength: chunk.length,
      totalContent: accumulator.content.length,
      chunkCount: accumulator.chunkCount,
      sequenceNumber,
    });

    // Update stats
    this.stats.totalBytesAccumulated += chunkSize;
    this.stats.totalChunksProcessed++;
    if (accumulator.byteSize > this.stats.largestMessage) {
      this.stats.largestMessage = accumulator.byteSize;
    }

    // Reset flush timer
    this.resetFlushTimer(sessionId);

    // Emit event
    this.emit('chunk:added', {
      sessionId,
      chunkSize,
      totalSize: accumulator.byteSize,
      sequenceNumber,
    });

    logger.debug('Added chunk to accumulator', {
      sessionId,
      chunkSize,
      totalSize: accumulator.byteSize,
      sequenceNumber,
    });
  }

  /**
   * Add a content block (tool call, code, etc.) to the accumulator
   *
   * Maintains order by flushing any buffered text first.
   *
   * @param sessionId - The session ID
   * @param block - The content block to add
   * @throws AgentError if session not found
   */
  addContentBlock(sessionId: string, block: ContentBlock): void {
    if (this.disposed) {
      throw new AgentError(
        'MessageAccumulatorService has been disposed',
        AgentErrorCode.SESSION_INITIALIZATION_FAILED,
      );
    }

    // Direct lookup - no alias resolution needed
    const accumulator = this.accumulators.get(sessionId);

    if (!accumulator) {
      throw new AgentError(
        `No accumulator found for session ${sessionId}`,
        AgentErrorCode.SESSION_NOT_FOUND,
        { sessionId },
      );
    }

    // Direct streaming - no buffering needed

    // Add block to ordered items
    const blockItem: AccumulationItem = {
      sequence: accumulator.orderedItems.length,
      type: 'block',
      content: block,
      timestamp: new Date(),
    };
    accumulator.orderedItems.push(blockItem);

    // Keep for backward compatibility
    accumulator.contentBlocks.push(block);
    accumulator.lastUpdateTime = new Date();

    logger.debug('Added content block to accumulator', {
      sessionId,
      blockType: block.type,
    });

    this.emit('block:added', { sessionId, block });
  }

  /**
   * Update an existing content block by ID.
   * Replaces the block in both orderedItems and contentBlocks arrays.
   * Used when a skeleton tool_use block needs to be replaced with the
   * follow-up that has real input parameters.
   *
   * @param sessionId - The session ID
   * @param block - The updated content block (must have an id field)
   * @returns true if the block was found and updated, false otherwise
   */
  updateContentBlock(sessionId: string, block: ContentBlock): boolean {
    if (this.disposed) return false;

    const accumulator = this.accumulators.get(sessionId);
    if (!accumulator || !block.id) return false;

    let found = false;

    // Update in orderedItems
    for (const item of accumulator.orderedItems) {
      if (item.type === 'block') {
        const existingBlock = item.content as ContentBlock;
        if (existingBlock.id === block.id) {
          item.content = block;
          item.timestamp = new Date();
          found = true;
          break;
        }
      }
    }

    // Update in contentBlocks (backward compatibility array)
    for (let i = 0; i < accumulator.contentBlocks.length; i++) {
      if (accumulator.contentBlocks[i].id === block.id) {
        accumulator.contentBlocks[i] = block;
        break;
      }
    }

    if (found) {
      accumulator.lastUpdateTime = new Date();
      logger.debug('Updated content block in accumulator', {
        sessionId,
        blockId: block.id,
        blockType: block.type,
      });
      this.emit('block:added', { sessionId, block });
    }

    return found;
  }

  /**
   * Complete accumulation and return the final message
   *
   * Flushes any remaining text buffer and builds final content blocks.
   *
   * @param sessionId - The session ID
   * @returns The completed accumulated message
   * @throws AgentError if session not found
   */
  complete(sessionId: string): AccumulatedMessage {
    if (this.disposed) {
      throw new AgentError(
        'MessageAccumulatorService has been disposed',
        AgentErrorCode.SESSION_INITIALIZATION_FAILED,
      );
    }

    // Direct lookup - no alias resolution needed
    const accumulator = this.accumulators.get(sessionId);

    if (!accumulator) {
      throw new AgentError(
        `No accumulator found for session ${sessionId}`,
        AgentErrorCode.SESSION_NOT_FOUND,
        { sessionId },
      );
    }

    // Direct streaming - content is already assembled
    // Sort chunks for final ordering if needed
    if (accumulator.chunks.length > 1) {
      accumulator.chunks.sort((a, b) => a.sequenceNumber - b.sequenceNumber);
      // Rebuild content in correct order
      accumulator.content = accumulator.chunks.map((c) => c.content).join('');
    }

    // Build final ordered content blocks
    accumulator.contentBlocks = this.buildOrderedContentBlocks(accumulator);

    // Mark as complete
    accumulator.isComplete = true;

    // Clear timers
    this.clearTimers(sessionId);

    // Update stats
    this.updateAverageMessageSize();

    const duration = Date.now() - accumulator.startTime.getTime();
    // Use debug level for routine accumulation operations
    logger.debug('Completed message accumulation', {
      sessionId,
      finalSize: accumulator.byteSize,
      chunkCount: accumulator.chunkCount,
      duration,
    });

    this.emit('accumulation:completed', {
      sessionId,
      message: accumulator,
    });

    return accumulator;
  }

  /**
   * Get current accumulated content
   *
   * @param sessionId - The session ID
   * @returns The accumulated message, or undefined if not found
   */
  getAccumulated(sessionId: string): AccumulatedMessage | undefined {
    // Direct lookup - no alias resolution needed
    return this.accumulators.get(sessionId);
  }

  /**
   * Get partial content (for preview or recovery)
   * Returns the accumulated content and blocks
   *
   * @param sessionId - The session ID
   * @returns Object with content and contentBlocks, or empty if not found
   */
  getPartialContent(sessionId: string): { content: string; contentBlocks: ContentBlock[] } {
    // Direct lookup - no alias resolution needed
    const accumulator = this.accumulators.get(sessionId);
    if (!accumulator) {
      return { content: '', contentBlocks: [] };
    }

    // Direct streaming - content is continuously built

    // Build properly ordered content blocks
    const orderedBlocks = this.buildOrderedContentBlocks(accumulator);

    return {
      content: accumulator.content || '',
      contentBlocks: orderedBlocks,
    };
  }

  /**
   * Build properly ordered content blocks from accumulator
   * Reconstructs content blocks in the correct order from accumulated items
   */
  private buildOrderedContentBlocks(accumulator: AccumulatedMessage): ContentBlock[] {
    const blocks: ContentBlock[] = [];

    // Use orderedItems which now includes both text chunks and content blocks in order
    // This preserves the correct order of text and tool calls as they were received
    let currentText = '';

    for (const item of accumulator.orderedItems) {
      if (item.type === 'text') {
        // Accumulate text chunks
        currentText += item.content as string;
      } else {
        // Flush any accumulated text as a text block before adding the content block
        if (currentText) {
          blocks.push({ type: 'text', text: currentText } as ContentBlock);
          currentText = '';
        }
        // Add the content block (tool call, etc.)
        blocks.push(item.content as ContentBlock);
      }
    }

    // Final text block if needed
    if (currentText) {
      blocks.push({ type: 'text', text: currentText } as ContentBlock);
    }

    // If no ordered items exist (backward compatibility), fall back to old method
    if (accumulator.orderedItems.length === 0 && blocks.length === 0) {
      // Add text content as first block if it exists
      if (accumulator.content) {
        blocks.push({ type: 'text', text: accumulator.content } as ContentBlock);
      }
      // Add any existing content blocks
      blocks.push(...accumulator.contentBlocks);
    }

    return blocks;
  }

  /**
   * Clear accumulator for a specific session
   *
   * Cleans up all timers and buffers associated with the session.
   *
   * @param sessionId - The session ID
   */
  clear(sessionId: string): void {
    const accumulator = this.accumulators.get(sessionId);

    if (accumulator) {
      this.clearTimers(sessionId);
      this.accumulators.delete(sessionId);
      this.sequenceCounters.delete(sessionId);
      // No buffers to clean up - direct streaming
      this.stats.activeAccumulators--;

      logger.debug('Cleared accumulator', {
        sessionId,
      });

      this.emit('accumulation:cleared', { sessionId });
    }
  }

  /**
   * Get all active session IDs
   *
   * @returns Array of session IDs currently being accumulated
   */
  getActiveSessionIds(): string[] {
    return Array.from(this.accumulators.keys());
  }

  /**
   * Clear all accumulators
   *
   * Useful for cleanup and testing.
   */
  clearAll(): void {
    for (const sessionId of this.accumulators.keys()) {
      this.clear(sessionId);
    }
    // No buffers to clear - direct streaming
    logger.debug('Cleared all accumulators');
  }

  /**
   * Get statistics
   */
  getStats(): AccumulatorStats {
    return { ...this.stats };
  }

  /**
   * Reset all statistics (for testing)
   */
  resetStats(): void {
    this.stats = {
      activeAccumulators: 0,
      totalBytesAccumulated: 0,
      totalChunksProcessed: 0,
      averageMessageSize: 0,
      largestMessage: 0,
    };
  }

  /**
   * Validate chunk integrity
   *
   * @param sessionId - The session ID
   * @returns Validation result with details
   */
  validateChunks(sessionId: string): {
    valid: boolean;
    totalChunks: number;
    missingSequences: number[];
    duplicates: number[];
    outOfOrder: boolean;
  } {
    const accumulator = this.accumulators.get(sessionId);
    if (!accumulator) {
      return {
        valid: false,
        totalChunks: 0,
        missingSequences: [],
        duplicates: [],
        outOfOrder: false,
      };
    }

    const sequences = accumulator.chunks.map((c) => c.sequenceNumber);
    const uniqueSequences = new Set(sequences);
    const duplicates = sequences.filter((seq, idx) => sequences.indexOf(seq) !== idx);

    // Check for missing sequences
    const maxSeq = Math.max(...sequences);
    const missingSequences: number[] = [];
    for (let i = 1; i <= maxSeq; i++) {
      if (!uniqueSequences.has(i)) {
        missingSequences.push(i);
      }
    }

    // Check if out of order
    let outOfOrder = false;
    for (let i = 1; i < sequences.length; i++) {
      if (sequences[i] < sequences[i - 1]) {
        outOfOrder = true;
        break;
      }
    }

    return {
      valid: missingSequences.length === 0 && duplicates.length === 0,
      totalChunks: accumulator.chunks.length,
      missingSequences,
      duplicates,
      outOfOrder,
    };
  }

  /**
   * Get chunk visualization for debugging
   *
   * @param sessionId - The session ID
   * @returns Visual representation of chunks
   */
  getChunkVisualization(sessionId: string): string {
    const accumulator = this.accumulators.get(sessionId);
    if (!accumulator) {
      return 'No accumulator found';
    }

    const chunks = accumulator.chunks;
    if (chunks.length === 0) {
      return 'No chunks';
    }

    const maxSeq = Math.max(...chunks.map((c) => c.sequenceNumber));
    const visualization: string[] = [];

    for (let i = 1; i <= maxSeq; i++) {
      const chunk = chunks.find((c) => c.sequenceNumber === i);
      if (chunk) {
        visualization.push(`[${i}:${chunk.content.length}b]`);
      } else {
        visualization.push(`[${i}:missing]`);
      }
    }

    return visualization.join(' ');
  }

  /**
   * Private helper methods
   */

  private getNextSequenceNumber(sessionId: string): number {
    const current = this.sequenceCounters.get(sessionId) || 0;
    const next = current + 1;
    this.sequenceCounters.set(sessionId, next);
    return next;
  }

  private setupFlushTimer(sessionId: string): void {
    const timerId = setTimeout(() => this.flush(sessionId), this.config.flushInterval);
    this.flushTimers.set(sessionId, timerId);
  }

  private resetFlushTimer(sessionId: string): void {
    const existingTimer = this.flushTimers.get(sessionId);
    if (existingTimer) {
      clearTimeout(existingTimer);
      this.flushTimers.delete(sessionId);
    }
    this.setupFlushTimer(sessionId);
  }

  private setupCheckpointTimer(sessionId: string): void {
    const timerId = setInterval(
      () => this.saveCheckpoint(sessionId),
      this.config.checkpointInterval,
    );
    this.checkpointTimers.set(sessionId, timerId);
  }

  private clearTimers(sessionId: string): void {
    const flushTimer = this.flushTimers.get(sessionId);
    if (flushTimer) {
      clearTimeout(flushTimer);
      this.flushTimers.delete(sessionId);
    }

    const checkpointTimer = this.checkpointTimers.get(sessionId);
    if (checkpointTimer) {
      clearInterval(checkpointTimer);
      this.checkpointTimers.delete(sessionId);
    }
  }

  private flush(sessionId: string): void {
    const accumulator = this.accumulators.get(sessionId);
    if (accumulator && !accumulator.isComplete) {
      logger.debug('Flushing accumulator', { sessionId });
      this.emit('flush', {
        sessionId,
        content: accumulator.content,
      });
      this.emit('accumulation:flushed', {
        sessionId,
        content: accumulator.content,
      });
    }
  }

  private saveCheckpoint(sessionId: string): void {
    const accumulator = this.accumulators.get(sessionId);
    if (accumulator) {
      this.emit('checkpoint:saved', {
        sessionId,
        checkpoint: {
          content: accumulator.content,
          byteSize: accumulator.byteSize,
          chunkCount: accumulator.chunkCount,
        },
      });
    }
  }

  private updateAverageMessageSize(): void {
    const totalMessages =
      this.stats.totalChunksProcessed > 0 ? Math.ceil(this.stats.totalChunksProcessed / 10) : 1; // Estimate
    this.stats.averageMessageSize = Math.round(this.stats.totalBytesAccumulated / totalMessages);
  }

  /**
   * Flush all pending batches synchronously - for testing
   */
  flushBatch(): void {
    // Clear all pending timers and flush immediately
    for (const [sessionId, timer] of this.flushTimers.entries()) {
      clearTimeout(timer);
      this.flush(sessionId);
    }
    this.flushTimers.clear();
  }

  /**
   * Dispose of all resources and cleanup
   *
   * Clears all timers, accumulators, and event listeners.
   * After disposal, the service cannot be used.
   */
  dispose(): void {
    if (this.disposed) {
      return;
    }

    logger.debug('Disposing MessageAccumulatorService');

    try {
      // PERF: Clear stale cleanup interval
      if (this.staleCleanupInterval) {
        clearInterval(this.staleCleanupInterval);
        this.staleCleanupInterval = null;
      }

      // Clear all flush timers
      for (const timer of this.flushTimers.values()) {
        if (typeof timer === 'object' && 'cleanup' in timer) {
          (timer as any).cleanup();
        } else {
          clearTimeout(timer);
        }
      }
      this.flushTimers.clear();

      // Clear all checkpoint timers
      for (const timer of this.checkpointTimers.values()) {
        if (typeof timer === 'object' && 'cleanup' in timer) {
          (timer as any).cleanup();
        } else {
          clearInterval(timer);
        }
      }
      this.checkpointTimers.clear();

      // Clear all accumulators - direct streaming
      this.accumulators.clear();
      this.sequenceCounters.clear();

      // Clean up with memory manager
      memoryManager.cleanup(this);

      // Remove all event listeners
      this.removeAllListeners();

      // Mark as disposed
      this.disposed = true;

      // Clear singleton instance
      MessageAccumulatorService.instance = null as any;

      logger.debug('MessageAccumulatorService disposed successfully');
    } catch (error) {
      logger.error('Error during MessageAccumulatorService disposal', { error });
      throw error;
    }
  }
}

/**
 * Singleton instance of the Message Accumulator Service
 *
 * Configuration:
 * - maxMessageSize: 20MB (PERF: reduced from 50MB to prevent GC pressure)
 * - flushInterval: 5 seconds
 * - enableCheckpoints: true (for recovery)
 * - checkpointInterval: 1 second
 */
export const messageAccumulator = MessageAccumulatorService.getInstance({
  maxMessageSize: 20 * 1024 * 1024, // 20MB (PERF: reduced from 50MB)
  flushInterval: 5000, // 5 seconds
  enableCheckpoints: true,
  checkpointInterval: 1000, // 1 second
});
