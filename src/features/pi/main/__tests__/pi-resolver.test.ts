/**
 * Tests for pi-resolver module and provider-config wiring.
 *
 * Mirrors claude-code-resolver tests: covers binary/npx fallback,
 * cache clearing, install detection, and the ACP_PROVIDERS.pi shape.
 */

import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
} from 'vitest';

vi.mock('../../../../shared/main/find-binary', () => ({
  findBinary: vi.fn(),
  getCommonNpmPaths: vi.fn(() => []),
}));

import { findBinary } from '../../../../shared/main/find-binary';
import {
  resolvePiCommand,
  clearPiCache,
  isPiInstalled,
  getPiPath,
} from '../pi-resolver';
import { ACP_PROVIDERS } from '../../../../shared/config/provider-config';

describe('pi-resolver', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearPiCache();
  });

  describe('resolvePiCommand()', () => {
    it('always returns npx -y pi-acp when npx is found', async () => {
      vi.mocked(findBinary).mockImplementation(async (name) => {
        if (name === 'npx') return '/usr/local/bin/npx';
        return null;
      });

      const result = await resolvePiCommand();
      expect(result).not.toBeNull();
      expect(result!.usesNpx).toBe(true);
      expect(result!.command).toBe('/usr/local/bin/npx');
      expect(result!.argsPrefix).toEqual(['-y', 'pi-acp']);
    });

    it('returns null when npx is not available', async () => {
      vi.mocked(findBinary).mockResolvedValue(null);

      const result = await resolvePiCommand();
      expect(result).toBeNull();
    });
  });

  describe('clearPiCache()', () => {
    it('clears all cached paths so re-detection uses new values', async () => {
      vi.mocked(findBinary).mockImplementation(async (name) => {
        if (name === 'npx') return '/first/npx';
        return null;
      });

      const first = await resolvePiCommand();
      expect(first!.command).toBe('/first/npx');

      clearPiCache();
      vi.mocked(findBinary).mockImplementation(async (name) => {
        if (name === 'npx') return '/second/npx';
        return null;
      });

      const second = await resolvePiCommand();
      expect(second!.command).toBe('/second/npx');
    });
  });

  describe('isPiInstalled()', () => {
    it('returns true when the pi engine is found', async () => {
      vi.mocked(findBinary).mockImplementation(async (name) => {
        if (name === 'pi') return '/usr/local/bin/pi';
        return null;
      });

      expect(await isPiInstalled()).toBe(true);
    });

    it('returns false when the pi engine is not found', async () => {
      vi.mocked(findBinary).mockResolvedValue(null);
      expect(await isPiInstalled()).toBe(false);
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

describe('Pi provider config', () => {
  it('ACP_PROVIDERS.pi is present with the expected shape', () => {
    const config = ACP_PROVIDERS['pi'];
    expect(config).toBeDefined();
    expect(config.id).toBe('pi');
    expect(config.command).toBe('pi-acp');
    expect(config.canBeDisabled).toBe(true);
    expect(config.isDefault).toBe(false);
    expect(config.ipcChannelPrefix).toBe('pi');
  });
});
