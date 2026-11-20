import { describe, expect, it } from 'vitest';
import {
  hiddenHomeRepositories,
  isHomeRepositoryHidden,
  newestHomeRepositoryWorkspace,
  readdedHomeRepositories,
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

// Failure cases: a deleted folder still lists under Hidden, never comes back when
// added again, or comes back from a stale recent list that still had it.
describe('removed Home folders', () => {
  const workspaces = [at('2026-11-01T10:00:00Z')];
  const newest = newestHomeRepositoryWorkspace(workspaces);
  const folder = { key: '/repos/tools', label: 'tools', repoPath: '/repos/tools', workspaces };
  const github = { key: 'acme/app', label: 'acme/app', repoPath: '/repos/app', workspaces };
  const hidden = { [folder.key]: newest, [github.key]: newest };

  it('leaves a removed folder out of the Hidden section', () => {
    expect(hiddenHomeRepositories(hidden, [folder, github], [folder.key])).toEqual([github]);
    expect(hiddenHomeRepositories(hidden, [folder, github])).toEqual([github, folder]);
  });

  it('brings a removed folder back when it is added again', () => {
    const known = [{ path: '/repos/tools', addedAt: '2026-11-05T00:00:00Z' }];
    expect(readdedHomeRepositories(hidden, [folder.key], [folder, github], known)).toEqual([
      folder.key,
    ]);
  });

  it('ignores a recent list entry from before the removal', () => {
    const stale = [{ path: '/repos/tools', addedAt: '2026-10-01T00:00:00Z' }];
    expect(readdedHomeRepositories(hidden, [folder.key], [folder], stale)).toEqual([]);
    const fresh = [{ path: '/repos/app', addedAt: '2026-11-05T00:00:00Z' }];
    expect(readdedHomeRepositories(hidden, [folder.key], [folder, github], fresh)).toEqual([]);
  });
});
