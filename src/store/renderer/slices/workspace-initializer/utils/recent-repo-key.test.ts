import { describe, expect, it } from 'vitest';
import { recentRepoKey } from './recent-repo-key';

describe('recent repository identity keys', () => {
  it('keeps configured root prefixes and project paths case-sensitive', () => {
    const key = (path: string) => recentRepoKey({ type: 'github', path });
    expect(key('https://git.example.test:8443/Forge/Team/App')).not.toBe(
      key('https://git.example.test:8443/forge/Team/App'),
    );
    expect(key('https://git.example.test:8443/Forge/Team/App')).not.toBe(
      key('https://git.example.test:8443/Forge/Team/app'),
    );
  });

  it('retains case-insensitive GitHub shorthand and exact local paths', () => {
    expect(recentRepoKey({ type: 'github', path: 'Octo/Repo' })).toBe(
      recentRepoKey({ type: 'github', path: 'octo/repo' }),
    );
    expect(recentRepoKey({ type: 'local', path: '/owned/Repo' })).not.toBe(
      recentRepoKey({ type: 'local', path: '/owned/repo' }),
    );
  });
});
