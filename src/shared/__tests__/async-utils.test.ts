/**
 * Tests for shared/main/async-utils.ts
 *
 * Auggie CLI discovery is daemon-canonical: `findAuggieAsync` must delegate
 * to the daemon-backed `findAuggiePathAsync` (`host.checkAuggie`) with no
 * local cache files or hardcoded install-path lists.
 */

import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
} from 'vitest';

// test-setup.ts globally mocks $shared/main/async-utils; this suite tests the
// real module, so cancel that mock for this file.
vi.unmock('$shared/main/async-utils');

// Mock the logger before importing the module
vi.mock('../logger', () => ({
  Logger: class MockLogger {
    debug = vi.fn();
    info = vi.fn();
    warn = vi.fn();
    error = vi.fn();
  },
}));

const { mockFindAuggiePathAsync } = vi.hoisted(() => ({
  mockFindAuggiePathAsync: vi.fn(),
}));

// Mock the daemon-backed auggie discovery that findAuggieAsync delegates to.
vi.mock('../../features/auggie/main/auggie-path', () => ({
  findAuggiePathAsync: mockFindAuggiePathAsync,
}));

// Import after mocking
import {
  findAuggieAsync,
  existsAsync,
} from '../main/async-utils';

describe('findAuggieAsync (daemon-backed delegation)', () => {
  beforeEach(() => {
    mockFindAuggiePathAsync.mockReset();
  });

  it('returns the daemon-resolved path from findAuggiePathAsync', async () => {
    mockFindAuggiePathAsync.mockResolvedValue('/Users/test/.augment/bin/auggie');
    const result = await findAuggieAsync();
    expect(result).toBe('/Users/test/.augment/bin/auggie');
    expect(mockFindAuggiePathAsync).toHaveBeenCalledTimes(1);
  });

  it('returns null when the daemon reports auggie unavailable', async () => {
    mockFindAuggiePathAsync.mockResolvedValue(null);
    const result = await findAuggieAsync();
    expect(result).toBeNull();
    expect(mockFindAuggiePathAsync).toHaveBeenCalledTimes(1);
  });
});

describe('existsAsync', () => {
  it('should return true for existing paths', async () => {
    // Test with a path that definitely exists
    const result = await existsAsync('/');
    expect(result).toBe(true);
  });

  it('should return false for non-existing paths', async () => {
    const result = await existsAsync('/this/path/definitely/does/not/exist/auggie');
    expect(result).toBe(false);
  });
});
