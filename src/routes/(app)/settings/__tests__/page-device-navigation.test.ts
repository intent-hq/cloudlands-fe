/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { afterEach, expect, it, vi } from 'vitest';
import { SvelteURL } from 'svelte/reactivity';
import { initAppStore, store as appStore } from '$store/renderer/store';
import { connectionsListReceived } from '$store/renderer/slices/connections/connections-slice';
import { m } from '$shared/paraglide/messages.js';
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

let storeContext: ReturnType<typeof initAppStore>;
afterEach(() => {
  cleanup();
  storeContext?.dispose();
});

function renderSettings(url: string) {
  window.history.pushState({}, '', url);
  mocks.page.url = new SvelteURL(window.location.href);
  Object.defineProperty(Element.prototype, 'scrollTo', { value: vi.fn(), configurable: true });
  Object.defineProperty(Element.prototype, 'scrollIntoView', {
    value: vi.fn(),
    configurable: true,
  });
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
