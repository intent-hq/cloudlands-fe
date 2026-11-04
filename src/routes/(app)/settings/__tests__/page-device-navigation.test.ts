/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { afterEach, expect, it, vi } from 'vitest';
import { SvelteURL } from 'svelte/reactivity';
import { initAppStore, store as appStore } from '$store/renderer/store';
import {
  browserHostDetected,
  connectionsListReceived,
} from '$store/renderer/slices/connections/connections-slice';
import { selectResolvedLocale } from '$store/renderer/slices/user-preferences/user-preferences-selectors';
import { m } from '$shared/paraglide/messages.js';
import { getPageHost } from '$lib/client/live/browser-access-host';
import { toConnectionsBrowserHost } from '$store/renderer/slices/connections/connections-browser-host';
import { admitLegacyPrincipal } from '../../../../test/fixtures/principal-state';

const mocks = vi.hoisted(() => ({ page: { url: new URL('http://localhost/settings') } }));
vi.mock('$app/state', () => ({ page: mocks.page }));
vi.mock('$lib/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('$lib/client')>();
  return {
    ...actual,
    appClient: {
      ...actual.appClient,
      settings: { ...actual.appClient.settings, list: vi.fn().mockResolvedValue([]) },
    },
  };
});

import SettingsPage from '../+page.svelte';

type RuntimeConfigGlobal = typeof globalThis & { __INTENT_RUNTIME_CONFIG__?: object };

let storeContext: ReturnType<typeof initAppStore>;
let stopShellSubscription: (() => void) | undefined;
afterEach(() => {
  cleanup();
  stopShellSubscription?.();
  stopShellSubscription = undefined;
  storeContext?.dispose();
  delete (globalThis as RuntimeConfigGlobal).__INTENT_RUNTIME_CONFIG__;
  vi.unstubAllGlobals();
});

/**
 * Boot the store the way the app shell does: `/runtime-config.js` runs before
 * the bundle, the root providers subscribe to a selector (activating the
 * store's frame-cadenced state stream), and only then do the startup sagas run.
 * A selector subscribed after that sees the cadenced snapshot, not the latest
 * state, until the next animation frame.
 */
function bootLikeAppShell(runtimeConfig: object | undefined) {
  if (runtimeConfig) {
    // A page host serves a plain browser: no Electron preload bridge.
    vi.stubGlobal('electronAPI', undefined);
    (globalThis as RuntimeConfigGlobal).__INTENT_RUNTIME_CONFIG__ = runtimeConfig;
  }
  storeContext = initAppStore(appStore);
  stopShellSubscription = selectResolvedLocale().subscribe(() => undefined);
  // connectionsSaga's first step, which runs synchronously at app startup.
  const host = getPageHost();
  if (host) appStore.dispatch(browserHostDetected(toConnectionsBrowserHost(host)));
  admitLegacyPrincipal();
}

function mobileTabOnFirstRender(): HTMLElement | null {
  renderSettings('/settings?tab=display');
  // Synchronously after mount: no animation frame has run yet.
  const navigation = screen.getByRole('navigation', { name: 'Settings' });
  return within(navigation).queryByRole('button', { name: 'Mobile', exact: true });
}

function renderSettings(url: string) {
  window.history.pushState({}, '', url);
  mocks.page.url = new SvelteURL(window.location.href);
  Object.defineProperty(Element.prototype, 'scrollTo', { value: vi.fn(), configurable: true });
  return render(SettingsPage, { context: new Map([['redux-store-context', storeContext]]) });
}

it('reopens Mobile from an older remote-access hash after visiting Machines', async () => {
  storeContext = initAppStore(appStore);
  appStore.dispatch(
    connectionsListReceived({
      connections: [
        {
          id: 'local',
          label: 'Local',
          host: '',
          port: 0,
          fingerprint: '',
          accent: null,
          isLocal: true,
          status: 'connected',
        },
      ],
      activeId: 'local',
      windowBackendId: 'local',
      connectedIds: ['local'],
      pinnedVersion: null,
    }),
  );
  admitLegacyPrincipal();
  renderSettings('/settings#websocket-api');
  const navigation = screen.getByRole('navigation', { name: 'Settings' });
  const mobileTab = within(navigation).getByRole('button', { name: 'Mobile', exact: true });
  const advanced = () =>
    within(screen.getByRole('main')).getByRole('button', {
      name: m.settings_devices_advanced_label(),
      exact: true,
    });
  await waitFor(() => expect(mobileTab.getAttribute('aria-current')).toBe('page'));
  await fireEvent.click(advanced());
  await waitFor(() => expect(advanced().getAttribute('aria-expanded')).toBe('true'));
  await fireEvent.click(within(navigation).getByRole('button', { name: 'Machines', exact: true }));
  await waitFor(() => expect(document.getElementById('devices')).not.toBeNull());
  expect(document.getElementById('websocket-api')).toBeNull();
  window.history.replaceState({}, '', '/settings#remote-access');
  await fireEvent(window, new Event('hashchange'));
  await waitFor(() => expect(mobileTab.getAttribute('aria-current')).toBe('page'));
  expect(document.getElementById('websocket-api')).not.toBeNull();
  expect(document.getElementById('devices')).toBeNull();
  expect(advanced().getAttribute('aria-expanded')).toBe('false');
});

it('drops Mobile and Backend Sync when intent-web manages the machines', async () => {
  storeContext = initAppStore(appStore);
  appStore.dispatch(
    browserHostDetected({
      manageConnections: true,
      backendBound: true,
      tailcatAvailable: true,
    }),
  );
  appStore.dispatch(
    connectionsListReceived({ connections: [], activeId: 'remote-1', windowBackendId: 'remote-1' }),
  );
  admitLegacyPrincipal();
  // An old Mobile deep link lands somewhere that exists on this host.
  renderSettings('/settings?tab=mobile');
  const navigation = screen.getByRole('navigation', { name: 'Settings' });
  expect(within(navigation).queryByRole('button', { name: 'Mobile', exact: true })).toBeNull();
  await waitFor(() => expect(document.getElementById('websocket-api')).toBeNull());
  await fireEvent.click(within(navigation).getByRole('button', { name: 'Machines', exact: true }));
  await waitFor(() => expect(document.getElementById('devices')).not.toBeNull());
  expect(document.getElementById('backend-sync')).toBeNull();
});

it('never renders the Mobile tab on intent-web, not even on the first frame', () => {
  bootLikeAppShell({
    backendId: 'remote-1',
    connectionsUrl: '/__intent-web/connections',
    eventsUrl: '/__intent-web/events',
    hostCapabilities: ['connections.manage'],
    tailcatAvailable: false,
  });
  expect(mobileTabOnFirstRender()).toBeNull();
});

it('keeps the Mobile tab in the desktop app', () => {
  bootLikeAppShell(undefined);
  expect(mobileTabOnFirstRender()).not.toBeNull();
});

it('keeps the Mobile tab for desktop Browser access, which does not manage connections', () => {
  bootLikeAppShell({ backendId: 'local', connectionsUrl: '/__browser-access/connections' });
  expect(mobileTabOnFirstRender()).not.toBeNull();
});
