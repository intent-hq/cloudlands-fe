/**
 * @vitest-environment jsdom
 *
 * SpecialistDropdown (the proposal card's initial-agent picker) orders its
 * options like the New workspace picker: specialists used to create
 * workspaces first, most recent first, then the rest in catalog order.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  function writable<T>(initial: T) {
    let value = initial;
    const subs = new Set<(v: T) => void>();
    return {
      subscribe(run: (v: T) => void) {
        subs.add(run);
        run(value);
        return () => subs.delete(run);
      },
      set(v: T) {
        value = v;
        for (const run of subs) run(v);
      },
    };
  }
  return {
    specialists$: writable<Array<{ id: string; name: string; description: string }>>([]),
    recentSpecialistIds$: writable<string[]>([]),
    githubAuth$: writable(true),
  };
});

vi.mock('$store/renderer/slices/specialists/specialists-selectors', () => ({
  selectSpecialists: () => mocks.specialists$,
  filterPickableSpecialists: <T>(specialists: T[]) => specialists,
}));

vi.mock('$store/renderer/slices/github-auth/github-auth-selectors', () => ({
  selectGitHubAuthIsAuthenticated: () => mocks.githubAuth$,
}));

vi.mock('$store/renderer/slices/workspace-initializer/workspace-initializer-selectors', () => ({
  selectWorkspaceInitializerRecentSpecialistIds: () => mocks.recentSpecialistIds$,
}));

vi.mock('$features/agent/components/agent-avatar/AgentAvatar.svelte', async () => ({
  default: (await import('../workspace/initializer/__tests__/mocks/MockComponent.svelte')).default,
}));

vi.mock('svelte-fa', async () => ({
  default: (await import('../workspace/initializer/__tests__/mocks/MockComponent.svelte')).default,
}));

import SpecialistDropdown from './SpecialistDropdown.svelte';
import { SPECIALISTS } from '$lib/constants/specialists';

const catalog = [
  { id: 'developer', name: 'Developer', description: 'Builds things' },
  { id: 'reviewer', name: 'Reviewer', description: 'Reviews things' },
  { id: 'researcher', name: 'Researcher', description: 'Finds things' },
  { id: 'writer', name: 'Writer', description: 'Writes things' },
];

async function openOptionIds(): Promise<string[]> {
  await fireEvent.click(screen.getByRole('button', { name: /General/ }));
  await screen.findByRole('menuitemradio', { name: /General/ });
  return screen
    .getAllByRole('menuitemradio')
    .map((item) => item.getAttribute('data-specialist-option') ?? '');
}

describe('SpecialistDropdown ordering', () => {
  beforeEach(() => {
    mocks.specialists$.set(catalog);
    mocks.recentSpecialistIds$.set([]);
  });

  afterEach(() => {
    cleanup();
  });

  it.each(['developer-legacy', 'coordinator-legacy', 'implementor-legacy', 'verifier-legacy'])(
    'allows explicit selection of %s',
    async (id) => {
      mocks.specialists$.set(SPECIALISTS);
      const onchange = vi.fn();
      render(SpecialistDropdown, { props: { value: null, onchange } });
      expect(await openOptionIds()).toContain(id);
      await fireEvent.click(document.querySelector(`[data-specialist-option="${id}"]`)!);
      expect(onchange).toHaveBeenCalledExactlyOnceWith(id);
    },
  );

  it('keeps catalog order when nothing has been used', async () => {
    render(SpecialistDropdown, { props: { value: null } });

    expect(await openOptionIds()).toEqual([
      'general',
      'developer',
      'reviewer',
      'researcher',
      'writer',
    ]);
  });

  it('lists recently used specialists first, newest first, then the rest in catalog order', async () => {
    mocks.recentSpecialistIds$.set(['writer', 'removed-specialist', 'reviewer']);
    render(SpecialistDropdown, { props: { value: null } });

    expect(await openOptionIds()).toEqual([
      'general',
      'writer',
      'reviewer',
      'developer',
      'researcher',
    ]);
  });
});
