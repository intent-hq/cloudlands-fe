/**
 * `.intent/config.json` (`RepoConfig`) schema tests — daemon parity.
 *
 * intentd#614 added `cowCloneExclude` (optional array of repo-root-relative
 * directory prefixes) to the daemon `RepoConfig`; these tests pin the FE
 * schema parity: parse accepts the field and a read→write round-trip
 * preserves it (and unknown keys) instead of stripping them.
 */
import { describe, it, expect } from 'vitest';

import { RepoConfigSchema, type RepoConfig } from '../repo-config.types';

describe('RepoConfigSchema', () => {
  it('parses a full config including cowCloneExclude', () => {
    const raw = {
      branchPrefix: 'feat/',
      setupScript: 'pnpm install',
      instructions: 'Use TypeScript strict mode',
      runScript: 'pnpm dev',
      archiveScript: 'docker compose down',
      scripts: [
        {
          name: 'dev',
          command: 'pnpm dev',
          mode: 'service',
          category: 'dev',
          cwd: 'frontend',
          env: { NODE_ENV: 'development' },
          autoStart: true,
        },
        { name: 'test', command: 'cargo test', mode: 'command', category: 'test' },
      ],
      cowCloneExclude: ['node_modules', 'target/debug'],
    };

    const parsed: RepoConfig = RepoConfigSchema.parse(raw);
    expect(parsed.cowCloneExclude).toEqual(['node_modules', 'target/debug']);
    expect(parsed.scripts?.[0].mode).toBe('service');
  });

  it('treats cowCloneExclude as optional (absent ⇒ no exclusions)', () => {
    const parsed = RepoConfigSchema.parse({ setupScript: 'npm ci' });
    expect(parsed.cowCloneExclude).toBeUndefined();
  });

  it('rejects a non-string-array cowCloneExclude', () => {
    expect(() => RepoConfigSchema.parse({ cowCloneExclude: 'node_modules' })).toThrow();
    expect(() => RepoConfigSchema.parse({ cowCloneExclude: [42] })).toThrow();
  });

  it('round-trips cowCloneExclude and unknown keys without stripping (parity with daemon serde flatten)', () => {
    const raw = {
      setupScript: 'pnpm install',
      cowCloneExclude: ['node_modules', '.cache'],
      futureField: { nested: true },
      scripts: [{ name: 'dev', command: 'pnpm dev', mode: 'service', futureScriptField: 'x' }],
    };

    const roundTripped = JSON.parse(JSON.stringify(RepoConfigSchema.parse(raw)));
    expect(roundTripped).toEqual(raw);
  });
});
