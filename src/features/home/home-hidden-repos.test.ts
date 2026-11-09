import { describe, expect, it } from 'vitest';
import {
  isHomeRepositoryHidden,
  newestHomeRepositoryWorkspace,
  revivedHomeRepositories,
} from './home-hidden-repos';

const at = (iso: string) => ({ createdAt: iso });

// Failure cases: a hidden repository never comes back, comes back on its own
// existing workspaces, comes back from a client/daemon clock gap, or rewrites
// preferences on every render when nothing changed.
describe('hidden Home repositories', () => {
  it('stays hidden until a workspace newer than the hide appears', () => {
    const workspaces = [at('2026-11-01T10:00:00Z'), at('2026-11-02T10:00:00Z')];
    const hidden = { 'acme/app': newestHomeRepositoryWorkspace(workspaces) };
    expect(isHomeRepositoryHidden(hidden, { key: 'acme/app', workspaces })).toBe(true);
    const created = [...workspaces, at('2026-11-02T10:00:01Z')];
    expect(isHomeRepositoryHidden(hidden, { key: 'acme/app', workspaces: created })).toBe(false);
  });

  it('uses daemon creation times, so a client clock ahead of the daemon still unhides', () => {
    const hidden = { '/home/me/plain': newestHomeRepositoryWorkspace([]) };
    const repo = { key: '/home/me/plain', workspaces: [at('2001-01-01T00:00:00Z')] };
    expect(isHomeRepositoryHidden(hidden, repo)).toBe(false);
  });

  it('never hides a repository that was not hidden', () => {
    expect(isHomeRepositoryHidden({}, { key: 'acme/app', workspaces: [] })).toBe(false);
  });

  it('reports only revived repositories, and nothing when unchanged', () => {
    const hidden = {
      'acme/app': newestHomeRepositoryWorkspace([at('2026-11-01T10:00:00Z')]),
      'acme/web': 0,
      'acme/gone': 0,
    };
    const repos = [
      { key: 'acme/app', workspaces: [at('2026-11-01T10:00:00Z')] },
      { key: 'acme/web', workspaces: [at('2026-11-03T10:00:00Z')] },
    ];
    expect(revivedHomeRepositories(hidden, repos)).toEqual(['acme/web']);
    expect(revivedHomeRepositories(hidden, repos.slice(0, 1))).toEqual([]);
  });
});
