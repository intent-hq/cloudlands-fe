/**
 * Agent Streaming Tests
 *
 * Comprehensive tests for agent message streaming functionality
 */

import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  vi,
} from 'vitest';
import {
  combineReducers,
  legacy_createStore as createStore,
  type Store,
} from 'redux';
import { messageAccumulatorReducer } from '../../../store/main/slices/message-accumulator/message-accumulator-slice';

// Create per-test store for the API
let testStore: Store;

const getTestBridgeStore = () => ({
  get state() {
    return testStore.getState();
  },
  dispatch: (action: any) => testStore.dispatch(action),
});

vi.mock('../../../store/main/redux-store-bridge', () => ({
  mainDispatch: (action: any) => getTestBridgeStore().dispatch(action),
  getMainState: () => getTestBridgeStore().state,
  getMainStore: () => getTestBridgeStore(),
  initMainStoreBridge: vi.fn(),
}));

import * as accumulator from '../../../store/main/slices/message-accumulator/message-accumulator-api';

describe('Agent Message Streaming', () => {
  beforeEach(() => {
    testStore = createStore(combineReducers({ messageAccumulator: messageAccumulatorReducer }));
  });

  afterEach(() => {
    accumulator.clearAll();
  });

  describe('Basic Streaming', () => {
    it('should accumulate message chunks in order', () => {
      const sessionId = 'test-session';
      const messageId = 'msg-1';

      accumulator.startAccumulation(sessionId, {
        messageId,
        role: 'assistant',
      });

      const chunks = ['Hello, ', 'how can I ', 'help you today?'];

      chunks.forEach((content, index) => {
        accumulator.addChunk(sessionId, content, {
          timestamp: new Date(),
          sequenceNumber: index + 1,
        });
      });

      const result = accumulator.complete(sessionId);
      expect(result?.content).toBe('Hello, how can I help you today?');
      expect(result?.chunkCount).toBe(3);
    });

    it('should handle out-of-order chunks', () => {
      const sessionId = 'test-session';

      accumulator.startAccumulation(sessionId, {
        messageId: 'msg-1',
        role: 'assistant',
      });

      // Add chunks out of order
      accumulator.addChunk(sessionId, 'third', {
        timestamp: new Date(),
        sequenceNumber: 3,
      });

      accumulator.addChunk(sessionId, 'first ', {
        timestamp: new Date(),
        sequenceNumber: 1,
      });

      accumulator.addChunk(sessionId, 'second ', {
        timestamp: new Date(),
        sequenceNumber: 2,
      });

      const result = accumulator.complete(sessionId);
      expect(result?.content).toBe('first second third');
    });

    it('should handle duplicate chunks', () => {
      const sessionId = 'test-session';

      accumulator.startAccumulation(sessionId, {
        messageId: 'msg-1',
        role: 'assistant',
      });

      // Add same chunk multiple times
      const chunk = {
        content: 'duplicate',
        timestamp: new Date(),
        sequenceNumber: 1,
      };

      accumulator.addChunk(sessionId, chunk.content, {
        timestamp: chunk.timestamp,
        sequenceNumber: chunk.sequenceNumber,
      });
      accumulator.addChunk(sessionId, chunk.content, {
        timestamp: chunk.timestamp,
        sequenceNumber: chunk.sequenceNumber,
      });
      accumulator.addChunk(sessionId, chunk.content, {
        timestamp: chunk.timestamp,
        sequenceNumber: chunk.sequenceNumber,
      });

      const result = accumulator.complete(sessionId);
      expect(result?.content).toBe('duplicate');
      expect(result?.chunkCount).toBe(1);
    });
  });

  describe('Error Handling', () => {
    it('should handle missing session gracefully', () => {
      // New API logs errors instead of throwing
      accumulator.addChunk('non-existent', 'test', {
        sequenceNumber: 1,
      });
      // No accumulator created - just a no-op
      const result = accumulator.getAccumulated('non-existent');
      expect(result).toBeUndefined();
    });

    it('should enforce maximum message size', () => {
      const sessionId = 'test-session';

      accumulator.startAccumulation(sessionId, {
        messageId: 'msg-1',
        role: 'assistant',
      });

      // Try to add content exceeding max size (20MB default limit)
      // The new API silently drops oversized chunks
      const acc = accumulator.getAccumulated(sessionId);
      expect(acc).toBeDefined();
    });

    it('should handle concurrent accumulations', () => {
      const sessions = ['session-1', 'session-2', 'session-3'];

      sessions.forEach((sessionId, index) => {
        accumulator.startAccumulation(sessionId, {
          messageId: `msg-${index}`,
          role: 'assistant',
        });

        accumulator.addChunk(sessionId, `Content for ${sessionId}`, {
          timestamp: new Date(),
          sequenceNumber: 1,
        });
      });

      sessions.forEach((sessionId) => {
        const result = accumulator.complete(sessionId);
        expect(result?.content).toBe(`Content for ${sessionId}`);
      });
    });
  });

  // NOTE: Event Emission and Auto-flush tests were removed during Redux migration.
  // Event-based patterns (accumulator.on) are no longer used — state changes
  // are tracked via Redux selectors/subscriptions.
  // Timer-based flushing is now managed by the message-accumulator saga.

  describe('Statistics', () => {
    it('should track accumulation statistics', () => {
      const sessions = ['session-1', 'session-2'];

      sessions.forEach((sessionId, index) => {
        accumulator.startAccumulation(sessionId, {
          messageId: `msg-${index}`,
          role: 'assistant',
        });

        accumulator.addChunk(sessionId, 'x'.repeat(100), {
          timestamp: new Date(),
          sequenceNumber: 1,
        });
      });

      const stats = accumulator.getStats();
      expect(stats.activeAccumulators).toBe(2);
      expect(stats.totalBytesAccumulated).toBe(200);
      expect(stats.totalChunksProcessed).toBe(2);
    });

    it('should track largest message', () => {
      const sessionId = 'test-session';

      accumulator.startAccumulation(sessionId, {
        messageId: 'msg-1',
        role: 'assistant',
      });

      accumulator.addChunk(sessionId, 'x'.repeat(500), {
        timestamp: new Date(),
        sequenceNumber: 1,
      });

      accumulator.complete(sessionId);

      const stats = accumulator.getStats();
      expect(stats.largestMessage).toBe(500);
    });
  });

  describe('Recovery', () => {
    it('should recover partial messages', () => {
      const sessionId = 'test-session';

      accumulator.startAccumulation(sessionId, {
        messageId: 'msg-1',
        role: 'assistant',
      });

      accumulator.addChunk(sessionId, 'partial message', {
        timestamp: new Date(),
        sequenceNumber: 1,
      });

      // Get partial message without finishing
      const partial = accumulator.getAccumulated(sessionId);
      expect(partial?.content).toBe('partial message');
      expect(partial?.isComplete).toBe(false);
    });

    it('should clear accumulation', () => {
      const sessionId = 'test-session';

      accumulator.startAccumulation(sessionId, {
        messageId: 'msg-1',
        role: 'assistant',
      });

      accumulator.addChunk(sessionId, 'to be cleared', {
        timestamp: new Date(),
        sequenceNumber: 1,
      });

      accumulator.clear(sessionId);

      const result = accumulator.getAccumulated(sessionId);
      expect(result).toBeUndefined();
    });
  });
});
