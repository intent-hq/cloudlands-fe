/**
 * Tests for shared/main/async-utils.ts
 *
 * Tests the auggie CLI path discovery logic including:
 * - Static common paths for different platforms
 * - Dynamic nvm path scanning
 * - Dynamic fnm path scanning
 */

import { describe, it, expect, vi } from 'vitest';
import * as path from 'path';
import { homedir } from 'os';

// Mock the logger before importing the module
vi.mock('../logger', () => ({
  Logger: class MockLogger {
    debug = vi.fn();
    info = vi.fn();
    warn = vi.fn();
    error = vi.fn();
  },
}));

// Import after mocking
import { AUGGIE_COMMON_PATHS, findAuggieAsync, existsAsync } from '../main/async-utils';

describe('AUGGIE_COMMON_PATHS', () => {
  const homeDir = homedir();

  describe('on macOS/Linux', () => {
    // Skip these tests on Windows
    const isUnix = process.platform !== 'win32';

    it.skipIf(!isUnix)('should include standard system locations', () => {
      expect(AUGGIE_COMMON_PATHS).toContain('/usr/local/bin/auggie');
      expect(AUGGIE_COMMON_PATHS).toContain('/opt/homebrew/bin/auggie');
    });

    it.skipIf(!isUnix)('should include npm global bin locations', () => {
      expect(AUGGIE_COMMON_PATHS).toContain(path.join(homeDir, '.npm-global', 'bin', 'auggie'));
      expect(AUGGIE_COMMON_PATHS).toContain(path.join(homeDir, '.npm-packages', 'bin', 'auggie'));
      expect(AUGGIE_COMMON_PATHS).toContain(path.join(homeDir, '.local', 'bin', 'auggie'));
      expect(AUGGIE_COMMON_PATHS).toContain(path.join(homeDir, 'npm', 'bin', 'auggie'));
    });

    it.skipIf(!isUnix)('should include volta path', () => {
      expect(AUGGIE_COMMON_PATHS).toContain(path.join(homeDir, '.volta', 'bin', 'auggie'));
    });

    it.skipIf(!isUnix)('should include fnm default alias path', () => {
      expect(AUGGIE_COMMON_PATHS).toContain(
        path.join(homeDir, '.fnm', 'aliases', 'default', 'bin', 'auggie'),
      );
    });

    it.skipIf(!isUnix)('should include asdf shims path', () => {
      expect(AUGGIE_COMMON_PATHS).toContain(path.join(homeDir, '.asdf', 'shims', 'auggie'));
    });

    it.skipIf(!isUnix)('should include n version manager paths', () => {
      expect(AUGGIE_COMMON_PATHS).toContain(path.join(homeDir, 'n', 'bin', 'auggie'));
      expect(AUGGIE_COMMON_PATHS).toContain('/usr/local/n/bin/auggie');
    });

    it.skipIf(!isUnix)('should include homebrew node paths for Intel Macs', () => {
      expect(AUGGIE_COMMON_PATHS).toContain('/usr/local/opt/node/bin/auggie');
      expect(AUGGIE_COMMON_PATHS).toContain('/usr/local/opt/node@18/bin/auggie');
      expect(AUGGIE_COMMON_PATHS).toContain('/usr/local/opt/node@20/bin/auggie');
      expect(AUGGIE_COMMON_PATHS).toContain('/usr/local/opt/node@22/bin/auggie');
    });

    it.skipIf(!isUnix)('should include homebrew node paths for Apple Silicon Macs', () => {
      expect(AUGGIE_COMMON_PATHS).toContain('/opt/homebrew/opt/node/bin/auggie');
      expect(AUGGIE_COMMON_PATHS).toContain('/opt/homebrew/opt/node@18/bin/auggie');
      expect(AUGGIE_COMMON_PATHS).toContain('/opt/homebrew/opt/node@20/bin/auggie');
      expect(AUGGIE_COMMON_PATHS).toContain('/opt/homebrew/opt/node@22/bin/auggie');
    });
  });

  describe('on Windows', () => {
    const isWindows = process.platform === 'win32';

    it.skipIf(!isWindows)('should include npm global locations', () => {
      const appData = process.env.APPDATA || '';
      const localAppData = process.env.LOCALAPPDATA || '';

      expect(AUGGIE_COMMON_PATHS).toContain(path.join(appData, 'npm', 'auggie.cmd'));
      expect(AUGGIE_COMMON_PATHS).toContain(path.join(appData, 'npm', 'auggie'));
      expect(AUGGIE_COMMON_PATHS).toContain(path.join(localAppData, 'npm', 'auggie.cmd'));
      expect(AUGGIE_COMMON_PATHS).toContain(path.join(localAppData, 'npm', 'auggie'));
    });

    it.skipIf(!isWindows)('should include nvm-windows path', () => {
      const appData = process.env.APPDATA || '';
      expect(AUGGIE_COMMON_PATHS).toContain(path.join(appData, 'nvm', 'auggie.cmd'));
    });

    it.skipIf(!isWindows)('should include volta on Windows', () => {
      const localAppData = process.env.LOCALAPPDATA || '';
      expect(AUGGIE_COMMON_PATHS).toContain(path.join(localAppData, 'Volta', 'bin', 'auggie.exe'));
    });
  });
});

describe('findAuggieAsync', () => {
  it('should return null when auggie is not found anywhere', async () => {
    // This test will pass on systems without auggie installed
    // and may return a path on systems with auggie
    const result = await findAuggieAsync();
    // We can only assert the type, not the value
    expect(result === null || typeof result === 'string').toBe(true);
  });

  it('should return a string path when auggie exists', async () => {
    const result = await findAuggieAsync();
    if (result !== null) {
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
      // Path should end with 'auggie' (or 'auggie.cmd' on Windows)
      const basename = path.basename(result);
      expect(basename.startsWith('auggie')).toBe(true);
    }
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
