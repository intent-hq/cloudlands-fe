/**
 * Message Pruner Service
 *
 * Manages message history pruning and cleanup to prevent memory bloat.
 */

import { logger } from '../../../shared/logger';
import type { AgentSession, AgentMessage } from '../../../shared/types';

export interface PruneConfig {
  maxMessagesPerSession: number;
  maxMessageAge: number; // milliseconds
  pruneInterval: number; // milliseconds
}

const DEFAULT_CONFIG: PruneConfig = {
  maxMessagesPerSession: 1000,
  maxMessageAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  pruneInterval: 60 * 60 * 1000, // 1 hour
};

/**
 * Prunes old messages and metadata to prevent memory bloat
 */
export class MessagePruner {
  private config: PruneConfig;
  private pruneTimer: NodeJS.Timeout | null = null;

  constructor(config: Partial<PruneConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Start automatic pruning
   */
  start(): void {
    if (this.pruneTimer) return;

    this.pruneTimer = setInterval(() => {
      logger.debug('Running scheduled message pruning');
    }, this.config.pruneInterval);

    logger.info('Message pruner started', {
      maxMessages: this.config.maxMessagesPerSession,
      maxAge: this.config.maxMessageAge,
    });
  }

  /**
   * Stop automatic pruning
   */
  stop(): void {
    if (this.pruneTimer) {
      clearInterval(this.pruneTimer);
      this.pruneTimer = null;
      logger.info('Message pruner stopped');
    }
  }

  /**
   * Prune old messages from an agent session
   */
  pruneOldMessages(agent: AgentSession): number {
    const before = agent.messages.length;

    // Remove messages older than maxMessageAge
    const cutoffTime = Date.now() - this.config.maxMessageAge;
    agent.messages = agent.messages.filter((msg) => {
      const timestamp =
        msg.timestamp instanceof Date
          ? msg.timestamp.getTime()
          : typeof msg.timestamp === 'string'
            ? new Date(msg.timestamp).getTime()
            : msg.timestamp || 0;
      return timestamp > cutoffTime;
    });

    // If still over limit, keep only recent messages
    if (agent.messages.length > this.config.maxMessagesPerSession) {
      agent.messages = agent.messages.slice(-this.config.maxMessagesPerSession);
    }

    const pruned = before - agent.messages.length;
    if (pruned > 0) {
      logger.debug(`Pruned ${pruned} old messages from agent ${agent.id}`);
    }

    return pruned;
  }

  /**
   * Clean up streaming metadata from completed messages
   */
  pruneStreamingMetadata(message: AgentMessage): void {
    if (message.streamingComplete && message.metadata) {
      // Remove streaming-specific metadata after completion
      delete message.metadata.chunksReceived;
      delete message.metadata.firstChunkTime;
      delete message.metadata.lastChunkTime;
      delete message.metadata.totalChunkSize;
    }
  }

  /**
   * Clean up all streaming metadata from a session
   */
  pruneAllStreamingMetadata(agent: AgentSession): void {
    for (const message of agent.messages) {
      this.pruneStreamingMetadata(message);
    }
  }

  /**
   * Estimate memory usage of messages
   */
  estimateMemoryUsage(messages: AgentMessage[]): number {
    let bytes = 0;

    for (const msg of messages) {
      // Count the content blocks
      if (msg.contentBlocks) {
        for (const block of msg.contentBlocks) {
          if (block.type === 'text' && block.text) {
            bytes += block.text.length * 2; // UTF-16 encoding
          } else if (block.content) {
            bytes += block.content.length * 2; // UTF-16 encoding
          }
        }
      }

      // Handle legacy content property (for backward compatibility)
      // This handles cases where messages have a direct content property
      // instead of contentBlocks
      if ((msg as any).content && typeof (msg as any).content === 'string') {
        bytes += (msg as any).content.length * 2; // UTF-16 encoding
      }

      // Count metadata
      bytes += JSON.stringify(msg.metadata || {}).length;

      // Count content blocks as JSON (for structure overhead)
      if (msg.contentBlocks) {
        for (const block of msg.contentBlocks) {
          bytes += JSON.stringify(block).length;
        }
      }

      // Count tool calls and tool results
      if (msg.toolCalls) {
        bytes += JSON.stringify(msg.toolCalls).length;
      }
      if (msg.toolResults) {
        bytes += JSON.stringify(msg.toolResults).length;
      }

      // Count other fields
      bytes += (msg.id || '').length * 2;
      bytes += (msg.role || '').length * 2;
      bytes += ((msg as any).agentId || '').length * 2;
      bytes += (msg.error || '').length * 2;
      bytes += (msg.errorCode || '').length * 2;

      // Count timestamp
      if (msg.timestamp) {
        bytes +=
          msg.timestamp instanceof Date
            ? 24 // Date object overhead
            : msg.timestamp.toString().length * 2;
      }

      // Base overhead for object structure
      bytes += 100; // Overhead for object structure and other small fields
    }

    return bytes;
  }

  /**
   * Get pruning statistics
   */
  getStats(): {
    maxMessages: number;
    maxAge: number;
    interval: number;
    } {
    return {
      maxMessages: this.config.maxMessagesPerSession,
      maxAge: this.config.maxMessageAge,
      interval: this.config.pruneInterval,
    };
  }
}

/**
 * Singleton instance
 */
let instance: MessagePruner | null = null;

/**
 * Get or create message pruner instance
 *
 * Note: Config is only used on first instantiation.
 * To use different config, call resetMessagePruner() first.
 */
export function getMessagePruner(config?: Partial<PruneConfig>): MessagePruner {
  if (!instance) {
    instance = new MessagePruner(config);
  }
  return instance;
}

/**
 * Reset the singleton instance (useful for testing)
 */
export function resetMessagePruner(): void {
  if (instance) {
    instance.stop();
    instance = null;
  }
}
