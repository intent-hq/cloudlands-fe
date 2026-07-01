import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
} from 'vitest';

// Mock logger before importing the module under test
vi.mock('../../../shared/logger', () => ({
  Logger: class MockLogger {
    debug = vi.fn();
    info = vi.fn();
    warn = vi.fn();
    error = vi.fn();
  },
}));

// Mock electron-store (required by auggie-path module)
vi.mock('electron-store', () => ({
  default: class MockStore {
    get = vi.fn();
    set = vi.fn();
  },
}));

const { mockHostRequest, mockGetEnhancedPath } = vi.hoisted(() => ({
  mockHostRequest: vi.fn(),
  mockGetEnhancedPath: vi.fn(),
}));

// Mock the daemon backend client used by findAuggiePathAsync / findAuggieInEnhancedPath.
vi.mock('../../backend/main/backend.ipc', () => ({
  getBackendClient: () => ({ request: mockHostRequest }),
}));

// Mock the shared find-binary module so getEnhancedPath delegates to a spy and
// no other shared/main code is dragged into the test.
vi.mock('../../../shared/main/find-binary', () => ({
  getEnhancedPath: mockGetEnhancedPath,
}));

import {
  findAuggieInEnhancedPath,
  findAuggiePathAsync,
  getEnhancedPath,
} from '../main/auggie-path';

describe('auggie-path — host-backed PATH and binary discovery', () => {
  beforeEach(() => {
    mockHostRequest.mockReset();
    mockGetEnhancedPath.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('getEnhancedPath', () => {
    it('returns whatever the shared host-backed getEnhancedPath returns', () => {
      mockGetEnhancedPath.mockReturnValue('/host/enhanced/path');
      expect(getEnhancedPath()).toBe('/host/enhanced/path');
      expect(mockGetEnhancedPath).toHaveBeenCalledTimes(1);
    });

    it('does not mutate process.env.PATH', () => {
      const originalPath = process.env.PATH;
      mockGetEnhancedPath.mockReturnValue('/something/else');
      getEnhancedPath();
      expect(process.env.PATH).toBe(originalPath);
    });
  });

  describe('findAuggiePathAsync (host.checkAuggie wire contract)', () => {
    it('sends host.checkAuggie and returns the daemon-resolved path', async () => {
      mockHostRequest.mockResolvedValue({
        available: true,
        path: '/Users/test/.augment/bin/auggie',
        version: '0.123.0',
      });

      const result = await findAuggiePathAsync();

      expect(result).toBe('/Users/test/.augment/bin/auggie');
      expect(mockHostRequest).toHaveBeenCalledWith('host.checkAuggie');
    });

    it('returns null when the daemon reports auggie unavailable', async () => {
      mockHostRequest.mockResolvedValue({ available: false });
      const result = await findAuggiePathAsync();
      expect(result).toBeNull();
    });

    it('returns null when the daemon request rejects', async () => {
      mockHostRequest.mockRejectedValue(new Error('transport down'));
      const result = await findAuggiePathAsync();
      expect(result).toBeNull();
    });
  });

  describe('findAuggieInEnhancedPath (alias for daemon-backed discovery)', () => {
    it('delegates to host.checkAuggie without mutating process.env.PATH', async () => {
      const originalPath = process.env.PATH;
      mockHostRequest.mockResolvedValue({
        available: true,
        path: '/usr/local/bin/auggie',
      });

      const result = await findAuggieInEnhancedPath();

      expect(result).toBe('/usr/local/bin/auggie');
      expect(mockHostRequest).toHaveBeenCalledWith('host.checkAuggie');
      expect(process.env.PATH).toBe(originalPath);
    });

    it('returns null when the daemon reports auggie unavailable', async () => {
      mockHostRequest.mockResolvedValue({ available: false });
      const result = await findAuggieInEnhancedPath();
      expect(result).toBeNull();
    });
  });
});
