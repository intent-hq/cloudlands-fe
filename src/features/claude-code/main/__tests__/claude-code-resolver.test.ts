/**
 * Tests for claude-code-resolver module and provider-config validation.
 *
 * The ACP adapter always runs via npx with a pinned package version; direct
 * claude-agent-acp binaries are never probed. Guards against regression.
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
  CLAUDE_AGENT_ACP_NPX_SPEC,
  CLAUDE_AGENT_ACP_VERSION,
  resolveClaudeCodeCommand,
  resolveClaudeCodeCommandDetailed,
  clearClaudeCodeCache,
  isClaudeCodeInstalled,
  isNpxAvailableForClaudeCode,
  getClaudeCodePath,
} from '../claude-code-resolver';


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

    it('always resolves via npx with the pinned adapter version', async () => {
      vi.mocked(findBinary).mockImplementation(async (name) => {
        if (name === 'claude') return '/usr/local/bin/claude';
        if (name === 'npx') return '/usr/local/bin/npx';
        return null;
      });

      const result = await resolveClaudeCodeCommand();
      expect(result).not.toBeNull();
      expect(result!.usesNpx).toBe(true);
      expect(result!.command).toBe('/usr/local/bin/npx');
      expect(result!.argsPrefix).toEqual(['-y', CLAUDE_AGENT_ACP_NPX_SPEC]);
      expect(CLAUDE_AGENT_ACP_NPX_SPEC).toBe(
        `@agentclientprotocol/claude-agent-acp@${CLAUDE_AGENT_ACP_VERSION}`,
      );
    });

    it('never probes for a direct claude-agent-acp binary', async () => {
      vi.mocked(findBinary).mockImplementation(async (name) => {
        if (name === 'claude') return '/usr/local/bin/claude';
        if (name === 'claude-agent-acp') return '/usr/local/bin/claude-agent-acp';
        if (name === 'npx') return '/usr/local/bin/npx';
        return null;
      });

      const result = await resolveClaudeCodeCommand();
      expect(result).not.toBeNull();
      expect(result!.usesNpx).toBe(true);
      expect(result!.command).toBe('/usr/local/bin/npx');
      const probedNames = vi.mocked(findBinary).mock.calls.map(([name]) => name);
      expect(probedNames).not.toContain('claude-agent-acp');
    });

    it('returns null when npx is not available', async () => {
      vi.mocked(findBinary).mockImplementation(async (name) => {
        if (name === 'claude') return '/usr/local/bin/claude';
        return null;
      });

      const result = await resolveClaudeCodeCommand();
      expect(result).toBeNull();
    });
  });

  describe('resolveClaudeCodeCommandDetailed()', () => {
    it("reports 'claude-cli-missing' when the claude CLI is not found", async () => {
      vi.mocked(findBinary).mockResolvedValue(null);

      const resolution = await resolveClaudeCodeCommandDetailed();
      expect(resolution).toEqual({ ok: false, reason: 'claude-cli-missing' });
    });

    it("reports 'npx-missing' when the claude CLI is present but npx is not", async () => {
      vi.mocked(findBinary).mockImplementation(async (name) => {
        if (name === 'claude') return '/usr/local/bin/claude';
        return null;
      });

      const resolution = await resolveClaudeCodeCommandDetailed();
      expect(resolution).toEqual({ ok: false, reason: 'npx-missing' });
    });

    it('resolves the pinned npx command when both are present', async () => {
      vi.mocked(findBinary).mockImplementation(async (name) => {
        if (name === 'claude') return '/usr/local/bin/claude';
        if (name === 'npx') return '/usr/local/bin/npx';
        return null;
      });

      const resolution = await resolveClaudeCodeCommandDetailed();
      expect(resolution.ok).toBe(true);
      if (resolution.ok) {
        expect(resolution.resolved.command).toBe('/usr/local/bin/npx');
        expect(resolution.resolved.argsPrefix).toEqual(['-y', CLAUDE_AGENT_ACP_NPX_SPEC]);
        expect(resolution.resolved.usesNpx).toBe(true);
      }
    });
  });

  describe('isNpxAvailableForClaudeCode()', () => {
    it('returns true when npx is found', async () => {
      vi.mocked(findBinary).mockImplementation(async (name) => {
        if (name === 'npx') return '/usr/local/bin/npx';
        return null;
      });

      expect(await isNpxAvailableForClaudeCode()).toBe(true);
    });

    it('returns false when npx is not found', async () => {
      vi.mocked(findBinary).mockResolvedValue(null);
      expect(await isNpxAvailableForClaudeCode()).toBe(false);
    });
  });

  describe('package name verification (regression guard)', () => {
    it('npx spec uses @agentclientprotocol/claude-agent-acp with a pinned version', async () => {
      vi.mocked(findBinary).mockImplementation(async (name) => {
        if (name === 'claude') return '/usr/local/bin/claude';
        if (name === 'npx') return '/usr/local/bin/npx';
        return null;
      });

      const result = await resolveClaudeCodeCommand();
      expect(result).not.toBeNull();
      expect(result!.argsPrefix.join(' ')).toContain('@agentclientprotocol/claude-agent-acp@');
      // Must NOT reference deprecated package names or float on latest
      expect(result!.argsPrefix.join(' ')).not.toContain('claude-code-acp');
      expect(result!.argsPrefix.join(' ')).not.toContain('@zed-industries/');
      expect(result!.argsPrefix.join(' ')).not.toContain('@latest');
    });
  });

  describe('clearClaudeCodeCache()', () => {
    it('clears all cached paths so re-detection uses new values', async () => {
      vi.mocked(findBinary).mockImplementation(async (name) => {
        if (name === 'claude') return '/first/claude';
        if (name === 'npx') return '/first/npx';
        return null;
      });

      const first = await resolveClaudeCodeCommand();
      expect(first!.command).toBe('/first/npx');

      // Clear cache and change mock
      clearClaudeCodeCache();
      vi.mocked(findBinary).mockImplementation(async (name) => {
        if (name === 'claude') return '/second/claude';
        if (name === 'npx') return '/second/npx';
        return null;
      });

      const second = await resolveClaudeCodeCommand();
      expect(second!.command).toBe('/second/npx');
    });
  });

  describe('isClaudeCodeInstalled()', () => {
    it('returns true when claude CLI is found', async () => {
      vi.mocked(findBinary).mockImplementation(async (name) => {
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
      vi.mocked(findBinary).mockImplementation(async (name) => {
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

// The provider registry (command names, ids) is compiled into the intentd
// daemon and served via providers.catalog (PROTOCOL §5.38); its row shape is
// pinned by the daemon's own tests, not by FE snapshots.
