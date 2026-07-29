/**
 * @vitest-environment jsdom
 *
 * Programmatic focus of the context picker's search input: the input must
 * receive focus whenever the panel opens (toggle click and initiallyExpanded
 * mount), and focus must not be re-stolen while the panel stays open.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const readable = <T>(value: T) => ({
    subscribe(run: (v: T) => void) {
      run(value);
      return () => {};
    },
  });
  const selector = <T>(value: T) => Object.assign(() => readable(value), { select: () => value });
  return { readable, selector };
});

vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } = await import(
    '$store/renderer/utils/test-helpers/store-mock'
  );
  return createAppStoreMockModule({ state: () => ({ theme: { name: 'dark' } }) });
});

vi.mock('$store/renderer/slices/github-auth/github-auth-selectors', () => ({
  selectGitHubAuthIsAuthenticated: mocks.selector(false),
  selectGitHubAuthIsAuthenticating: mocks.selector(false),
}));
vi.mock('$store/renderer/slices/github-auth/github-auth-slice', () => ({
  startGitHubAuth: () => ({ type: 'github-auth/start' }),
}));
vi.mock('$store/renderer/slices/linear-auth/linear-auth-selectors', () => ({
  selectLinearIsAuthenticating: mocks.selector(false),
}));
vi.mock('$store/renderer/slices/linear-auth/linear-auth-slice', () => ({
  startLinearAuth: () => ({ type: 'linear-auth/start' }),
}));
vi.mock('$store/renderer/slices/sentry-auth/sentry-auth-selectors', () => ({
  selectSentryIsConnecting: mocks.selector(false),
  selectSentryError: mocks.selector(null),
}));
vi.mock('$store/renderer/slices/sentry-auth/sentry-auth-slice', () => ({
  connectSentry: () => ({ type: 'sentry-auth/connect' }),
}));
vi.mock('$store/renderer/slices/workspace/workspace-selectors', () => ({
  selectActiveWorkspaceId: mocks.selector(null),
}));

vi.mock('$features/linear-auth/renderer/linear-auth.client', () => ({
  linearAuthClient: {
    getAuthState: vi.fn(async () => ({ isAuthenticated: false })),
    fetchMyIssuesPage: vi.fn(async () => ({ issues: [], nextToken: null })),
    searchIssuesPage: vi.fn(async () => ({ issues: [], nextToken: null })),
  },
}));
vi.mock('$features/sentry-auth/renderer/sentry-auth.client', () => ({
  sentryAuthClient: {
    getAuthState: vi.fn(async () => ({ isAuthenticated: false })),
    fetchIssuesPage: vi.fn(async () => ({ issues: [], nextToken: null })),
    searchIssuesPage: vi.fn(async () => ({ issues: [], nextToken: null })),
  },
}));
vi.mock('$features/navigation/link-handler', () => ({ handleLink: vi.fn() }));
vi.mock('$lib/utils/platform-capabilities', () => ({ isElectronPlatform: () => true }));

vi.mock('svelte-fa', async () => {
  const MockFa = (await import('../../../ui/__tests__/mocks/Fa.svelte')).default;
  return { default: MockFa, Fa: MockFa };
});
vi.mock('$lib/components/ui/skeleton', async () => ({
  Skeleton: (await import('./mocks/MockComponent.svelte')).default,
}));
vi.mock('$lib/components/ui/tooltip', async () => ({
  TooltipRich: (await import('./mocks/MockComponent.svelte')).default,
}));
vi.mock('$lib/components/ui/Header.svelte', async () => ({
  default: (await import('./mocks/MockComponent.svelte')).default,
}));

import IssueSuggestions from '../IssueSuggestions.svelte';

describe('IssueSuggestions search input focus on panel open', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  async function settle(ms = 200): Promise<void> {
    await vi.advanceTimersByTimeAsync(ms);
  }

  function getSearchInput(): HTMLInputElement {
    return screen.getByPlaceholderText(/Search/) as HTMLInputElement;
  }

  it('focuses the search input when the panel opens via the toggle button', async () => {
    render(IssueSuggestions, { props: {} });
    await settle();
    expect(screen.queryByPlaceholderText(/Search/)).toBeNull();

    await fireEvent.click(screen.getByText('Add context'));
    await settle();

    expect(document.activeElement).toBe(getSearchInput());
  });

  it('focuses the search input on mount when initiallyExpanded', async () => {
    render(IssueSuggestions, { props: { initiallyExpanded: true, hideToggle: true } });
    await settle();

    expect(document.activeElement).toBe(getSearchInput());
  });

  it('does not re-steal focus when switching source tabs while open', async () => {
    render(IssueSuggestions, { props: { initiallyExpanded: true, hideToggle: true } });
    await settle();

    const input = getSearchInput();
    expect(document.activeElement).toBe(input);
    input.blur();
    expect(document.activeElement).not.toBe(input);

    await fireEvent.click(screen.getByRole('button', { name: 'GH PRs' }));
    await settle();

    expect(document.activeElement).not.toBe(input);
  });
});
