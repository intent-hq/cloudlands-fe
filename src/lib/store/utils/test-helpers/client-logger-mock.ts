/**
 * Shared mock for `$lib/utils/client-logger` used across test files.
 *
 * Provides a mock logger with vitest spy functions for all log levels.
 * The module's exports match the shape of `$lib/utils/client-logger`,
 * so it can be used as a direct vi.mock replacement.
 *
 * Usage in test files:
 * ```ts
 * vi.mock('$lib/utils/client-logger', async () => await import('$lib/store/utils/test-helpers/client-logger-mock'));
 * ```
 *
 * If you need to assert on logger calls, import `mockLogger`:
 * ```ts
 * import { mockLogger } from '$lib/store/utils/test-helpers/client-logger-mock';
 * expect(mockLogger.warn).toHaveBeenCalled();
 * ```
 */

import { vi } from 'vitest';

/** Create a fresh mock logger with independent spy functions. */
export function createMockLogger() {
  const logger = {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    setLevel: vi.fn(),
    child: vi.fn(),
  };
  // child() returns the same mock logger for simplicity
  logger.child.mockReturnValue(logger);
  return logger;
}

/** Singleton mock logger instance – use this when asserting on log calls. */
export const mockLogger = createMockLogger();

/**
 * Drop-in replacement for the real `createLogger`.
 * Returns the shared `mockLogger` so all callers share the same spies.
 */
 
export function createLogger(_name?: string) {
  return mockLogger;
}

/** Alias so `import { logger } from '$lib/utils/client-logger'` resolves. */
export const logger = mockLogger;

/**
 * Mock `ClientLogger` class matching the interface of the real one.
 * Constructor and all methods are vi.fn() stubs.
 */
export class ClientLogger {
  info = vi.fn();
  debug = vi.fn();
  warn = vi.fn();
  error = vi.fn();
  setLevel = vi.fn();
  child = vi.fn(() => new ClientLogger());
}

// Re-export types so `import type { LogLevel }` resolves without hitting the real module.
export type { LogLevel, LoggerOptions } from '$lib/utils/client-logger';

