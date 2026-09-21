/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const readable = <T>(value: T) => ({
    subscribe(run: (next: T) => void) {
      run(value);
      return () => {};
    },
  });

  return {
    readable,
    specialists$: readable([
      {
        id: 'implementor',
        name: 'Implementor',
        description: 'Implements tasks',
      },
    ]),
    fileSpecialists$: readable([]),
  };
});

vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');
  return createAppStoreMockModule({
    state: () => ({ uiHighlight: { activeById: {} } }),
  });
});

vi.mock('$store/renderer/slices/specialists/specialists-selectors', () => ({
  selectSpecialists: () => mocks.specialists$,
  selectFileSpecialists: () => mocks.fileSpecialists$,
  filterSpecialistsByGitHubAuth: (specialists: unknown[]) => specialists,
  selectHasOverrides: { select: () => false },
  selectSpecialistSourceLabel: { select: () => undefined },
}));

vi.mock('$store/renderer/slices/github-auth/github-auth-selectors', () => ({
  selectGitHubAuthIsAuthenticated: () => mocks.readable(true),
}));

vi.mock('svelte-fa', async () => ({
  default: (await import('$lib/components/ui/__tests__/mocks/Fa.svelte')).default,
}));

import AIBehaviorSidebar from './AIBehaviorSidebar.svelte';

describe('AIBehaviorSidebar', () => {
  afterEach(cleanup);

  it('moves the current page from a specialist to creation and clears it outside specialists', async () => {
    const { container, rerender } = render(AIBehaviorSidebar, {
      activeView: { type: 'specialist', id: 'implementor' },
      onSelect: vi.fn(),
    });
    const current = () => container.querySelectorAll('[aria-current="page"]');
    expect(current()).toHaveLength(1);
    expect(current()[0].id).toBe('specialist-implementor');
    expect(current()[0].getAttribute('data-state')).toBe('active');

    await rerender({ activeView: { type: 'create-specialist' } });
    expect(current()).toHaveLength(1);
    expect(current()[0].id).toBe('create-specialist');
    expect(current()[0].getAttribute('data-state')).toBe('active');
    expect(
      container.querySelector('#specialist-implementor')?.getAttribute('data-state'),
    ).toBeNull();

    await rerender({ isActive: false });
    expect(current()).toHaveLength(0);
    expect(container.querySelector('[data-state="active"]')).toBeNull();
  });

  it('dispatches distinct specialist and creation selections', async () => {
    const onSelect = vi.fn();
    const { container } = render(AIBehaviorSidebar, {
      activeView: { type: 'specialist', id: 'implementor' },
      onSelect,
    });

    await fireEvent.click(container.querySelector('#specialist-implementor')!);
    expect(onSelect).toHaveBeenLastCalledWith({ type: 'specialist', id: 'implementor' });
    await fireEvent.click(container.querySelector('#create-specialist')!);
    expect(onSelect).toHaveBeenLastCalledWith({ type: 'create-specialist' });
    expect(onSelect).toHaveBeenCalledTimes(2);
  });
});
