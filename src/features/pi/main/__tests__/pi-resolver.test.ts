/**
 * Tests for pi-resolver module: `pi` engine detection and cache clearing.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../shared/main/find-binary', () => ({
  findBinary: vi.fn(),
  findBinaryStrict: vi.fn(),
  getCommonNpmPaths: vi.fn(() => []),
}));

import { findBinary, findBinaryStrict } from '../../../../shared/main/find-binary';
import { clearPiCache, isPiInstalled, getPiPath } from '../pi-resolver';

describe('pi-resolver', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearPiCache();
  });

  describe('clearPiCache()', () => {
    it('clears the cached pi path so re-detection uses new values', async () => {
      vi.mocked(findBinary).mockImplementation(async (name) => {
        if (name === 'pi') return '/first/pi';
        return null;
      });

      expect(await getPiPath()).toBe('/first/pi');

      clearPiCache();
      vi.mocked(findBinary).mockImplementation(async (name) => {
        if (name === 'pi') return '/second/pi';
        return null;
      });

      expect(await getPiPath()).toBe('/second/pi');
    });
  });

  describe('isPiInstalled()', () => {
    it('returns true when the pi engine is found', async () => {
      vi.mocked(findBinaryStrict).mockImplementation(async (name) => {
        if (name === 'pi') return '/usr/local/bin/pi';
        return null;
      });

      expect(await isPiInstalled()).toBe(true);
    });

    it('returns false when the pi engine is not found', async () => {
      vi.mocked(findBinaryStrict).mockResolvedValue(null);
      expect(await isPiInstalled()).toBe(false);
    });

    it('propagates a probe failure instead of reporting uninstalled', async () => {
      // A failed daemon RPC proves nothing about availability — the caller
      // (provider availability check) must see the failure, not false.
      vi.mocked(findBinaryStrict).mockRejectedValue(new Error('transport down'));

      await expect(isPiInstalled()).rejects.toThrow('transport down');
    });
  });

  describe('getPiPath()', () => {
    it('returns the path when the pi engine is found', async () => {
      vi.mocked(findBinary).mockImplementation(async (name) => {
        if (name === 'pi') return '/usr/local/bin/pi';
        return null;
      });

      expect(await getPiPath()).toBe('/usr/local/bin/pi');
    });

    it('returns null when the pi engine is not found', async () => {
      vi.mocked(findBinary).mockResolvedValue(null);
      expect(await getPiPath()).toBeNull();
    });
  });
});
