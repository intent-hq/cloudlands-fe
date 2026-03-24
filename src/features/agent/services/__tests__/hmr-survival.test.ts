/**
 * HMR Survival Tests
 *
 * Verifies that all 6 renderer singletons survive Hot Module Replacement (HMR).
 * Each singleton stores its instance on `window` via a key like `__xxx_hmr`.
 * When Vite hot-reloads a module, the static class field resets to `undefined`,
 * but `window` persists, so `getInstance()` recovers the same instance.
 */

import { describe, it, expect, afterEach, beforeAll, vi } from 'vitest';

// Mock dependencies before importing singletons

// Mock logger used by most services
vi.mock('$shared/logger', () => ({
  Logger: class MockLogger {
    info = vi.fn();
    debug = vi.fn();
    warn = vi.fn();
    error = vi.fn();
  },
}));

// Mock memory-manager (used by StreamManager, MessageAccumulatorService)
vi.mock('../memory-manager', () => ({
  memoryManager: {
    registerTimer: vi.fn(() => vi.fn()),
    registerListener: vi.fn(() => vi.fn()),
    registerSubscription: vi.fn(),
    cleanup: vi.fn(),
  },
}));

// Mock unified-state-store for StreamManager
vi.mock('../unified-state-store', () => ({
  unifiedStateStore: {
    getSession: vi.fn(),
    getAllSessionsAcrossWorkspaces: vi.fn(() => []),
    getAllWorkspaces: vi.fn(() => []),
    addSession: vi.fn(),
    setStreaming: vi.fn(),
    updateMessage: vi.fn(),
    updateMessageForWorkspace: vi.fn(),
    setWorkspace: vi.fn(),
    setCurrentWorkspace: vi.fn(),
    setAgent: vi.fn(),
    clear: vi.fn(),
  },
  UnifiedStateStore: undefined as any, // Will be set after import
}));

// Mock electron-bridge (used by StreamManager)
vi.mock('$lib/electron-bridge', () => ({
  invoke: vi.fn(),
}));

// Mock shared types
vi.mock('$shared/types', () => ({
  AgentStatus: { Idle: 'idle', Streaming: 'streaming' },
  WorkspaceStatus: { Active: 'active' },
  normalizeContentBlocks: vi.fn((b: any) => b),
}));

// Mock branded IDs
vi.mock('$shared/types/branded-ids', () => ({
  createMessageId: vi.fn((id: string) => id),
  createAgentId: vi.fn((id: string) => id),
  AgentId: vi.fn((id: string) => id),
  WorkspaceId: vi.fn((id: string) => id),
  SessionId: vi.fn((id: string) => id),
}));

// Mock unified-id.service (used by StreamManager)
vi.mock('$shared/services/unified-id.service', () => ({
  unifiedIdService: {
    generateAgentId: vi.fn(() => 'mock-agent-id'),
    generateMessageId: vi.fn(() => 'mock-message-id'),
  },
}));

// Mock IPC channels
vi.mock('$shared/ipc/channels', () => ({
  AGENT_CHANNELS: {},
  AGENT_BACKEND_CHANNELS: {},
}));

// Mock typed-invoke (used by UnifiedAgentFactory)
vi.mock('$shared/ipc/typed-invoke', () => ({
  typedInvoke: vi.fn(),
}));

// Mock agent-validator (used by UnifiedAgentFactory)
vi.mock('../agent-validator', () => ({
  agentValidator: { validate: vi.fn(() => ({ isValid: true })) },
}));

// Mock agent-name-generator
vi.mock('$lib/utils/agent-name-generator', () => ({
  generateAgentNameFromText: vi.fn(() => 'Test Agent'),
}));

// Mock IPC contracts
vi.mock('$shared/ipc/contracts', () => ({}));

// Mock model defaults
vi.mock('$shared/constants/model-defaults', () => ({
  MODEL_DEFAULTS: { UI_INITIAL_MODEL: 'test-model' },
}));

// Mock agent streaming config
vi.mock('$shared/constants/agent-streaming', () => ({
  AGENT_STREAMING_CONFIG: {
    STREAM_TIMEOUT_MS: 120000,
    KEEP_ALIVE_INTERVAL_MS: 30000,
    BACKEND_STREAM_TIMEOUT_MS: 120000,
  },
}));

// Mock EventEmitter for UnifiedEventBusClient and StreamManager
vi.mock('$lib/utils/browser-event-emitter', () => {
  class MockEventEmitter {
    setMaxListeners = vi.fn();
    on = vi.fn();
    off = vi.fn();
    emit = vi.fn();
    removeAllListeners = vi.fn();
    listeners = vi.fn(() => []);
  }
  return { EventEmitter: MockEventEmitter };
});

