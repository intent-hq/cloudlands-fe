/**
 * Mock Streaming Service for Testing
 *
 * Provides mock implementations of streaming services for testing.
 */

import { EventEmitter } from '$lib/utils/browser-event-emitter';
import type { ContentBlock, AgentMessage } from '$shared/types';
import { v4 as uuidv4 } from 'uuid';

export interface MockStreamChunk {
  type: 'text' | 'content_block' | 'tool_call' | 'error' | 'complete';
  data: any;
  timestamp: number;
}

export interface MockStreamSession {
  streamId: string;
  agentId: string;
  sessionId: string;
  startTime: number;
  chunks: MockStreamChunk[];
  accumulatedText: string;
  contentBlocks: ContentBlock[];
  isComplete: boolean;
  error?: Error;
}

export class MockStreamManager extends EventEmitter {
  private streams = new Map<string, MockStreamSession>();
  private timers = new Map<string, NodeJS.Timeout[]>();

  /**
   * Start a new stream
   */
  startStream(agentId: string, sessionId: string): string {
    const streamId = `stream-${uuidv4()}`;
    const stream: MockStreamSession = {
      streamId,
      agentId,
      sessionId,
      startTime: Date.now(),
      chunks: [],
      accumulatedText: '',
      contentBlocks: [],
      isComplete: false,
    };

    this.streams.set(streamId, stream);
    this.timers.set(streamId, []);
    this.emit('stream:started', { streamId, agentId, sessionId });

    return streamId;
  }

  /**
   * Add a text chunk to the stream
   */
  addChunk(streamId: string, text: string, delayMs = 0): void {
    const stream = this.streams.get(streamId);
    if (!stream) return;

    // If no delay, execute synchronously
    if (delayMs === 0) {
      stream.chunks.push({
        type: 'text',
        data: text,
        timestamp: Date.now(),
      });
      stream.accumulatedText += text;
      this.emit('stream:chunk', { streamId, text, timestamp: Date.now() });
    } else {
      // Otherwise use setTimeout
      const timer = setTimeout(() => {
        stream.chunks.push({
          type: 'text',
          data: text,
          timestamp: Date.now(),
        });
        stream.accumulatedText += text;
        this.emit('stream:chunk', { streamId, text, timestamp: Date.now() });
      }, delayMs);

      this.timers.get(streamId)?.push(timer);
    }
  }

  /**
   * Add a content block to the stream
   */
  addContentBlock(streamId: string, block: ContentBlock, delayMs = 0): void {
    const stream = this.streams.get(streamId);
    if (!stream) return;

    // If no delay, execute synchronously
    if (delayMs === 0) {
      stream.chunks.push({
        type: 'content_block',
        data: block,
        timestamp: Date.now(),
      });
      stream.contentBlocks.push(block);
      this.emit('stream:content-block', { streamId, block });
    } else {
      // Otherwise use setTimeout
      const timer = setTimeout(() => {
        stream.chunks.push({
          type: 'content_block',
          data: block,
          timestamp: Date.now(),
        });
        stream.contentBlocks.push(block);
        this.emit('stream:content-block', { streamId, block });
      }, delayMs);

      this.timers.get(streamId)?.push(timer);
    }
  }

  /**
   * Complete the stream
   */
  completeStream(streamId: string, delayMs = 0): Promise<AgentMessage> {
    return new Promise((resolve) => {
      const stream = this.streams.get(streamId);
      if (!stream) {
        resolve({} as AgentMessage);
        return;
      }

      const buildMessage = (): AgentMessage => {
        const blocks =
          stream.contentBlocks.length > 0
            ? stream.contentBlocks
            : stream.accumulatedText
              ? [{ type: 'text' as const, text: stream.accumulatedText }]
              : [];

        return {
          id: `msg-${uuidv4()}`,
          role: 'assistant',
          contentBlocks: blocks,
          timestamp: new Date(),
        };
      };

      // If no delay, execute synchronously
      if (delayMs === 0) {
        stream.isComplete = true;
        stream.chunks.push({
          type: 'complete',
          data: null,
          timestamp: Date.now(),
        });

        const message = buildMessage();
        this.emit('stream:complete', { streamId, message });
        resolve(message);
      } else {
        // Otherwise use setTimeout
        const timer = setTimeout(() => {
          stream.isComplete = true;
          stream.chunks.push({
            type: 'complete',
            data: null,
            timestamp: Date.now(),
          });

          const message = buildMessage();
          this.emit('stream:complete', { streamId, message });
          resolve(message);
        }, delayMs);

        this.timers.get(streamId)?.push(timer);
      }
    });
  }

  /**
   * Get stream state
   */
  getStream(streamId: string): MockStreamSession | undefined {
    return this.streams.get(streamId);
  }

  /**
   * Clear all streams and timers
   */
  clear(): void {
    for (const timers of this.timers.values()) {
      timers.forEach(clearTimeout);
    }
    this.streams.clear();
    this.timers.clear();
  }

  /**
   * Get all active streams
   */
  getActiveStreams(): MockStreamSession[] {
    return Array.from(this.streams.values()).filter((s) => !s.isComplete);
  }

  /**
   * Flush batch processor - no-op for mock, but needed for compatibility
   */
  flushBatch(): void {
    // No-op for mock - all operations are synchronous
  }
}

export function createMockStreamManager(): MockStreamManager {
  return new MockStreamManager();
}
