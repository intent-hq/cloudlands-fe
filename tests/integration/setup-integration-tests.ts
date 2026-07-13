/**
 * Integration Test Setup
 *
 * Global setup for all integration tests including mocks,
 * environment configuration, and cleanup handlers.
 */

import { beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import { randomUUID } from 'crypto';
import {
  _resetMainStoreBridge,
  initMainStoreBridge,
} from '../../src/store/main/redux-store-bridge';

vi.mock('electron', () => ({
  app: {
    getPath: () => process.cwd(),
    isPackaged: false,
    on: vi.fn(),
    once: vi.fn(),
    whenReady: vi.fn(async () => undefined),
    quit: vi.fn(),
  },
  BrowserWindow: {
    getAllWindows: vi.fn(() => []),
    getFocusedWindow: vi.fn(() => null),
  },
  ipcMain: {
    handle: vi.fn(),
    on: vi.fn(),
    removeHandler: vi.fn(),
    removeAllListeners: vi.fn(),
  },
  shell: {
    openExternal: vi.fn(),
    openPath: vi.fn(),
    showItemInFolder: vi.fn(),
  },
  dialog: {
    showOpenDialog: vi.fn(),
    showMessageBox: vi.fn(),
  },
}));

vi.mock('electron-store', () => ({
  default: class MockElectronStore {
    private data: Record<string, unknown> = {};

    get(key: string, defaultValue?: unknown) {
      return key in this.data ? this.data[key] : defaultValue;
    }

    set(key: string, value: unknown) {
      this.data[key] = value;
    }

    delete(key: string) {
      delete this.data[key];
    }

    clear() {
      this.data = {};
    }
  },
}));

try {
  initMainStoreBridge({
    state: {},
    dispatch: (action: any) => action,
  } as any);
} catch {
  // Some test files install their own bridge; keep the first initialized bridge.
}

// Test environment configuration
const TEST_ENV = {
  WORKSPACE_ROOT: path.join(process.cwd(), '.test-workspaces'),
  AGENT_ROOT: path.join(process.cwd(), '.test-agents'),
  PERSISTENCE_ROOT: path.join(process.cwd(), '.test-persistence'),
  LOG_LEVEL: process.env.LOG_LEVEL || 'error',
  ENABLE_PERFORMANCE_TRACKING: 'true',
  ENABLE_MEMORY_TRACKING: 'true',
  TEST_MODE: 'true',
};

// Apply test environment
Object.assign(process.env, TEST_ENV);

// Global test state
let testDirectories: string[] = [];

/**
 * Create test directory structure
 */
async function createTestDirectories() {
  const dirs = [TEST_ENV.WORKSPACE_ROOT, TEST_ENV.AGENT_ROOT, TEST_ENV.PERSISTENCE_ROOT];

  for (const dir of dirs) {
    await fs.mkdir(dir, { recursive: true });
    testDirectories.push(dir);
  }
}

/**
 * Cleanup test directories
 */
async function cleanupTestDirectories() {
  for (const dir of testDirectories) {
    try {
      await fs.rm(dir, { recursive: true, force: true });
    } catch (error) {
      console.warn(`Failed to cleanup ${dir}:`, error);
    }
  }
  testDirectories = [];
}

/**
 * Mock IPC for testing
 */
function setupIPCMocks() {
  // Mock electron IPC if not available
  if (!global.window?.electron) {
    global.window = {
      ...global.window,
      electron: {
        invoke: async (channel: string, ...args: any[]) => {
          console.log(`Mock IPC invoke: ${channel}`, args);
          // Return mock responses based on channel
          switch (channel) {
            case 'agent:create':
              return {
                success: true,
                agent: {
                  id: `agent-${randomUUID()}`,
                  name: args[0]?.name || 'Mock Agent',
                  status: 'idle',
                  messages: [],
                  workspaceId: args[0]?.workspaceId || `workspace-${randomUUID()}`,
                },
              };
            case 'workspace:create':
              return {
                success: true,
                data: {
                  id: `workspace-${randomUUID()}`,
                  title: args[0]?.title || 'Mock Workspace',
                  status: 'active',
                  createdAt: new Date().toISOString(),
                },
              };
            default:
              return { success: true };
          }
        },
        on: (channel: string) => {
          console.log(`Mock IPC on: ${channel}`);
          return () => {}; // Return unsubscribe function
        },
        off: (channel: string) => {
          console.log(`Mock IPC off: ${channel}`);
        },
      },
    };
  }
}

/**
 * Setup performance monitoring
 */
function setupPerformanceMonitoring() {
  // Enable garbage collection tracking if available
  if (global.gc) {
    console.log('Garbage collection tracking enabled');
  } else {
    console.log('Run with --expose-gc flag to enable GC tracking');
  }

  // Track test performance
  const originalIt = global.it;
  global.it = function (name: string, fn: Function, timeout?: number) {
    return originalIt(
      name,
      async () => {
        const start = performance.now();
        try {
          await fn();
        } finally {
          const duration = performance.now() - start;
          if (duration > 1000) {
            console.warn(`Slow test detected: "${name}" took ${duration.toFixed(2)}ms`);
          }
        }
      },
      timeout,
    );
  } as any;
}

// Global setup
beforeAll(async () => {
  console.log('🚀 Setting up integration test environment');
  await createTestDirectories();
  setupIPCMocks();
  setupPerformanceMonitoring();
});

// Global teardown
afterAll(async () => {
  console.log('🧹 Cleaning up integration test environment');
  await cleanupTestDirectories();
  _resetMainStoreBridge();
});

// Test-level setup
beforeEach(() => {
  // Reset any global state
});

// Test-level teardown
afterEach(() => {
  // Clean up any test-specific resources
});

export { TEST_ENV };
