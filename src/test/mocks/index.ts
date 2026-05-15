/**
 * Test Mocks Index
 *
 * Central export point for all mock implementations used in testing.
 *
 * Note: IPC Mock is located in tests/mocks/ipc.mock.ts
 */

import { MockStreamManager } from './streaming.mock';
import { MockPersistenceService } from './persistence.mock';
import { MockSessionRegistry } from './session-registry.mock';

// Streaming Mock
export { MockStreamManager } from './streaming.mock';
export type { MockStreamChunk, MockStreamSession } from './streaming.mock';

// Persistence Mock
export { MockPersistenceService } from './persistence.mock';
export type { MockStorageData } from './persistence.mock';

// Session Registry Mock
export { MockSessionRegistry } from './session-registry.mock';

/**
 * Create a complete mock environment for testing
 */
export function createMockEnvironment() {
  return {
    streaming: new MockStreamManager(),
    persistence: new MockPersistenceService(),
    sessionRegistry: new MockSessionRegistry(),
  };
}

/**
 * Clean up all mocks
 */
export function cleanupMockEnvironment(env: ReturnType<typeof createMockEnvironment>) {
  env.streaming.clear();
  env.persistence.clear();
  env.sessionRegistry.clear();
}
