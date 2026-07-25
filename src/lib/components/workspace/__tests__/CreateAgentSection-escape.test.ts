/**
 * CreateAgentSection.svelte Escape handling via the escape-layer stack.
 * Migrated from a manual `document` keydown listener; the layer is only
 * registered while the dropdown is expanded.
 */
import {
  describe,
  it,
  expect,
  vi,
  afterEach,
} from 'vitest';
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from '@testing-library/svelte';

vi.mock('$store/renderer/slices/specialists/specialists-selectors', async () => {
  const { createAppStoreMock } =
    await import('$store/renderer/utils/test-helpers/store-mock');
  const store = createAppStoreMock({ state: {} });
  return {
    selectSpecialists: store.createSelector(() => []),
    filterPickableSpecialists: (specialists: unknown[]) => specialists,
  };
});

vi.mock('$store/renderer/slices/github-auth/github-auth-selectors', async () => {
  const { createAppStoreMock } =
    await import('$store/renderer/utils/test-helpers/store-mock');
  const store = createAppStoreMock({ state: {} });
  return { selectGitHubAuthIsAuthenticated: store.createSelector(() => false) };
});

vi.mock('$lib/utils/workspace-navigation', () => ({
  navigateToSettings: vi.fn(async () => {}),
}));

vi.mock('$lib/components/ui/Portal.svelte', async () => {
  const MockPortal = (
    await import('../../modals/__tests__/mocks/MockPortal.svelte')
  ).default;
  return { default: MockPortal };
});

// AuggieAvatar reads a live store selector internally — stub it out.
vi.mock('$lib/components/ui/auggie-avatar/AuggieAvatar.svelte', async () => ({
  default: (
    await import('../initializer/__tests__/mocks/MockComponent.svelte')
  ).default,
}));

vi.mock('svelte-fa', async () => {
  const MockFa = (
    await import('../../ui/__tests__/mocks/Fa.svelte')
  ).default;
  return { default: MockFa, Fa: MockFa };
});

import CreateAgentSection from '../CreateAgentSection.svelte';

async function expandDropdown() {
  const trigger = screen.getByText('Create new agent');
  await fireEvent.click(trigger);
  await waitFor(() => {
    expect(screen.getByText('Blank Agent')).toBeTruthy();
  });
}

describe('CreateAgentSection Escape handling (escape-layer stack)', () => {
  afterEach(() => {
    cleanup();
  });

  it('Escape collapses the expanded dropdown', async () => {
    render(CreateAgentSection, { props: {} });
    await expandDropdown();

    await fireEvent.keyDown(window, { key: 'Escape' });

    await waitFor(() => {
      expect(screen.queryByText('Blank Agent')).toBeFalsy();
    });
  });

  it('Escape is not consumed while collapsed (no layer registered)', async () => {
    render(CreateAgentSection, { props: {} });
    expect(screen.queryByText('Blank Agent')).toBeFalsy();

    const event = new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
  });
});
