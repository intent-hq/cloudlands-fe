/**
 * Mock for electron-bridge module
 * Used in tests to simulate Electron IPC without requiring Electron environment
 */

import { vi } from 'vitest';

// Mock implementation of isElectron
export const isElectron = vi.fn(() => false);

// Mock implementation of invoke
export const invoke = vi.fn(async (channel: string, data?: any) => {
  // Return mock responses based on channel
  switch (channel) {
    case 'user-rules:get-formatted':
      return {
        success: true,
        data: '# Test User Rules\nBe helpful and accurate.',
      };
    case 'user-rules:get-combined-prompt':
      return {
        success: true,
        data: `${data?.basePrompt || ''}\n\n# Test User Rules\nBe helpful and accurate.`,
      };
    case 'agent:create':
      return {
        success: true,
        data: {
          id: 'test-agent-id',
          backendSessionId: 'test-session-id',
          status: 'Active',
        },
      };
    case 'agent:send-message':
      return {
        success: true,
        data: {
          messageId: 'test-message-id',
        },
      };
    default:
      return { success: true, data: null };
  }
});

// Mock implementation of listen (deprecated - use listenSync instead)
export const listen = vi.fn(async (event: string, handler: (payload: any) => void) =>
  // Return unsubscribe function
  () => {
    // No-op
  },
);

// Mock implementation of listenSync (synchronous version - preferred)
export const listenSync = vi.fn((event: string, handler: (payload: any) => void) =>
  // Return unsubscribe function immediately (synchronously)
  () => {
    // No-op
  },
);

// Mock implementation of emit
export const emit = vi.fn(async (event: string, payload?: any) => {
  // No-op
});

// Mock implementation of on (deprecated - use listenSync instead)
export const on = vi.fn((event: string, handler: (...args: any[]) => void) =>
  // Return a mock listener ID
  `mock-listener-${event}-${Date.now()}`,
);

// Mock implementation of off (deprecated - use listenSync which handles cleanup)
export const off = vi.fn((event: string, handler: (...args: any[]) => void) => {
  // No-op
});
