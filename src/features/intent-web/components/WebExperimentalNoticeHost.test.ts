/**
 * @vitest-environment jsdom
 *
 * The experimental notice shows at each start of the web build served by a
 * Browser access host, and never in Electron or without a host runtime config.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { m } from '$shared/paraglide/messages.js';
import { store } from '$store/renderer/store';
import { withPageBrowserHost } from '$store/renderer/slices/connections/connections-browser-host';
import WebExperimentalNoticeHost from './WebExperimentalNoticeHost.svelte';

type ConfigGlobal = typeof globalThis & { __INTENT_RUNTIME_CONFIG__?: unknown };

const INTENT_WEB = {
  backendId: null,
  connectionsUrl: '/__intent-web/connections',
  hostCapabilities: ['connections.manage'],
};
const BROWSER_ACCESS = { backendId: 'local', connectionsUrl: '/__browser-access/connections' };

let disposeStore: (() => void) | undefined;

/** One app start (full page load): the store is created from the page's runtime config. */
function start(config: object | null) {
  cleanup();
  disposeStore?.();
  if (config) (globalThis as ConfigGlobal).__INTENT_RUNTIME_CONFIG__ = config;
  disposeStore = store.init(withPageBrowserHost());
  return render(WebExperimentalNoticeHost);
}

function notice() {
  return screen.queryByRole('dialog', { name: m.intentWeb_experimentalNotice_title() });
}

function mobileAndSyncItem() {
  return screen.queryByRole('listitem', {
    name: (_name, element) =>
      element.textContent?.trim() === m.intentWeb_experimentalNotice_mobileAndSync_label(),
  });
}

beforeEach(() => {
  vi.stubGlobal('electronAPI', undefined);
});

afterEach(() => {
  cleanup();
  disposeStore?.();
  disposeStore = undefined;
  delete (globalThis as ConfigGlobal).__INTENT_RUNTIME_CONFIG__;
  vi.unstubAllGlobals();
});

describe('WebExperimentalNoticeHost', () => {
  it('shows on intent-web, listing the Mobile tab and iCloud sync', async () => {
    start(INTENT_WEB);
    await waitFor(() => expect(notice()).toBeTruthy());
    expect(within(screen.getByRole('list')).getAllByRole('listitem').length).toBeGreaterThanOrEqual(
      5,
    );
    expect(mobileAndSyncItem()).toBeTruthy();
  });

  it('shows on desktop Browser access without the intent-web extras', async () => {
    start(BROWSER_ACCESS);
    await waitFor(() => expect(notice()).toBeTruthy());
    expect(within(screen.getByRole('list')).getAllByRole('listitem').length).toBeGreaterThanOrEqual(
      5,
    );
    expect(mobileAndSyncItem()).toBeNull();
  });

  it('stays hidden without a host runtime config', async () => {
    start(null);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(notice()).toBeNull();
  });

  it('stays hidden in Electron even when a runtime config is present', async () => {
    vi.stubGlobal('electronAPI', { versions: { electron: '39.0.0' } });
    start(INTENT_WEB);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(notice()).toBeNull();
  });

  it('dismisses with the primary button and shows again at the next start', async () => {
    start(INTENT_WEB);
    await waitFor(() => expect(notice()).toBeTruthy());
    await fireEvent.click(
      screen.getByRole('button', { name: m.intentWeb_experimentalNotice_dismiss_label() }),
    );
    await waitFor(() => expect(notice()).toBeNull());

    start(INTENT_WEB);
    await waitFor(() => expect(notice()).toBeTruthy());
  });

  it('dismisses with Escape', async () => {
    start(BROWSER_ACCESS);
    await waitFor(() => expect(notice()).toBeTruthy());
    await fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    await waitFor(() => expect(notice()).toBeNull());
  });

  it('dismisses with the close control', async () => {
    start(BROWSER_ACCESS);
    await waitFor(() => expect(notice()).toBeTruthy());
    await fireEvent.click(
      screen.getByRole('button', { name: m.intentWeb_experimentalNotice_close_ariaLabel() }),
    );
    await waitFor(() => expect(notice()).toBeNull());
  });
});
