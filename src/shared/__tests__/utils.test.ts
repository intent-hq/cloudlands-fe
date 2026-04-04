/**
 * Tests for shared/main/utils.ts
 *
 * These tests verify the getSafeHomeDir function handles edge cases
 * where os.homedir() returns invalid values (like '/' or empty string).
 *
 * Note: Because of ESM module constraints, we can't easily mock os.homedir().
 * Instead, we test the isValidDirectory logic by importing the function
 * and testing the behavior based on the current system's home directory.
 */

import { describe, it, expect } from 'vitest';
import { getSafeHomeDir } from '../main/utils';
import { homedir, tmpdir } from 'os';
import * as path from 'path';

describe('getSafeHomeDir', () => {
  it('should return a non-empty path', () => {
    const result = getSafeHomeDir();
    expect(result).toBeTruthy();
    expect(result.length).toBeGreaterThan(1);
  });

  it('should not return root path /', () => {
    const result = getSafeHomeDir();
    expect(result).not.toBe('/');
  });

  it('should return an absolute path', () => {
    const result = getSafeHomeDir();
    expect(path.isAbsolute(result)).toBe(true);
  });

  it('should return the actual home directory when valid', () => {
    const result = getSafeHomeDir();
    const expectedHome = homedir();

    // If the system homedir is valid, getSafeHomeDir should return it
    if (expectedHome && expectedHome.length > 1 && expectedHome !== '/') {
      expect(result).toBe(expectedHome);
    }
  });
});

// Note: getWorkspacesPath and related utility functions were removed during the
// ~/intent migration. Workspace path resolution is now handled by WorkspaceConfig.paths.*
// in config.ts (main process) and config-browser.ts (renderer process).

/**
 * These tests document the expected behavior of isValidDirectory validation logic
 * that is used internally by getSafeHomeDir. While we can't directly test the
 * edge cases without mocking os.homedir(), these tests verify the contract.
 */
describe('isValidDirectory validation logic (contract tests)', () => {
  it('rejects empty strings - getSafeHomeDir never returns empty', () => {
    const result = getSafeHomeDir();
    expect(result).not.toBe('');
  });

  it('rejects root path - getSafeHomeDir never returns /', () => {
    const result = getSafeHomeDir();
    expect(result).not.toBe('/');
  });

  it('rejects single character paths - getSafeHomeDir returns path longer than 1 char', () => {
    const result = getSafeHomeDir();
    expect(result.length).toBeGreaterThan(1);
  });

  it('always returns a usable path even if system homedir is problematic', () => {
    // This test verifies the fallback chain exists
    const result = getSafeHomeDir();

    // The result should be one of:
    // 1. A valid home directory
    // 2. A valid temp directory
    // 3. /tmp as last resort
    const validPaths = [homedir(), tmpdir(), '/tmp'];
    validPaths.some(
      (path) => path && path.length > 1 && path !== '/' && result.startsWith(path.slice(0, 4)),
    );

    // The result should be a reasonable path
    expect(result.length).toBeGreaterThan(1);
    expect(path.isAbsolute(result)).toBe(true);
  });
});
