/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.unmock('$lib/electron-bridge');
const integrationWire = vi.hoisted(() => ({
  request: vi.fn(),
  reconnect: [] as Array<() => void>,
}));
vi.mock('$lib/client/live/backend-transport', () => ({
  backendRequest: integrationWire.request,
  onBackendNotification: () => () => {},
  onBackendReconnected: (handler: () => void) => {
    integrationWire.reconnect.push(handler);
    return () => {
      integrationWire.reconnect = integrationWire.reconnect.filter((h) => h !== handler);
    };
  },
}));
import { WORKSPACE_ROUTE_CONTEXT } from '$lib/utils/workspace-route-context';

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
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');
  return createAppStoreMockModule({ state: () => ({ theme: { name: 'dark' } }) });
});

vi.mock('$store/renderer/slices/github-auth/github-auth-selectors', () => ({
  selectGitHubAuthIsAuthenticated: mocks.selector(true),
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
vi.unmock('$features/linear-auth/renderer/linear-auth.client');
vi.unmock('$features/sentry-auth/renderer/sentry-auth.client');
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
  TooltipRich: (await import('./mocks/MockTooltipRich.svelte')).default,
}));
vi.mock('$lib/components/ui/Header.svelte', async () => ({
  default: (await import('./mocks/MockComponent.svelte')).default,
}));

import IssueSuggestions from '../IssueSuggestions.svelte';
import { warmImport } from '../../../../../test/warm-import';

/** Captured IntersectionObserver instances so tests can fire intersections. */
const observers: Array<{
  callback: IntersectionObserverCallback;
  elements: Element[];
  instance: IntersectionObserver;
  disconnected: boolean;
}> = [];

class MockIntersectionObserver {
  constructor(private callback: IntersectionObserverCallback) {
    observers.push({
      callback,
      elements: [],
      instance: this as unknown as IntersectionObserver,
      disconnected: false,
    });
  }
  observe(el: Element) {
    observers
      .find((o) => o.instance === (this as unknown as IntersectionObserver))
      ?.elements.push(el);
  }
  disconnect() {
    const observer = observers.find(
      (o) => o.instance === (this as unknown as IntersectionObserver),
    );
    if (observer) observer.disconnected = true;
  }
  unobserve(el: Element) {
    const observer = observers.find(
      (o) => o.instance === (this as unknown as IntersectionObserver),
    );
    if (observer) observer.elements = observer.elements.filter((element) => element !== el);
  }
  takeRecords() {
    return [];
  }
}

function intersectSentinel(sentinel: Element): void {
  const observer = [...observers]
    .reverse()
    .find((candidate) => !candidate.disconnected && candidate.elements.includes(sentinel));
  if (!observer) throw new Error('no active IntersectionObserver observes the live sentinel');
  observer.callback(
    [{ isIntersecting: true, target: sentinel } as IntersectionObserverEntry],
    observer.instance,
  );
}

// Pre-warm the component module graph so the cold dynamic import is not
// billed to the first test's timeout (intent-hq/monorepo#1464).
warmImport(() => import('../../../ui/__tests__/mocks/Fa.svelte'));
warmImport(() => import('./mocks/MockComponent.svelte'));
warmImport(() => import('./mocks/MockTooltipRich.svelte'));