// Mock window.electronAPI for UnifiedEventBusClient
if (!(window as any).electronAPI) {
  (window as any).electronAPI = {
    on: vi.fn(),
    off: vi.fn(),
    invoke: vi.fn(),
  };
}

// Mock svelte/store for ChatServiceManager (ChatService uses writable)
vi.mock('svelte/store', () => ({
  writable: vi.fn(() => ({
    subscribe: vi.fn(() => vi.fn()),
    set: vi.fn(),
    update: vi.fn(),
  })),
  get: vi.fn(() => ({})),
}));


// Now import the singletons
import { ChatServiceManager } from '../chat.service';
import { StreamManager } from '../stream-manager';
import { MessageAccumulatorService } from '../message-accumulator.service';
import { UnifiedAgentFactory } from '../agent-factory';
import { UnifiedEventBusClient } from '$features/events/renderer/unified-event-bus-client';

// UnifiedStateStore needs special handling - it's not exported as a class from the mock
// We need to import the real class
let UnifiedStateStore: any;

// Helper to run the standard 3 HMR tests for any singleton
function describeHmrSurvival(
  name: string,
  hmrKey: string,
  staticField: string,
  getClass: () => any,
) {
  describe(name, () => {
    afterEach(() => {
      delete (window as any)[hmrKey];
      const cls = getClass();
      (cls as any)[staticField] = undefined;
    });

    it('should store instance on window for HMR survival', () => {
      const cls = getClass();
      const instance = cls.getInstance();
      expect((window as any)[hmrKey]).toBe(instance);
    });

    it('should recover same instance after simulated HMR (static field reset)', () => {
      const cls = getClass();
      const instance1 = cls.getInstance();

      // Simulate HMR: Vite re-evaluates module, resetting static field
      (cls as any)[staticField] = undefined;

      const instance2 = cls.getInstance();
      expect(instance2).toBe(instance1);
    });

    it('should create new instance when window key is also cleared', () => {
      const cls = getClass();
      const instance1 = cls.getInstance();

      // Full reset: both static field and window
      (cls as any)[staticField] = undefined;
      delete (window as any)[hmrKey];

      const instance2 = cls.getInstance();
      expect(instance2).not.toBe(instance1);
    });
  });
}

describe('HMR Survival', () => {
  describeHmrSurvival(
    'ChatServiceManager',
    '__chatServiceManager_hmr',
    'managerInstance',
    () => ChatServiceManager,
  );

  describeHmrSurvival(
    'StreamManager',
    '__streamManager_hmr',
    'instance',
    () => StreamManager,
  );

  describeHmrSurvival(
    'MessageAccumulatorService',
    '__messageAccumulator_hmr',
    'instance',
    () => MessageAccumulatorService,
  );

  describeHmrSurvival(
    'UnifiedAgentFactory',
    '__agentFactory_hmr',
    'instance',
    () => UnifiedAgentFactory,
  );

  describeHmrSurvival(
    'UnifiedEventBusClient',
    '__unifiedEventBusClient_hmr',
    'instance',
    () => UnifiedEventBusClient,
  );

  // UnifiedStateStore - test separately since it's not exported as a class,
  // and we mock it for other singletons. Use vi.importActual to get the real module.
  describe('UnifiedStateStore', () => {
    const HMR_KEY = '__unifiedStateStore_hmr';
    let realModule: typeof import('../unified-state-store');
    let StoreClass: any;

    // Import the real module once, reuse across tests
    beforeAll(async () => {
      realModule = await vi.importActual<typeof import('../unified-state-store')>('../unified-state-store');
      StoreClass = realModule.unifiedStateStore.constructor;
    });

    afterEach(() => {
      // Reset so each test starts clean but keeps the same class reference
      StoreClass.instance = undefined;
      delete (window as any)[HMR_KEY];
    });

    it('should store instance on window for HMR survival', () => {
      const instance = StoreClass.getInstance();
      expect((window as any)[HMR_KEY]).toBe(instance);
    });

    it('should recover same instance after simulated HMR (static field reset)', () => {
      const instance1 = StoreClass.getInstance();

      // Simulate HMR: reset static field but window key persists
      StoreClass.instance = undefined;

      const instance2 = StoreClass.getInstance();
      expect(instance2).toBe(instance1);
    });

    it('should create new instance when window key is also cleared', () => {
      const instance1 = StoreClass.getInstance();

      // Full reset
      StoreClass.instance = undefined;
      delete (window as any)[HMR_KEY];

      const instance2 = StoreClass.getInstance();
      expect(instance2).not.toBe(instance1);
    });
  });
});

