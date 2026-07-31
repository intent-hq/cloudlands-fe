/**
 * Tests for MockStreamManager
 */

import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  vi,
} from 'vitest';
import { MockStreamManager } from '../streaming.mock';
import type { ContentBlock } from '$shared/types';

describe('MockStreamManager', () => {
  let manager: MockStreamManager;

  beforeEach(() => {
    manager = new MockStreamManager();
  });

  afterEach(() => {
    manager.clear();
  });

  describe('Stream Lifecycle', () => {
    it('should start a stream', () => {
      const streamId = manager.startStream('agent-1', 'session-1');
      expect(streamId).toBeDefined();
      expect(streamId).toMatch(/^stream-/);

      const stream = manager.getStream(streamId);
      expect(stream).toBeDefined();
      expect(stream?.agentId).toBe('agent-1');
      expect(stream?.sessionId).toBe('session-1');
      expect(stream?.isComplete).toBe(false);
    });

    it('should emit stream:started event', () =>
      new Promise<void>((resolve) => {
        manager.on('stream:started', ({ streamId, agentId, sessionId }: any) => {
          expect(streamId).toBeDefined();
          expect(agentId).toBe('agent-1');
          expect(sessionId).toBe('session-1');
          resolve();
        });

        manager.startStream('agent-1', 'session-1');
      }));
  });

  describe('Adding Chunks', () => {
    it('should add text chunks', () =>
      new Promise<void>((resolve) => {
        const streamId = manager.startStream('agent-1', 'session-1');

        manager.on('stream:chunk', ({ text }: { text: string }) => {
          expect(text).toBe('Hello');
          resolve();
        });

        manager.addChunk(streamId, 'Hello');
      }));

    it('should accumulate text', async () => {
      const streamId = manager.startStream('agent-1', 'session-1');

      manager.addChunk(streamId, 'Hello');
      manager.addChunk(streamId, ' ');
      manager.addChunk(streamId, 'World');

      await new Promise((r) => setTimeout(r, 50));

      const stream = manager.getStream(streamId);
      expect(stream?.accumulatedText).toBe('Hello World');
    });

    it('should handle delayed chunks', async () => {
      const streamId = manager.startStream('agent-1', 'session-1');

      manager.addChunk(streamId, 'First', 10);
      manager.addChunk(streamId, 'Second', 20);

      await new Promise((r) => setTimeout(r, 50));

      const stream = manager.getStream(streamId);
      expect(stream?.accumulatedText).toBe('FirstSecond');
    });
  });

  describe('Content Blocks', () => {
    it('should add content blocks', () =>
      new Promise<void>((resolve) => {
        const streamId = manager.startStream('agent-1', 'session-1');
        const block: ContentBlock = {
          id: 'block-1',
          type: 'code',
          language: 'typescript',
          content: 'const x = 1;',
        };

        manager.on('stream:content-block', ({ block: emittedBlock }: { block: any }) => {
          expect(emittedBlock).toEqual(block);
          resolve();
        });

        manager.addContentBlock(streamId, block);
      }));

    it('should accumulate content blocks', async () => {
      const streamId = manager.startStream('agent-1', 'session-1');
      const block1: ContentBlock = {
        id: 'block-1',
        type: 'code',
        language: 'typescript',
        content: 'const x = 1;',
      };
      const block2: ContentBlock = {
        id: 'block-2',
        type: 'code',
        language: 'python',
        content: 'x = 1',
      };

      manager.addContentBlock(streamId, block1);
      manager.addContentBlock(streamId, block2);

      await new Promise((r) => setTimeout(r, 50));

      const stream = manager.getStream(streamId);
      expect(stream?.contentBlocks).toHaveLength(2);
      expect(stream?.contentBlocks[0]).toEqual(block1);
      expect(stream?.contentBlocks[1]).toEqual(block2);
    });
  });

  describe('Stream Completion', () => {
    it('should complete a stream', async () => {
      const streamId = manager.startStream('agent-1', 'session-1');
      manager.addChunk(streamId, 'Test message');

      const message = await manager.completeStream(streamId);

      expect(message).toBeDefined();
      expect(message.role).toBe('assistant');

      const blocks = message.contentBlocks ?? [];
      expect(blocks.length).toBe(1);
      expect(blocks[0].type).toBe('text');
      expect(blocks[0].text ?? blocks[0].content).toBe('Test message');

      const stream = manager.getStream(streamId);
      expect(stream?.isComplete).toBe(true);
    });

    it('should emit stream:complete event', () =>
      new Promise<void>((resolve) => {
        const streamId = manager.startStream('agent-1', 'session-1');

        manager.on('stream:complete', ({ message }: { message: any }) => {
          expect(message).toBeDefined();
          resolve();
        });

        manager.completeStream(streamId);
      }));
  });

  describe('Stream Management', () => {
    it('should get active streams', async () => {
      const stream1 = manager.startStream('agent-1', 'session-1');
      const stream2 = manager.startStream('agent-2', 'session-2');

      let active = manager.getActiveStreams();
      expect(active).toHaveLength(2);

      manager.completeStream(stream1);

      await new Promise((r) => setTimeout(r, 50));

      active = manager.getActiveStreams();
      expect(active).toHaveLength(1);
    });

    it('should clear all streams', () => {
      manager.startStream('agent-1', 'session-1');
      manager.startStream('agent-2', 'session-2');

      manager.clear();

      expect(manager.getActiveStreams()).toHaveLength(0);
    });
  });
});
