/**
 * @vitest-environment jsdom
 */
import { cleanup, render } from '@testing-library/svelte';
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

  it('does not override the Button focus contract on agent rows', () => {
    const { container } = render(AIBehaviorSidebar, {
      activeView: { type: 'specialist', id: 'implementor' },
      onSelect: vi.fn(),
    });

    const rows = [...container.querySelectorAll<HTMLElement>('[data-settings-agent-row]')];
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      const focusClasses = [...row.classList].filter((className) =>
        className.startsWith('focus-visible:'),
      );
      expect(focusClasses.some((className) => className.includes('ring-'))).toBe(false);
      expect(focusClasses).not.toContain('focus-visible:outline-none');
    }
  });
});
