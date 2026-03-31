/**
 * Tests for claude-code-resolver module and provider-config validation.
 *
 * Ensures the migration from claude-code-acp to claude-agent-acp is correct
 * and guards against regression.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../shared/main/find-binary', () => ({
  findBinary: vi.fn(),
  getCommonNpmPaths: vi.fn(() => []),
}));

import { findBinary } from '../../../../shared/main/find-binary';
import {
  resolveClaudeCodeCommand,
  clearClaudeCodeCache,
  isClaudeCodeInstalled,
  getClaudeCodePath,
} from '../claude-code-resolver';
import { ACP_PROVIDERS } from '../../../../shared/config/provider-config';

describe('claude-code-resolver', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearClaudeCodeCache();
  });

  describe('resolveClaudeCodeCommand()', () => {
    it('returns null when Claude CLI is not found', async () => {
      vi.mocked(findBinary).mockResolvedValue(null);

      const result = await resolveClaudeCodeCommand();
      expect(result).toBeNull();
    });

    it('returns direct binary when claude-agent-acp is found', async () => {
      vi.mocked(findBinary).mockImplementation(async (name, _opts) => {
        if (name === 'claude') return '/usr/local/bin/claude';
        if (name === 'claude-agent-acp') return '/usr/local/bin/claude-agent-acp';
        return null;
      });

      const result = await resolveClaudeCodeCommand();
      expect(result).not.toBeNull();
      expect(result!.usesNpx).toBe(false);
      expect(result!.command).toBe('/usr/local/bin/claude-agent-acp');
      expect(result!.argsPrefix).toEqual([]);
    });

    it('falls back to npx when no direct binary is available', async () => {
      vi.mocked(findBinary).mockImplementation(async (name, _opts) => {
        if (name === 'claude') return '/usr/local/bin/claude';
        if (name === 'claude-agent-acp') return null;
        if (name === 'npx') return '/usr/local/bin/npx';
        return null;
      });

      const result = await resolveClaudeCodeCommand();
      expect(result).not.toBeNull();
      expect(result!.usesNpx).toBe(true);
      expect(result!.command).toBe('/usr/local/bin/npx');
      expect(result!.argsPrefix).toContain('@zed-industries/claude-agent-acp');
    });

    it('returns null when neither direct binary nor npx is available', async () => {
      vi.mocked(findBinary).mockImplementation(async (name, _opts) => {
        if (name === 'claude') return '/usr/local/bin/claude';
        return null;
      });

      const result = await resolveClaudeCodeCommand();
      expect(result).toBeNull();
    });
  });

  describe('package name verification (regression guard)', () => {
    it('npx fallback uses new package name @zed-industries/claude-agent-acp', async () => {
      vi.mocked(findBinary).mockImplementation(async (name, _opts) => {
        if (name === 'claude') return '/usr/local/bin/claude';
        if (name === 'npx') return '/usr/local/bin/npx';
        return null;
      });

      const result = await resolveClaudeCodeCommand();
      expect(result).not.toBeNull();
      expect(result!.argsPrefix).toContain('@zed-industries/claude-agent-acp');
      // Must NOT reference the deprecated package name
      expect(result!.argsPrefix.join(' ')).not.toContain('claude-code-acp');
    });
  });

  describe('clearClaudeCodeCache()', () => {
    it('clears all cached paths so re-detection uses new values', async () => {
      // First call: claude + agent-acp found
      vi.mocked(findBinary).mockImplementation(async (name, _opts) => {
        if (name === 'claude') return '/first/claude';
        if (name === 'claude-agent-acp') return '/first/claude-agent-acp';
        return null;
      });

      const first = await resolveClaudeCodeCommand();
      expect(first!.command).toBe('/first/claude-agent-acp');

      // Clear cache and change mock
      clearClaudeCodeCache();
      vi.mocked(findBinary).mockImplementation(async (name, _opts) => {
        if (name === 'claude') return '/second/claude';
        if (name === 'claude-agent-acp') return '/second/claude-agent-acp';
        return null;
      });

      const second = await resolveClaudeCodeCommand();
      expect(second!.command).toBe('/second/claude-agent-acp');
    });
  });

  describe('isClaudeCodeInstalled()', () => {
    it('returns true when claude CLI is found', async () => {
      vi.mocked(findBinary).mockImplementation(async (name, _opts) => {
        if (name === 'claude') return '/usr/local/bin/claude';
        return null;
      });

      expect(await isClaudeCodeInstalled()).toBe(true);
    });

    it('returns false when claude CLI is not found', async () => {
      vi.mocked(findBinary).mockResolvedValue(null);
      expect(await isClaudeCodeInstalled()).toBe(false);
    });
  });

  describe('getClaudeCodePath()', () => {
    it('returns the path when claude CLI is found', async () => {
      vi.mocked(findBinary).mockImplementation(async (name, _opts) => {
        if (name === 'claude') return '/usr/local/bin/claude';
        return null;
      });

      expect(await getClaudeCodePath()).toBe('/usr/local/bin/claude');
    });

    it('returns null when claude CLI is not found', async () => {
      vi.mocked(findBinary).mockResolvedValue(null);
      expect(await getClaudeCodePath()).toBeNull();
    });
  });
});

describe('Provider config snapshot', () => {
  it("ACP_PROVIDERS['claude-code'].command equals 'claude-agent-acp'", () => {
    expect(ACP_PROVIDERS['claude-code'].command).toBe('claude-agent-acp');
  });

  it('does not reference deprecated claude-code-acp package', () => {
    const config = ACP_PROVIDERS['claude-code'];
    expect(config.command).not.toContain('claude-code-acp');
    expect(config.id).toBe('claude-code');
  });
});