describe('IssueSuggestions provider search after reconnect', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    observers.length = 0;
    vi.stubGlobal('IntersectionObserver', MockIntersectionObserver);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  async function settle(ms = 200): Promise<void> {
    await vi.advanceTimersByTimeAsync(ms);
  }

  it.each([
    ['linear', 'success', 'query-preservation-ws'],
    ['linear', 'error', 'query-preservation-ws'],
    ['sentry', 'success', 'query-preservation-ws'],
    ['sentry', 'error', 'query-preservation-ws'],
    ['linear', 'success', undefined],
    ['sentry', 'success', undefined],
  ] as const)(
    'preserves active %s search and pagination after old %s with origin %s',
    async (provider, outcome, workspaceId) => {
      const origin = workspaceId === undefined ? {} : { workspaceId };
      await import('$store/renderer/seeders/integrations-bridge-seeder');
      const { __resetGitHubAuthStatusForTests } =
        await import('$features/github-auth/renderer/github-auth-status.client');
      __resetGitHubAuthStatusForTests();
      let era = 'before';
      let oldPage:
        { resolve: (value: unknown) => void; reject: (error: Error) => void } | undefined;
      const row = (title: string) =>
        provider === 'linear'
          ? { id: '1', identifier: 'TEAM-1', title, teamKey: 'TEAM', teamName: 'Team' }
          : {
              id: '1',
              shortId: 'APP-1',
              title,
              status: 'unresolved',
              level: 'error',
              count: '1',
              userCount: 1,
              firstSeen: '2026-09-28T00:00:00Z',
              lastSeen: '2026-09-28T00:00:00Z',
              projectName: 'App',
              projectSlug: 'app',
            };
      integrationWire.request.mockImplementation(
        async (method: string, params: { nextToken?: string }) => {
          if (method === 'github.authStatus') return { isConfigured: false };
          if (method === 'linear.authStatus') return { authenticated: provider === 'linear' };
          if (method === 'sentry.authStatus')
            return { authenticated: provider === 'sentry', organization: 'fixture' };
          if (method === provider + '.listIssues')
            return { issues: [row('Unrelated default-' + era)], nextToken: null };
          if (method === provider + '.searchIssues') {
            if (era === 'before' && params.nextToken)
              return new Promise((resolve, reject) => {
                oldPage = { resolve, reject };
              });
            return {
              issues: [
                {
                  ...row('keep matched-' + era),
                  ...(params.nextToken ? { id: '2', title: 'keep second page' } : {}),
                },
              ],
              nextToken: params.nextToken ? null : 'search-next',
            };
          }
          if (method === 'github.relatedRepos.list') return { repos: [] };
          return { issues: [], pulls: [], nextToken: null };
        },
      );
      const view = render(IssueSuggestions, {
        props: { initiallyExpanded: true, initialSource: provider, hideSourceTabs: true },
        context: new Map([[WORKSPACE_ROUTE_CONTEXT, { workspaceId }]]),
      });
      await settle(1000);
      await fireEvent.input(view.container.querySelector('input')!, { target: { value: 'keep' } });
      await settle(500);
      expect(screen.getByText('keep matched-before')).toBeTruthy();
      expect(integrationWire.request).toHaveBeenCalledWith(provider + '.searchIssues', {
        query: 'keep',
        ...origin,
      });
      intersectSentinel(view.container.querySelector('[aria-hidden="true"].h-px')!);
      await settle();
      expect(oldPage).toBeDefined();
      era = 'after';
      integrationWire.request.mockClear();
      for (const handler of [...integrationWire.reconnect]) handler();
      await settle(1000);

      if (outcome === 'success')
        oldPage!.resolve({
          issues: [{ ...row('keep stale old page'), id: 'stale' }],
          nextToken: 'stale-token',
        });
      else oldPage!.reject(new Error('old connection'));
      await settle();
      expect(screen.queryByText('keep stale old page')).toBeNull();
      expect.soft(view.container.querySelector('input')?.value).toBe('keep');
      expect.soft(integrationWire.request).toHaveBeenCalledWith(provider + '.searchIssues', {
        query: 'keep',
        ...origin,
      });
      expect.soft(screen.queryByText('keep matched-after')).not.toBeNull();
      expect.soft(screen.queryByText('Unrelated default-after')).toBeNull();
      const sentinel = view.container.querySelector('[aria-hidden="true"].h-px');
      expect(sentinel).not.toBeNull();
      intersectSentinel(sentinel!);
      await settle();
      expect(integrationWire.request).toHaveBeenCalledWith(provider + '.searchIssues', {
        query: 'keep',
        ...origin,
        nextToken: 'search-next',
      });
      expect(screen.getByText('keep second page')).toBeTruthy();
      expect(view.container.querySelector('[aria-hidden="true"].h-px')).toBeNull();
      // Clearing the query restores default data, never a search page cached as defaults.
      await fireEvent.input(view.container.querySelector('input')!, { target: { value: '' } });
      await settle(500);
      expect(screen.queryByText('keep matched-after')).toBeNull();
      expect(screen.getAllByText('Unrelated default-after').length).toBeGreaterThan(0);
    },
  );
});
