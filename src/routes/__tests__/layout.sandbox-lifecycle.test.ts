import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';

type NavigationCallback = (navigation: { to: { url: URL } | null }) => void;

const mocks = vi.hoisted(() => {
  let navigationCallback: NavigationCallback | undefined;
  return {
    pathname: '/',
    afterNavigate: vi.fn((callback: NavigationCallback) => {
      navigationCallback = callback;
    }),
    getNavigationCallback: () => navigationCallback,
    resetNavigationCallback: () => {
      navigationCallback = undefined;
    },
    startAllAppSagas: vi.fn((): Array<() => void> => []),
    startRootStoreLifecycle: vi.fn(() => () => {}),
  };
});

vi.mock('$app/navigation', () => ({ afterNavigate: mocks.afterNavigate }));
vi.mock('$app/state', () => ({
  page: {
    get url() {
      return new URL(`http://localhost${mocks.pathname}`);
    },
  },
}));
vi.mock('$store/renderer/root-store-lifecycle', () => ({
  startRootStoreLifecycle: mocks.startRootStoreLifecycle,
}));
vi.mock('$store/renderer/sagas', () => ({ startAllAppSagas: mocks.startAllAppSagas }));
vi.mock('$store/renderer/seeders', () => ({}));
vi.mock('$features/backend/splash-gate', () => ({ wireSplashGate: () => () => {} }));
vi.mock('$lib/utils/history-navigation', () => ({
  attachMouseHistoryNavigation: () => () => {},
  handleHistoryNavigateIpc: () => {},
}));
vi.mock('$features/hardware-console/actions/ActionKeyHud.svelte', async () => ({
  default: (await import('./mocks/Marker.svelte')).default,
}));

import { store as appStore } from '$store/renderer/store';
import RootLayout from '../+layout.svelte';

const childrenSnippet = createRawSnippet(() => ({ render: () => '<div>content</div>' }));

function startLayoutSagas(pathname: string): Array<() => void> {
  mocks.pathname = pathname;
  render(RootLayout, { props: { children: childrenSnippet } });
  const lifecycle = mocks.startRootStoreLifecycle.mock.calls[0]?.[1] as {
    startSagas: (store: typeof appStore) => Array<() => void>;
  };
  return lifecycle.startSagas(appStore);
}

function navigate(pathname: string) {
  mocks.getNavigationCallback()?.({ to: { url: new URL(`http://localhost${pathname}`) } });
}

describe('root +layout.svelte sandbox Store lifecycle', () => {
  beforeEach(() => {
    appStore.init();
    mocks.pathname = '/';
    mocks.resetNavigationCallback();
    mocks.afterNavigate.mockClear();
    mocks.startAllAppSagas.mockReset();
    mocks.startRootStoreLifecycle.mockClear();
  });

  afterEach(() => {
    cleanup();
    appStore.dispose();
  });

  it.each(['/sandbox', '/sandbox/button'])('starts zero app sagas on %s', (pathname) => {
    startLayoutSagas(pathname);

    expect(mocks.startAllAppSagas).not.toHaveBeenCalled();
    expect(mocks.afterNavigate).toHaveBeenCalledOnce();
  });

  it('preserves app sagas across normal routes and swaps them at the sandbox boundary', () => {
    const stopFirstAppSagas = vi.fn();
    const stopSecondAppSagas = vi.fn();
    mocks.startAllAppSagas
      .mockReturnValueOnce([stopFirstAppSagas])
      .mockReturnValueOnce([stopSecondAppSagas]);
    const [stopRouteSagas] = startLayoutSagas('/workspace/one');

    navigate('/settings');
    expect(mocks.startAllAppSagas).toHaveBeenCalledOnce();
    expect(stopFirstAppSagas).not.toHaveBeenCalled();

    navigate('/sandbox/button');
    expect(stopFirstAppSagas).toHaveBeenCalledOnce();
    expect(mocks.startAllAppSagas).toHaveBeenCalledOnce();

    navigate('/workspace/two');
    expect(mocks.startAllAppSagas).toHaveBeenCalledTimes(2);
    stopRouteSagas();
    expect(stopSecondAppSagas).toHaveBeenCalledOnce();
  });
});
