import { describe, expect, it } from 'vitest';
import {
  hideHomeRepository,
  isHomeRepositoryHidden,
  withoutRevivedHomeRepositories,
} from './home-hidden-repos';

const at = (iso: string) => ({ createdAt: iso });

// Failure cases: a hidden repository never comes back, comes back on its own
// existing workspaces, comes back from a client/daemon clock gap, or rewrites
// preferences on every render when nothing changed.
describe('hidden Home repositories', () => {
  it('stays hidden until a workspace newer than the hide appears', () => {
    const workspaces = [at('2026-11-01T10:00:00Z'), at('2026-11-02T10:00:00Z')];
    const hidden = hideHomeRepository({}, 'acme/app', workspaces);
    expect(isHomeRepositoryHidden(hidden, { key: 'acme/app', workspaces })).toBe(true);
    const created = [...workspaces, at('2026-11-02T10:00:01Z')];
    expect(isHomeRepositoryHidden(hidden, { key: 'acme/app', workspaces: created })).toBe(false);
  });

  it('uses daemon creation times, so a client clock ahead of the daemon still unhides', () => {
    const hidden = hideHomeRepository({}, '/home/me/plain', []);
    const repo = { key: '/home/me/plain', workspaces: [at('2001-01-01T00:00:00Z')] };
    expect(isHomeRepositoryHidden(hidden, repo)).toBe(false);
  });

  it('never hides a repository that was not hidden', () => {
    expect(isHomeRepositoryHidden({}, { key: 'acme/app', workspaces: [] })).toBe(false);
  });

  it('drops only revived entries, and reports no change otherwise', () => {
    const hidden = {
      ...hideHomeRepository({}, 'acme/app', [at('2026-11-01T10:00:00Z')]),
      ...hideHomeRepository({}, 'acme/web', []),
      ...hideHomeRepository({}, 'acme/gone', []),
    };
    const repos = [
      { key: 'acme/app', workspaces: [at('2026-11-01T10:00:00Z')] },
      { key: 'acme/web', workspaces: [at('2026-11-03T10:00:00Z')] },
    ];
    expect(withoutRevivedHomeRepositories(hidden, repos)).toEqual({
      'acme/app': hidden['acme/app'],
      'acme/gone': hidden['acme/gone'],
    });
    expect(withoutRevivedHomeRepositories(hidden, repos.slice(0, 1))).toBeNull();
  });
});
