/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { afterEach, expect, it, vi } from 'vitest';
import { SvelteURL } from 'svelte/reactivity';
import { initAppStore, store as appStore } from '$store/renderer/store';
import { connectionsListReceived } from '$store/renderer/slices/connections/connections-slice';

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

it('consumes the local edit request while allowing a later remote-access deep link', async () => {
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
  renderSettings('/settings#websocket-api');
  const local = () => screen.getByRole('article', { name: 'This machine (local)' });
  await waitFor(() =>
    expect(within(local()).getByRole('button', { name: 'Advanced', exact: true })).toBeTruthy(),
  );
  const navigation = screen.getByRole('navigation', { name: 'Settings' });
  await fireEvent.click(within(navigation).getByRole('button', { name: 'General', exact: true }));
  await fireEvent.click(within(navigation).getByRole('button', { name: 'Devices', exact: true }));
  expect(within(local()).queryByRole('button', { name: 'Advanced', exact: true })).toBeNull();
  window.history.replaceState({}, '', '/settings#remote-access');
  await fireEvent(window, new Event('hashchange'));
  await waitFor(() =>
    expect(within(local()).getByRole('button', { name: 'Advanced', exact: true })).toBeTruthy(),
  );
});
