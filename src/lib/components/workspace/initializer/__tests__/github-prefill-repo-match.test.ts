/**
 * Unit tests for matchGitHubPrefillRepo: local match via stored metadata and
 * via remote probing, GitHub clone-flow fallback, and the non-fatal 'keep'
 * fallback when probing errors.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  matchGitHubPrefillRepo,
  type GitHubPrefillRepoCandidate,
} from '../github-prefill-repo-match';

const noRemote = vi.fn(async () => null);

function local(path: string, extra?: Partial<GitHubPrefillRepoCandidate>) {
  return { path, type: 'local' as const, ...extra };
}

describe('matchGitHubPrefillRepo', () => {
  it('matches a local candidate via probed git remote', async () => {
    const probeRemote = vi.fn(async (path: string) =>
      path === '/repos/monorepo' ? { owner: 'intent-hq', repo: 'monorepo' } : null,
    );
    const result = await matchGitHubPrefillRepo({
      owner: 'intent-hq',
      repo: 'monorepo',
      candidates: [local('/repos/other'), local('/repos/monorepo')],
      probeRemote,
    });
    expect(result).toEqual({ kind: 'local', path: '/repos/monorepo' });
    expect(probeRemote).toHaveBeenCalledWith('/repos/other');
    expect(probeRemote).toHaveBeenCalledWith('/repos/monorepo');
  });

  it('matches via stored recent-repo metadata without probing', async () => {
    const probeRemote = vi.fn(async () => null);
    const result = await matchGitHubPrefillRepo({
      owner: 'intent-hq',
      repo: 'monorepo',
      candidates: [local('/repos/monorepo', { owner: 'intent-hq', name: 'monorepo' })],
      probeRemote,
    });
    expect(result).toEqual({ kind: 'local', path: '/repos/monorepo' });
    expect(probeRemote).not.toHaveBeenCalled();
  });

  it('matches a recent github-clone candidate via its githubUrl', async () => {
    const result = await matchGitHubPrefillRepo({
      owner: 'Intent-HQ',
      repo: 'monorepo',
      candidates: [
        {
          path: '~/Developer/monorepo',
          type: 'github',
          githubUrl: 'https://github.com/intent-hq/monorepo.git',
        },
      ],
      probeRemote: noRemote,
    });
    expect(result).toEqual({
      kind: 'clone',
      githubUrl: 'https://github.com/intent-hq/monorepo.git',
      clonePath: '~/Developer/monorepo',
    });
  });

  it('is case-insensitive and ignores a .git suffix', async () => {
    const probeRemote = vi.fn(async () => ({ owner: 'Intent-HQ', repo: 'Monorepo.git' }));
    const result = await matchGitHubPrefillRepo({
      owner: 'intent-hq',
      repo: 'monorepo',
      candidates: [local('/repos/monorepo')],
      probeRemote,
    });
    expect(result).toEqual({ kind: 'local', path: '/repos/monorepo' });
  });

  it('does not probe when stored metadata is conclusive but mismatched', async () => {
    const probeRemote = vi.fn(async () => ({ owner: 'intent-hq', repo: 'monorepo' }));
    const result = await matchGitHubPrefillRepo({
      owner: 'intent-hq',
      repo: 'monorepo',
      candidates: [local('/repos/other', { owner: 'someone', name: 'other' })],
      probeRemote,
    });
    expect(probeRemote).not.toHaveBeenCalled();
    expect(result.kind).toBe('clone');
  });

  it('falls back to the GitHub clone flow when nothing matches', async () => {
    const result = await matchGitHubPrefillRepo({
      owner: 'intent-hq',
      repo: 'monorepo',
      candidates: [local('/repos/other')],
      defaultParentPath: '/Users/me/Code/',
      probeRemote: noRemote,
    });
    expect(result).toEqual({
      kind: 'clone',
      githubUrl: 'https://github.com/intent-hq/monorepo',
      clonePath: '/Users/me/Code/monorepo',
    });
  });

  it('defaults the clone parent to ~/Developer', async () => {
    const result = await matchGitHubPrefillRepo({
      owner: 'intent-hq',
      repo: 'monorepo',
      candidates: [],
      probeRemote: noRemote,
    });
    expect(result).toEqual({
      kind: 'clone',
      githubUrl: 'https://github.com/intent-hq/monorepo',
      clonePath: '~/Developer/monorepo',
    });
  });

  it('returns keep when a probe throws (non-fatal fallback)', async () => {
    const result = await matchGitHubPrefillRepo({
      owner: 'intent-hq',
      repo: 'monorepo',
      candidates: [local('/repos/a')],
      probeRemote: vi.fn(async () => {
        throw new Error('ipc down');
      }),
    });
    expect(result).toEqual({ kind: 'keep' });
  });

  it('dedupes candidates and caps remote probes at 10', async () => {
    const probeRemote = vi.fn(async () => null);
    const candidates = [
      local('/dup'),
      local('/dup'),
      ...Array.from({ length: 15 }, (_, i) => local(`/repo-${i}`)),
    ];
    const result = await matchGitHubPrefillRepo({
      owner: 'intent-hq',
      repo: 'monorepo',
      candidates,
      probeRemote,
    });
    expect(result.kind).toBe('clone');
    expect(probeRemote).toHaveBeenCalledTimes(10);
  });
});
