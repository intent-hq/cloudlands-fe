import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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

// Mock find-binary
vi.mock('../../../shared/main/find-binary', () => ({
  findBinary: vi.fn().mockResolvedValue(null),
}));

// Mock async-utils
vi.mock('../../../shared/main/async-utils', () => ({
  findAuggieAsync: vi.fn().mockResolvedValue(null),
}));

// vi.hoisted runs before vi.mock factories, so the references are valid.
const { mockExistsSync, mockReadFileSync, mockReaddirSync } = vi.hoisted(() => ({
  mockExistsSync: vi.fn<(path: string) => boolean>(() => false),
  mockReadFileSync: vi.fn(() => ''),
  mockReaddirSync: vi.fn(() => []),
}));

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    __esModule: true,
    ...actual,
    default: {
      ...actual,
      existsSync: mockExistsSync,
      readFileSync: mockReadFileSync,
      readdirSync: mockReaddirSync,
    },
    existsSync: mockExistsSync,
    readFileSync: mockReadFileSync,
    readdirSync: mockReaddirSync,
  };
});

import { getEnhancedPath, findAuggieInEnhancedPath } from '../main/auggie-path';
import { findBinary } from '../../../shared/main/find-binary';

describe('getEnhancedPath — empty segment filtering', () => {
  const originalPATH = process.env.PATH;
  const originalPlatform = process.platform;

  beforeEach(() => {
    mockExistsSync.mockReturnValue(false);
  });

  afterEach(() => {
    process.env.PATH = originalPATH;
    Object.defineProperty(process, 'platform', { value: originalPlatform });
  });

  it('filters out empty segments from PATH="/a::/b"', () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    process.env.PATH = '/a::/b';
    const result = getEnhancedPath();
    const segments = result.split(':');
    // No empty segment should appear
    expect(segments.every((s) => s.length > 0)).toBe(true);
    expect(segments).toContain('/a');
    expect(segments).toContain('/b');
  });

  it('filters out trailing empty segment from PATH="/a:"', () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    process.env.PATH = '/a:';
    const result = getEnhancedPath();
    const segments = result.split(':');
    expect(segments.every((s) => s.length > 0)).toBe(true);
    expect(segments).toContain('/a');
  });

  it('trims whitespace from PATH entries', () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    process.env.PATH = '/usr/bin: /opt/homebrew/bin';
    const result = getEnhancedPath();
    const segments = result.split(':');
    expect(segments).toContain('/opt/homebrew/bin');
    expect(segments).not.toContain(' /opt/homebrew/bin');
  });
});


describe('findAuggieInEnhancedPath — PATH override', () => {
  const originalPATH = process.env.PATH;
  const originalPlatform = process.platform;
  const mockFindBinary = vi.mocked(findBinary);

  beforeEach(() => {
    mockExistsSync.mockReturnValue(false);
    mockFindBinary.mockReset();
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    process.env.PATH = '/original/path';
  });

  afterEach(() => {
    process.env.PATH = originalPATH;
    Object.defineProperty(process, 'platform', { value: originalPlatform });
  });

  it('sets process.env.PATH to getEnhancedPath() when findBinary is invoked', async () => {
    let capturedPATH: string | undefined;
    mockFindBinary.mockImplementation(async () => {
      capturedPATH = process.env.PATH;
      return '/usr/local/bin/auggie';
    });

    await findAuggieInEnhancedPath();

    // The captured PATH should be the enhanced one (not the original)
    const enhanced = getEnhancedPath();
    // Reset PATH first since getEnhancedPath reads process.env.PATH
    process.env.PATH = '/original/path';
    expect(capturedPATH).toBe(enhanced);
  });

  it('restores process.env.PATH after successful return', async () => {
    mockFindBinary.mockResolvedValue('/usr/local/bin/auggie');

    await findAuggieInEnhancedPath();

    expect(process.env.PATH).toBe('/original/path');
  });

  it('restores process.env.PATH after findBinary throws', async () => {
    mockFindBinary.mockRejectedValue(new Error('lookup failed'));

    await expect(findAuggieInEnhancedPath()).rejects.toThrow('lookup failed');

    expect(process.env.PATH).toBe('/original/path');
  });

  it('returns null when findBinary returns null', async () => {
    mockFindBinary.mockResolvedValue(null);

    const result = await findAuggieInEnhancedPath();

    expect(result).toBeNull();
    expect(process.env.PATH).toBe('/original/path');
  });

  it('restores PATH to undefined (not the string "undefined") when PATH was unset', async () => {
    delete process.env.PATH;
    mockFindBinary.mockResolvedValue(null);

    await findAuggieInEnhancedPath();

    expect(process.env.PATH).toBeUndefined();
    expect('PATH' in process.env).toBe(false);
  });
});